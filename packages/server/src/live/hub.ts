import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import {
  parseSessionKey,
  sessionKey,
  type ClientMsg,
  type LiveSessionInfo,
  type PermissionMode,
  type Project,
  type ProviderId,
  type ServerMsg,
  type SessionKey,
} from "@rails/shared";
import { projects } from "../db.ts";
import { findSession, LIVE_PROVIDERS } from "../providers/index.ts";
import { ClaudeLive } from "./claude.ts";

interface Entry {
  projectId: string;
  live: ClaudeLive;
}

/**
 * Owns live agent processes and fans their events out to every subscribed client
 * (shared live view: all devices see and can drive the same session).
 */
export class LiveHub {
  private sessions = new Map<SessionKey, Entry>();
  private subs = new Map<SessionKey, Set<WebSocket>>();
  private clients = new Set<WebSocket>();

  liveInfo(): LiveSessionInfo[] {
    return [...this.sessions].map(([key, e]) => ({
      key,
      projectId: e.projectId,
      status: e.live.status,
      mode: e.live.mode,
      pending: e.live.pending.size,
    }));
  }

  statusOf(key: SessionKey) {
    return this.sessions.get(key)?.live.status;
  }

  connect(ws: WebSocket) {
    this.clients.add(ws);
    send(ws, { type: "live", sessions: this.liveInfo() });
    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const clientRef = msg.type === "start" ? msg.clientRef : undefined;
      this.handle(ws, msg).catch((e) => send(ws, { type: "error", message: String(e?.message ?? e), clientRef }));
    });
    ws.on("close", () => {
      this.clients.delete(ws);
      for (const s of this.subs.values()) s.delete(ws);
    });
  }

  private async handle(ws: WebSocket, msg: ClientMsg) {
    switch (msg.type) {
      case "subscribe": {
        let set = this.subs.get(msg.key);
        if (!set) this.subs.set(msg.key, (set = new Set()));
        set.add(ws);
        const e = this.sessions.get(msg.key);
        send(ws, {
          type: "snapshot",
          key: msg.key,
          status: e?.live.status ?? "stopped",
          mode: e?.live.mode ?? "default",
          messages: e?.live.buffer ?? [],
          pending: e ? [...e.live.pending.values()].map((p) => p.req) : [],
        });
        return;
      }
      case "unsubscribe":
        this.subs.get(msg.key)?.delete(ws);
        return;
      case "start": {
        const project = liveProject(msg.projectId, msg.provider);
        const id = randomUUID();
        const key = sessionKey(msg.provider, id);
        this.subs.set(key, new Set([ws]));
        const e = this.spawn(key, project.id, project.path, msg.mode ?? "default", false);
        send(ws, { type: "session.started", clientRef: msg.clientRef, key, projectId: project.id });
        e.live.send(msg.text);
        return;
      }
      case "send": {
        let e = this.sessions.get(msg.key);
        if (!e) {
          const { provider, id } = parseSessionKey(msg.key);
          const project = liveProject(msg.projectId, provider);
          const found = await findSession(provider, id);
          if (!found) throw new Error("Session transcript not found");
          e = this.spawn(msg.key, project.id, found.cwd, msg.mode ?? "default", true);
        }
        e.live.send(msg.text);
        return;
      }
      case "permission":
        this.sessions.get(msg.key)?.live.answer(msg.requestId, msg.allow);
        return;
      case "interrupt":
        await this.sessions.get(msg.key)?.live.interrupt();
        return;
      case "stop":
        this.sessions.get(msg.key)?.live.stop();
        return;
      case "setMode":
        await this.sessions.get(msg.key)?.live.setMode(msg.mode);
        return;
    }
  }

  private spawn(key: SessionKey, projectId: string, cwd: string, mode: PermissionMode, resume: boolean): Entry {
    const { id } = parseSessionKey(key);
    const fan = (m: ServerMsg) => this.toSubs(key, m);
    const live = new ClaudeLive(id, cwd, mode, resume, {
      message: (message) => fan({ type: "message", key, message }),
      status: (status, error) => {
        fan({ type: "status", key, status, error });
        this.broadcastLive();
      },
      mode: (mode) => fan({ type: "mode", key, mode }),
      permissionRequest: (request) => {
        fan({ type: "permission.request", key, request });
        this.broadcastLive();
      },
      permissionResolved: (requestId, allow) => {
        fan({ type: "permission.resolved", key, requestId, allow });
        this.broadcastLive();
      },
      ended: () => {
        if (this.sessions.get(key)?.live === live) this.sessions.delete(key);
        this.broadcastLive();
      },
    });
    const entry = { projectId, live };
    this.sessions.set(key, entry);
    this.broadcastLive();
    return entry;
  }

  private toSubs(key: SessionKey, m: ServerMsg) {
    for (const ws of this.subs.get(key) ?? []) send(ws, m);
  }

  private broadcastLive() {
    const m: ServerMsg = { type: "live", sessions: this.liveInfo() };
    for (const ws of this.clients) send(ws, m);
  }

  stopAll() {
    for (const e of this.sessions.values()) e.live.stop();
  }
}

/** The project a live session runs in, after checking that the provider can run live. */
function liveProject(projectId: string, provider: ProviderId): Project {
  if (!LIVE_PROVIDERS.includes(provider)) throw new Error(`${provider} can't run live yet`);
  const project = projects.get(projectId);
  if (!project) throw new Error("Unknown project");
  return project;
}

function send(ws: WebSocket, m: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
}
