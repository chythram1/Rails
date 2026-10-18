// What Sprockets run on (ADR 0006): model providers, their credentials and the default model, through
// pi-ai. Only credentials stored here count; rails ignores provider env vars (OPENAI_API_KEY, …) so it
// never bills a key the user set for something else.
import { randomUUID } from "node:crypto";
import { createModels, type Api, type Model, type Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import type { ModelChoice, ModelProvider, ModelSettings, SignIn } from "@rails/shared";
import { fileCredentialStore } from "./credentials.ts";
import { settings } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { signInWithChatGPT, signInWithOpenRouter, type PendingSignIn } from "./signin.ts";
import { listeners } from "./util.ts";

/**
 * The providers offered, in display order, and the ones users may sign in to. Anthropic's own sign-in
 * is left out on purpose: its subscriptions may not be used by other apps, so Anthropic takes an API key.
 * OpenAI's "Sign in with ChatGPT" is allowed for open-source and locally run apps.
 */
const OFFERED: { make: () => Provider; signIn?: string }[] = [
  { make: openaiProvider, signIn: "Continue with ChatGPT" },
  { make: anthropicProvider },
  { make: openrouterProvider, signIn: "Sign in with OpenRouter" },
  { make: googleProvider },
  { make: xaiProvider },
  { make: mistralProvider },
  { make: groqProvider },
  { make: deepseekProvider },
];

const credentials = fileCredentialStore();
export const models = createModels({
  credentials,
  authContext: { env: async () => undefined, fileExists: async () => false },
});
const signInLabels = new Map<string, string>();
for (const o of OFFERED) {
  const p = o.make();
  models.setProvider(p);
  if (o.signIn && p.auth.oauth) signInLabels.set(p.id, o.signIn);
}

const modelChanges = listeners();
export const onModelsChanged = modelChanges.on;
const changed = modelChanges.emit;

const signInChanges = listeners<[signIn: SignIn]>();
export const onSignIn = signInChanges.on;

function provider(id: string): Provider {
  const p = models.getProvider(id);
  if (!p) throw new ServiceError("Unknown provider", 404);
  return p;
}

export const refOf = (m: Model<Api>) => `${m.provider}/${m.id}`;

// With a ChatGPT sign-in, only the models of the user's plan work. OpenAI lists them (and others it hides)
// at /v1/models; pi-ai's catalog has every OpenAI API model. Cached, and dropped when OpenAI's setup changes.
const PLAN_TTL_MS = 10 * 60_000;
let planModels: { at: number; ids: Set<string> } | undefined;

async function chatgptPlanModels(): Promise<void> {
  if ((await credentials.read("openai"))?.type !== "oauth") return void (planModels = undefined);
  if (planModels && Date.now() - planModels.at < PLAN_TTL_MS) return;
  try {
    const token = (await models.getAuth("openai"))?.auth.apiKey;
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return; // keep the last known list
    const body = (await res.json()) as { models?: { slug: string; visibility?: string }[] };
    planModels = { at: Date.now(), ids: new Set((body.models ?? []).filter((m) => m.visibility === "list").map((m) => m.slug)) };
  } catch {
    // offline: keep the last known list
  }
}

const usable = (m: Model<Api>) => m.provider !== "openai" || !planModels || planModels.ids.has(m.id);

/** The model a `provider/model` ref names, if that provider is set up and the model can be used. */
export function findModel(ref: string | undefined): Model<Api> | undefined {
  if (!ref) return undefined;
  const slash = ref.indexOf("/");
  const m = slash > 0 ? models.getModel(ref.slice(0, slash), ref.slice(slash + 1)) : undefined;
  return m && usable(m) ? m : undefined;
}

function openaiChanged(providerId: string) {
  if (providerId === "openai") planModels = undefined;
}

export async function modelSettings(): Promise<ModelSettings> {
  const stored = new Map((await credentials.list()).map((c) => [c.providerId, c.type]));
  const providers: ModelProvider[] = models.getProviders().map((p) => ({
    id: p.id,
    name: p.name,
    auth: stored.has(p.id) ? { type: stored.get(p.id)! } : null,
    signIn: signInLabels.get(p.id),
  }));
  await chatgptPlanModels();
  const available = (await models.getAvailable().catch(() => [])).filter(usable);
  const choices: ModelChoice[] = available.map((m) => ({ ref: refOf(m), provider: m.provider, name: m.name }));
  return { providers, models: choices, defaultModel: settings.get("defaultModel") };
}

export async function setApiKey(providerId: string, rawKey: unknown): Promise<void> {
  provider(providerId);
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!key) throw new ServiceError("Enter an API key.", 400);
  await credentials.modify(providerId, async () => ({ type: "api_key", key }));
  openaiChanged(providerId);
  changed();
}

export async function removeCredential(providerId: string): Promise<void> {
  provider(providerId);
  const stored = await credentials.read(providerId);
  if (providerId === "openai" && stored?.type === "oauth" && typeof stored.clientId === "string") settings.set(CHATGPT_CLIENT, stored.clientId);
  await models.logout(providerId);
  openaiChanged(providerId);
  changed();
}

export function setDefaultModel(ref: unknown): void {
  if (ref !== null && (typeof ref !== "string" || !findModel(ref))) throw new ServiceError("Unknown model", 400);
  settings.set("defaultModel", ref);
  changed();
}

/** This install's id, which OpenAI's sign-in requires (kept across sign-ins). Made on first use. */
function deviceId(): string {
  let id = settings.get("deviceId");
  if (!id) settings.set("deviceId", (id = randomUUID()));
  return id;
}

// ---- Sign-in (signin.ts runs the flows, so every page says rails). One at a time: a new sign-in cancels
// the one before, which frees the callback port.

// The client id OpenAI issued at the first ChatGPT sign-in (not a secret). Signing in again with it skips
// OpenAI's naming and consent screens. It's kept when the user removes the provider, and forgotten when a
// sign-in with it fails or the user asks to use a different account.
const CHATGPT_CLIENT = "chatgptClientId";

const SIGN_IN: Record<string, (fresh: boolean) => Promise<PendingSignIn>> = {
  openai: (fresh) => signInWithChatGPT(deviceId(), { clientId: fresh ? undefined : settings.get(CHATGPT_CLIENT) }),
  openrouter: () => signInWithOpenRouter(),
};

interface Active {
  signIn: SignIn;
  pending?: PendingSignIn;
  cancelled?: boolean;
}
let active: Active | undefined;

function update(a: Active, patch: Partial<SignIn>) {
  a.signIn = { ...a.signIn, ...patch };
  signInChanges.emit(a.signIn);
}

/** `fresh`: sign in to a different account than last time (ChatGPT registers Rails again). */
export async function startSignIn(providerId: string, fresh = false): Promise<SignIn> {
  provider(providerId);
  const start = SIGN_IN[providerId];
  if (!start) throw new ServiceError("This provider takes an API key.", 400);
  if (active && active.signIn.state === "waiting") await cancel(active);
  const sameAccount = providerId === "openai" && !fresh && !!settings.get(CHATGPT_CLIENT);
  const a: Active = { signIn: { id: randomUUID(), providerId, state: "waiting", sameAccount } };
  active = a;
  try {
    a.pending = await start(fresh);
  } catch (e) {
    update(a, { state: "failed", error: (e as Error).message });
    return a.signIn;
  }
  update(a, { authUrl: a.pending.authUrl });
  a.pending.credential.then(
    async (credential) => {
      await credentials.modify(providerId, async () => credential);
      if (typeof credential.clientId === "string") settings.set(CHATGPT_CLIENT, credential.clientId);
      openaiChanged(providerId);
      update(a, { state: "done" });
      changed();
    },
    (e: Error) => {
      if (a.cancelled) return;
      // A remembered client that stopped working (or belongs to another account): register afresh next time.
      if (sameAccount) settings.set(CHATGPT_CLIENT, null);
      update(a, { state: "failed", error: e.message });
    },
  );
  return a.signIn;
}

function activeSignIn(id: string): Active {
  if (!active || active.signIn.id !== id) throw new ServiceError("That sign-in isn't running any more.", 404);
  return active;
}

/** The address the browser ended on after signing in, pasted by the user (signing in from another device). */
export async function submitSignInCode(id: string, code: unknown): Promise<void> {
  const a = activeSignIn(id);
  if (typeof code !== "string" || !code.trim()) throw new ServiceError("Paste the address from your browser.", 400);
  if (!a.pending || a.signIn.state !== "waiting") throw new ServiceError("This sign-in isn't waiting for an address.", 409);
  try {
    await a.pending.paste(code);
  } catch (e) {
    throw new ServiceError((e as Error).message, 400);
  }
}

async function cancel(a: Active) {
  a.cancelled = true;
  await a.pending?.close();
  if (a.signIn.state === "waiting") update(a, { state: "cancelled" });
}

export async function cancelSignIn(id: string): Promise<void> {
  await cancel(activeSignIn(id));
}
