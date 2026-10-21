// Shared domain + wire types. Terms are defined in docs/CONTEXT.md.

export type ProviderId = "claude" | "codex" | "pi";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Provider store exists on disk (sessions can be discovered). */
  discoverable: boolean;
  /** The provider's CLI is on the server's PATH, so panels can run it. */
  installed: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

/** A folder where agents have sessions and that isn't a project yet, offered when adding a project. */
export interface RecentFolder {
  path: string;
  /** The folder's own name (UI shows names, not paths). */
  name: string;
  lastActive: string;
}

/** `${provider}:${providerSessionId}` */
export type SessionKey = string;
export const sessionKey = (provider: ProviderId, id: string): SessionKey => `${provider}:${id}`;
export function parseSessionKey(key: SessionKey): { provider: ProviderId; id: string } {
  const i = key.indexOf(":");
  return { provider: key.slice(0, i) as ProviderId, id: key.slice(i + 1) };
}

/**
 * A session's title short enough to sit beside other text: agents title a session with its whole first prompt
 * ("Without using any tools, say hello, then end your reply…"), so cut it at a word near `max` characters.
 * Show the full title where there's room or as a tooltip.
 */
export function shortTitle(title: string, max = 40): string {
  const t = title.replace(/\s+/g, " ").trim().replace(/…$/, "");
  if (t.length <= max) return t === title.trim() ? t : `${t}…`;
  const cut = t.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : t.slice(0, max)).replace(/[\s,;:.-]+$/, "")}…`;
}

export interface SessionSummary {
  key: SessionKey;
  provider: ProviderId;
  id: string;
  cwd: string;
  /** What Rails shows: the name the user gave it in Rails, else the agent's title. */
  title: string;
  /** The agent's own title, when a name the user gave it in Rails replaces it. */
  agentTitle?: string;
  createdAt: string;
  updatedAt: string;
  /** Id of the panel this session is open in, if any. */
  panelId?: string;
}

/** The longest name the user can give a session in Rails (a tab's or the sidebar's width). */
export const SESSION_NAME_MAX = 40;

/** Why a panel needs the user (ADR 0007): its agent waits for a permission or an answer, or its turn failed. */
export type AttentionReason = "waiting" | "failed";

/**
 * Two live sessions in a project both changed these files in the last 30 minutes (ADR 0014): they may be working
 * against each other. Paths are relative to the project. One entry per session and other session.
 */
export interface PanelOverlap {
  panelId: string;
  otherPanelId: string;
  files: string[];
}

/** What runs in a panel: one of the agents' native TUIs, or a plain shell in the project folder. */
export type PanelKind = ProviderId | "shell";

/** A terminal tab in a project's workspace. Its process runs in tmux, so it survives server restarts. */
export interface Panel {
  id: string;
  projectId: string;
  kind: PanelKind;
  /** Provider session shown in this panel. Unknown for shells and for new Codex sessions. */
  sessionId?: string;
  title: string;
  /** The name the user gave its session in Rails (in a workspace only): browsers show it instead of any title. */
  name?: string;
  createdAt: string;
  /** The agent profile it started with, as it was then (ADR 0020): editing the profile doesn't change a running panel. */
  profile?: PanelProfile;
}

/** A running panel started with an agent profile: where the profile is in use (Customize). */
export interface ProfileUse {
  panelId: string;
  projectId: string;
  projectName: string;
  kind: PanelKind;
  title: string;
  sessionId?: string;
}

/** What a panel records of the profile it started with. Sprockets see it on the board. */
export type PanelProfile = Pick<AgentProfile, "id" | "name" | "model" | "effort" | "permissionMode">;

/** Body of "open a panel" (POST /api/projects/:id/panels). */
export interface OpenPanel {
  kind: PanelKind;
  /** Resume this existing session instead of starting a new one. */
  sessionId?: string;
  /** First message for a new agent session. */
  prompt?: string;
  /** Start the agent with this profile's flags; without one, the agent's default profile (if any) applies. */
  profileId?: string;
}

// ---- Customize: agent profiles and saved prompts (ADR 0020). ----

/** Agents that can have profiles so far: their flags are checked against a real install (ADR 0020). */
export const PROFILE_AGENTS = ["claude"] as const satisfies readonly ProviderId[];

/** Claude Code's `--effort` levels. */
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/** Claude Code's `--permission-mode` values. */
export const CLAUDE_PERMISSION_MODES = ["manual", "acceptEdits", "auto", "plan", "dontAsk", "bypassPermissions"] as const;

export const PROFILE_NAME_MAX_LEN = 40;
export const PROFILE_INSTRUCTIONS_MAX = 2000;
/** At most this many allowed (and as many denied) tool patterns, each at most PROFILE_TOOL_MAX characters. */
export const PROFILE_TOOLS_MAX = 30;
export const PROFILE_TOOL_MAX = 200;

/**
 * A named set of launch options for one agent, applied as command-line flags when Rails starts it in a panel.
 * Empty fields leave the agent's own default. At most one profile per agent is its default.
 */
export interface AgentProfile {
  id: string;
  name: string;
  agent: ProviderId;
  /** Used when a panel for this agent starts without a profile picked (also when resuming a session). */
  isDefault: boolean;
  /** `--model`: an alias (`opus`, `sonnet`) or a full model name. */
  model: string;
  /** `--effort`, or "" for the agent's default. */
  effort: (typeof CLAUDE_EFFORTS)[number] | "";
  /** `--permission-mode`, or "" for the agent's default. */
  permissionMode: (typeof CLAUDE_PERMISSION_MODES)[number] | "";
  /** `--append-system-prompt`: added to the agent's own system prompt. */
  instructions: string;
  /** `--allowed-tools` / `--disallowed-tools` patterns, e.g. `Bash(git *)`, `Edit`. */
  allowedTools: string[];
  disallowedTools: string[];
  createdAt: string;
}

/** Body of "create" and "change a profile". Only the fields present change. */
export type AgentProfileInput = Partial<Omit<AgentProfile, "id" | "createdAt">>;

export const SAVED_PROMPT_NAME_MAX = 60;
export const SAVED_PROMPT_TEXT_MAX = 4000;

/** A prompt the user keeps to start agents with (Home's composer fills in its text). */
export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
  createdAt: string;
}

export type SavedPromptInput = Partial<Pick<SavedPrompt, "name" | "text">>;

/** A project's panels plus the saved dockview layout (opaque to the server). */
export interface Workspace {
  panels: Panel[];
  layout: unknown | null;
}

export interface GitFile {
  path: string;
  /** Two-letter porcelain XY code, e.g. " M", "A ", "??". */
  status: string;
}

/** A file's state in git, for the file tree (porcelain codes, read): what changed since the last commit. */
export type GitState = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";

/** One entry of a folder in the file tree (the side panel's Files tab). */
export interface FileEntry {
  name: string;
  /** From the project's folder, with `/`. */
  path: string;
  dir: boolean;
  /** A file's state; for a folder, the strongest state of what it holds. None when unchanged. */
  git?: GitState;
  /** git ignores it (build output, dependencies, private files). */
  ignored?: true;
}

export interface FolderListing {
  path: string;
  entries: FileEntry[];
  /** It holds more entries than one listing shows. */
  more: boolean;
  isRepo: boolean;
  /** Files git has as deleted in this folder (gone from the disk, so not among the entries). */
  deleted: string[];
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFile[];
}

// ---- Sprockets: always-on agents (ADR 0005, 0006). ----

/** The cast: the shapes a Sprocket can have. */
export const SPROCKET_CHARACTERS = ["block", "bean", "lune", "bell", "starry", "cog", "roo", "momo"] as const;
export type SprocketCharacter = (typeof SPROCKET_CHARACTERS)[number];

/** Body colours (the web holds the hex values). */
export const SPROCKET_COLORS = ["brown", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey"] as const;
export type SprocketColor = (typeof SPROCKET_COLORS)[number];

/** Head accessories; a Sprocket wears one or none. */
export const SPROCKET_ACCESSORIES = ["party", "beanie", "cap", "bow", "flower", "crown", "bucket"] as const;
export type SprocketAccessory = (typeof SPROCKET_ACCESSORIES)[number];

/** What a Sprocket looks like. */
export interface SprocketLook {
  character: SprocketCharacter;
  color: SprocketColor;
  accessory: SprocketAccessory | "none";
}

export interface Sprocket {
  id: string;
  name: string;
  look: SprocketLook;
  createdAt: string;
  /** The project it's attached to; a Sprocket belongs to at most one project. */
  projectId?: string;
  /** The model it runs on (`provider/model`), or none to use the default model. */
  model?: string;
  /**
   * What the user wants from it, in their words: its standing instructions, like a small AGENTS.md (or
   * Muse's and Hermes' identity files). Stays with it across projects. Its core memory is internal.
   */
  description: string;
  /**
   * Whether it's its project's Coordinator: the one Sprocket Rails wakes for the project's sessions. A project has
   * one Sprocket, and it's the Coordinator (ADR 0016), so this is true exactly when it's attached.
   */
  coordinator: boolean;
  /**
   * Its standing rules for answering sessions as a Coordinator, one plain sentence each ("If it asks
   * whether to continue with its plan, say yes."). Each suggestion says which one it followed (ADR 0011).
   */
  rules: string[];
  /** Panels where a reply it suggested waits for the user to send it (or answer in the panel). */
  pending: string[];
  /** As a Coordinator: the handoffs it planned that still wait for their session to finish (ADR 0015). */
  handoffs: Handoff[];
  /** As a Coordinator: who owns what in its project (ADR 0016). */
  owners: ProjectOwner[];
  /** What its runs have used so far: tokens, and cost where the provider reports one (not on a ChatGPT plan). */
  usage: { runs: number; tokens: number; cost: number };
  /** True while it's working on a reply, in any of its chats. */
  running: boolean;
  /** Its direct chat: the user and the Sprocket (ADR 0021). */
  direct: SprocketChatInfo;
  /** Its project's chat, where Rails' events land, while it's attached (ADR 0021). */
  projectChat?: SprocketChatInfo;
}

/** A Sprocket's own chat with the user, its project's chat (ADR 0021), or a team of Sprockets' (ADR 0022). */
export type SprocketChatKind = "direct" | "project" | "team";

/** A chat as the Sprocket list shows it. */
export interface SprocketChatInfo {
  id: string;
  kind: SprocketChatKind;
  /** True while the Sprocket (in a team, one of its members) is writing a reply in this chat. */
  running: boolean;
  /** Suggestions under its replies that wait for the user. */
  pending: number;
  /** The newest message, for the list preview. */
  lastMessage?: SprocketMessage;
}

/**
 * A team chat (ADR 0022): the user and two to four Sprockets. The user's messages go to the members they
 * @mention, else to whoever asked them something, else to the lead; a member gives a teammate the turn with
 * pass_turn (ADR 0023).
 */
export interface SprocketTeam extends SprocketChatInfo {
  kind: "team";
  name: string;
  /** Its members' ids, the lead first. */
  members: string[];
  /** The member writing a reply there now, if one is. */
  replying?: string;
  /** Members whose turns are queued, in order (ADR 0023). */
  waiting: string[];
  /** Rails is working out who the user's latest message is for (the decision model is judging it). */
  routing?: boolean;
  createdAt: string;
}

/** A team as the user makes or edits it. */
export interface SprocketTeamInput {
  name: string;
  /** Two to four Sprockets with different names, the lead first. */
  members: string[];
}

export const TEAM_MEMBERS_MIN = 2;
export const TEAM_MEMBERS_MAX = 4;
/** Passes of the turn in a row, after one message from the user, before a team waits for them again (ADR 0023). */
export const TEAM_TURNS_MAX = 10;

/** An @mention of a team member in a message (ADR 0022): where it is, and the member's index in the names given. */
export interface MentionSpan {
  start: number;
  end: number;
  member: number;
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * The @mentions of team members in `text`, in order: "@" and a member's whole name, in any case and not the start
 * of a longer word (longer names first, so "@Doc Keeper" isn't "@Doc"), or the start of a word of just one member's
 * name ("@Doc", "@keep", "@pix"; two letters at least). An "@" inside a word (an email address) isn't one.
 */
export function findMentions(text: string, names: string[]): MentionSpan[] {
  const lower = text.toLowerCase();
  const byLength = names.map((name, member) => ({ name: name.toLowerCase(), member })).sort((a, b) => b.name.length - a.name.length);
  const found: MentionSpan[] = [];
  for (let at = lower.indexOf("@"); at >= 0; at = lower.indexOf("@", at + 1)) {
    if (at > 0 && WORD.test(text[at - 1])) continue;
    const rest = lower.slice(at + 1);
    const whole = byLength.find((n) => n.name && rest.startsWith(n.name) && !WORD.test(rest[n.name.length] ?? ""));
    if (whole) {
      found.push({ start: at, end: at + 1 + whole.name.length, member: whole.member });
      at += whole.name.length;
      continue;
    }
    const word = /^[\p{L}\p{N}_]{2,}/u.exec(rest)?.[0];
    if (!word) continue;
    const fits = byLength.filter((n) => n.name.split(/[^\p{L}\p{N}_]+/u).some((w) => w.startsWith(word)));
    if (fits.length === 1) {
      found.push({ start: at, end: at + 1 + word.length, member: fits[0].member });
      at += word.length;
    }
  }
  return found;
}

/** A session in a project and the files or folders it owns (relative to the project, ADR 0016). */
export interface ProjectOwner {
  panelId: string;
  kind: PanelKind;
  /** Its panel's title: the browser shows the session's own title when it knows it. */
  title: string;
  paths: string[];
}

/** A session in a handoff, as it was titled when the handoff was planned. */
export interface HandoffSession {
  panelId: string;
  kind: PanelKind;
  title: string;
  /** The session it was planned for, once known: a handoff follows that session, not just its panel. */
  sessionId?: string;
}

/**
 * A handoff a Coordinator planned (ADR 0015): when `from` finishes a turn without asking the user anything,
 * Rails wakes the Coordinator to check the work is done and draft a message for `to`, which the user sends.
 */
export interface Handoff {
  id: string;
  from: HandoffSession;
  to: HandoffSession;
  /** What to pass on, in the user's words. */
  note: string;
  createdAt: string;
}
export const HANDOFF_NOTE_MAX = 300;

/** A Sprocket's description is short on purpose: it goes into every run. */
export const SPROCKET_DESCRIPTION_MAX = 500;
/** At most this many standing rules, each at most SPROCKET_RULE_MAX characters. */
export const SPROCKET_RULES_MAX = 10;
export const SPROCKET_RULE_MAX = 200;

/** Body of "change a Sprocket's settings". Only the fields present change; null clears. */
export interface SprocketSettings {
  projectId?: string | null;
  model?: string | null;
  description?: string;
  /** Replace its standing rules (empty ones are dropped). */
  rules?: string[];
}

/** Body of "create a Sprocket" and "edit a Sprocket". */
export interface SprocketInput {
  name: string;
  look: SprocketLook;
}

/**
 * Who wrote a chat message: the user, the Sprocket, Rails itself (setup hints and errors), or a session
 * event Rails woke a Coordinator with.
 */
/** `pass`: a team member gave a teammate the turn (ADR 0023), shown as a line, not a bubble. */
export type SprocketAuthor = "user" | "sprocket" | "notice" | "event" | "pass";

/** A question a Sprocket asked the user (ADR 0023, ask_user). */
export interface SprocketAsk {
  question: string;
  /** Answers to tap: none (an open question), or ASK_OPTIONS_MIN to ASK_OPTIONS_MAX. */
  options: string[];
  /** What the user answered (a tapped option, or the message they typed instead). */
  answer?: string;
}
export const ASK_OPTIONS_MIN = 2;
export const ASK_OPTIONS_MAX = 4;

/** A question a session asked the user in a dialog (Claude Code's AskUserQuestion, a pi question tool). */
export interface SessionQuestion {
  question: string;
  options: string[];
}

/** What woke a Coordinator: a session in its project is waiting for the user. */
export interface SprocketEvent {
  panelId: string;
  kind: PanelKind;
  /** The panel's title then. */
  title: string;
  sessionId?: string;
  /**
   * It asked in a dialog (or a form), it ended its turn with what looks like a question, it changed files
   * other sessions changed shortly before (ADR 0014), it finished a turn a handoff waits for (ADR 0015), or it
   * drafted a message for another session (ADR 0018), shown under the event, with the text as the event's.
   */
  what: "question" | "turn_end" | "overlap" | "handoff" | "message";
  questions?: SessionQuestion[];
  /** The Coordinator looked and decided the user needn't hear about it. */
  quiet?: boolean;
  /** Rails' rules didn't wake for this; the decision model did (ADR 0013). */
  byModel?: boolean;
  /**
   * For an overlap: the other sessions, and the files each also changed (relative to the project), or, with
   * `owns`, the files it owns (ADR 0016).
   */
  overlaps?: { panelId: string; kind: PanelKind; title: string; sessionId?: string; files: string[]; owns?: boolean }[];
  /** For a handoff: which one, the session it's for and what to pass on. */
  handoff?: { id: string; to: HandoffSession & { sessionId?: string }; note: string };
  /** For a message: the session it's for. */
  to?: HandoffSession;
}

/** One message in a Sprocket's chat. */
export interface SprocketMessage {
  id: string;
  /** The chat's Sprocket; in a team, the member that wrote it (the lead for the user's messages). */
  sprocketId: string;
  chatId: string;
  author: SprocketAuthor;
  text: string;
  createdAt: string;
  /** On a reply: what the Sprocket looked at or did for it ("Looked at the board and read src/api.ts"). */
  activity?: string;
  /** On an event: which session, and what it's waiting for. `text` is the end of its message. */
  event?: SprocketEvent;
  /** On a Coordinator's reply: the replies it suggests sending to sessions. */
  suggestions?: Suggestion[];
  /** On a pass line (author `pass`): the member given the turn. */
  passTo?: string;
  /** On a Sprocket's question to the user (ADR 0023): its options, and the answer once there is one. */
  ask?: SprocketAsk;
}

/**
 * A reply a Coordinator drafted for a session (step 3, ADR 0010). Nothing reaches the session until the
 * user sends it (they can edit it first) or, for a dialog, answers it in the panel.
 */
export interface Suggestion {
  id: string;
  panelId: string;
  kind: PanelKind;
  /** The session's title when it was suggested. */
  title: string;
  sessionId?: string;
  /**
   * "reply": an answer to a question the session ended its turn with, which Rails sends into it; "answer": the
   * option to pick in a dialog, in the panel; "message": something the user asked the Coordinator to pass on,
   * which Rails sends now or, if the session is busy, into its own queue for after its current turn.
   */
  mode: "reply" | "answer" | "message";
  text: string;
  /** The rule it followed, as it read then; none when it used its own judgment. */
  rule?: string;
  /**
   * A handoff's message (ADR 0015) carries what the finished session said last, word for word, sent under the
   * text, so nothing it said gets lost in the Coordinator's summary.
   */
  attachment?: { title: string; text: string };
  /** A message an agent drafted for this session (ADR 0018): the session it came from. */
  from?: { panelId: string; kind: PanelKind; title: string };
  /**
   * "replaced": a newer answer for the same session took its place (it isn't shown), or, for an agent's message,
   * the same agent's newer message for that session (ADR 0018). The Coordinator's messages aren't replaced.
   */
  status: "pending" | "sending" | "sent" | "failed" | "dismissed" | "expired" | "replaced";
  /** The user changed the text before sending it. */
  edited?: boolean;
  /** Why it failed, or why it can't be sent anymore. */
  error?: string;
  /** Sent while the session was busy: it's in the session's own queue, for after its current turn. */
  queued?: boolean;
  createdAt: string;
  /** When its status last changed (sent, dismissed, expired). */
  updatedAt: string;
}

// ---- Settings ----

/** The avatars a Profile can use, in picker order (their images are in the web app). */
export const PROFILE_AVATARS = [
  "interlocking-spiral",
  "crown",
  "linked-squares",
  "four-petals",
  "sparkle",
  "interlocking-paths",
  "split-shield",
  "six-ray-burst",
] as const;
export type ProfileAvatar = (typeof PROFILE_AVATARS)[number];
export const PROFILE_NAME_MAX = 40;

/** The name and avatar at the foot of the sidebar, shared by every device. */
export interface Profile {
  name: string;
  avatar: ProfileAvatar;
  /** The name of the computer Rails runs on: the name when none is set. */
  machineName: string;
}

/** A change to the profile (PUT /api/profile). An empty name goes back to the computer's name. */
export type ProfileChange = Partial<Pick<Profile, "name" | "avatar">>;

/** Facts about the Rails server, for Settings → General. */
export interface ServerInfo {
  /** The address the server listens on (RAILS_HOST) and its port. */
  host: string;
  port: number;
  /** True when other devices can reach it (it listens beyond localhost). */
  network: boolean;
  /** The commit it runs, when it runs from a git checkout. */
  build?: string;
  tmux?: string;
  node: string;
  /** The access token is set with RAILS_TOKEN, so Rails can't replace it. */
  tokenFromEnv: boolean;
}

// ---- Models: what Sprockets run on (ADR 0006). ----

/** A model provider rails can bill Sprockets to, and how it's set up. */
export interface ModelProvider {
  id: string;
  name: string;
  /** How it's set up, or null if it isn't. */
  auth: null | { type: "api_key" | "oauth" };
  /** Label of its sign-in button, for providers that support signing in (e.g. "Continue with ChatGPT"). */
  signIn?: string;
}

/** A model a Sprocket can run on. `ref` is `provider/model`. */
export interface ModelChoice {
  ref: string;
  provider: string;
  name: string;
}

export interface ModelSettings {
  providers: ModelProvider[];
  /** Models of the providers that are set up. */
  models: ModelChoice[];
  /** Used by Sprockets that don't pick their own model. */
  defaultModel?: string;
  /** Fast decision models (classifiers) of the providers that are set up (ADR 0012). */
  classifiers: ModelChoice[];
  /** The one that judges in shadow, if any (off by default: it sends session text to its provider). */
  decisionModel?: string;
  /**
   * Set (by the developer setting `RAILS_DECISIONS=shadow`) when the decision model only judges. Otherwise it may
   * wake the Coordinator where it's sure and Rails' rules weren't (ADR 0013).
   */
  decisionsInShadow: boolean;
  /** How sure the decision model must be to wake the Coordinator for a reply (ADR 0013); a dialog takes DECISION_THRESHOLD.dialogMargin more. */
  decisionThreshold: number;
}

/**
 * The decision model's threshold (ADR 0013), which the user sets in Settings → Models. From its evaluation:
 * messages that asked nothing scored up to 0.78, so below `caution` it starts waking the Coordinator for them,
 * and below `danger` it will often.
 */
export const DECISION_THRESHOLD = { min: 0.5, max: 0.99, default: 0.9, dialogMargin: 0.05, caution: 0.85, danger: 0.8 } as const;

/**
 * One shadow judgment (ADR 0012): what Rails decided in code about a session's moment, and what the fast
 * decision model would have decided. Nothing acts on the model's answer yet.
 */
export interface DecisionEntry {
  id: string;
  at: string;
  panelId: string;
  /** The session's title and agent then. */
  title: string;
  kind: PanelKind;
  /** "turn_end": does the end of its message ask the user something? "dialog": what is a dialog Rails doesn't know? */
  question: "turn_end" | "dialog";
  /** What was judged: the end of the message, or the dialog's title. */
  text: string;
  /** Rails' own decision: "asks" or "doesn't ask" for a turn end, "unknown" for a dialog (it doesn't wake anyone). */
  rails: "asks" | "doesn't ask" | "unknown";
  /** The model's answer: "asks" / "doesn't ask", or the dialog's kind, with its probability (0–1). */
  answer?: { label: string; probability: number };
  /** For a turn end that woke the Coordinator: whether it found something for the user. */
  outcome?: "told you" | "nothing needed";
  /** The model's answer woke the Coordinator where Rails' rules didn't (ADR 0013). */
  acted?: boolean;
  /** The model as the service reported it (versions matter: pin what you calibrate). */
  model?: string;
  latencyMs?: number;
  /** In dollars, when the service reports usage. */
  cost?: number;
  error?: string;
}

/** The shadow log: the latest judgments, and how the turn-end ones compare with Rails' own. */
export interface DecisionLog {
  entries: DecisionEntry[];
  summary: {
    /** Turn ends judged without an error. */
    judged: number;
    agreed: number;
    /** The model says it asks; Rails' code didn't wake anyone (questions Rails may be missing). */
    missed: number;
    /** Rails woke the Coordinator; the model says it doesn't ask. `quiet`: of those, the Coordinator agreed. */
    extra: number;
    quiet: number;
    /** Wakes the model added (it may wake the Coordinator). */
    acted: number;
  };
}

/** A sign-in with a provider in progress. It runs on the server; the browser opens `authUrl`. */
export interface SignIn {
  id: string;
  providerId: string;
  state: "waiting" | "done" | "failed" | "cancelled";
  authUrl?: string;
  /** Signing in again to the account this install signed in to before (no naming or consent screens). */
  sameAccount?: boolean;
  /** Why it failed. */
  error?: string;
}

// ---- WebSocket protocol ----------------------------------------------------
// Each attached panel gets its own tmux client on the server, sized to that browser's terminal.

export type ClientMsg =
  /** `attachId` is unique per attach; output is tagged with it so a terminal can ignore a previous attach's. */
  | { type: "term.attach"; panelId: string; attachId: number; cols: number; rows: number }
  | { type: "term.detach"; panelId: string }
  | { type: "term.input"; panelId: string; data: string }
  | { type: "term.resize"; panelId: string; cols: number; rows: number };

export type ServerMsg =
  | { type: "term.data"; panelId: string; attachId: number; data: string }
  /** A project's panels changed: opened, closed, ended on their own (possibly on another device), or one of its sessions was renamed. */
  | { type: "panels.changed"; projectId: string }
  /** Every busy panel (its agent is thinking or replying), across all projects. Sent on connect and on change. */
  | { type: "panels.busy"; panelIds: string[] }
  /** Every panel that needs the user, across all projects. Sent on connect and on change. */
  | { type: "panels.attention"; panels: { panelId: string; reason: AttentionReason }[] }
  | { type: "panels.overlaps"; overlaps: PanelOverlap[] }
  /** Sprockets or their messages changed (possibly on another device). */
  | { type: "sprockets.changed" }
  /** Agent profiles or saved prompts changed (possibly on another device). */
  | { type: "customize.changed" }
  /** A Sprocket's reply so far, while it's being written; null when it's done. */
  | { type: "sprockets.typing"; sprocketId: string; chatId: string; text: string | null }
  /** While a Sprocket replies: the step it's on ("Reading src/api.ts"), and what it has done so far; null when done. */
  | { type: "sprockets.activity"; sprocketId: string; chatId: string; step: string | null; summary: string | null }
  /** Providers, sign-ins or the default model changed. */
  | { type: "models.changed" }
  /** The fast decision model's shadow log has new judgments (ADR 0012). */
  | { type: "decisions.changed" }
  | { type: "models.signIn"; signIn: SignIn }
  /** The profile. Sent on connect and when it changes (possibly on another device). */
  | { type: "profile.changed"; profile: Profile }
  | { type: "error"; message: string };
