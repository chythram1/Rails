// What Sprockets run on (ADR 0006): model providers, their credentials and the default model, through
// pi-ai. Only credentials stored here count; rails ignores provider env vars (OPENAI_API_KEY, …) so it
// never bills a key the user set for something else.
import { randomUUID } from "node:crypto";
import { createModels, type Api, type ClassifierApi, type ClassifierModel, type Model, type Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { groqProvider } from "@earendil-works/pi-ai/providers/groq";
import { mistralProvider } from "@earendil-works/pi-ai/providers/mistral";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { typesafeProvider } from "@earendil-works/pi-ai/providers/typesafe";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import type { ModelChoice, ModelProvider, ModelSettings, SignIn } from "@rails/shared";
import { fileCredentialStore } from "./credentials.ts";
import { settings } from "./db.ts";
import { decisionsInShadow } from "./config.ts";
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
  // Only a fast decision model (Jev, ADR 0012): no chat models, so it never shows in a Sprocket's model list.
  { make: typesafeProvider },
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
/** For settings that live elsewhere but show in Settings → Models (decisions.ts). */
export const modelsChanged = changed;

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
  return { providers, models: choices, defaultModel: settings.get("defaultModel"), classifiers: await classifierChoices(), decisionModel: settings.get("decisionModel"), decisionsInShadow: decisionsInShadow() };
}

// ---- Checking a key before it's saved: a request that costs nothing (listing models, or the key's own info),
// sent only to the key's provider. TypeSafe has none, so it gets one tiny classification (about $0.00002).

/** How long a provider has to answer a key check. */
const CHECK_MS = 8000;
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const KEY_CHECKS: Record<string, (key: string) => Request> = {
  openai: (k) => new Request("https://api.openai.com/v1/models", { headers: bearer(k) }),
  anthropic: (k) => new Request("https://api.anthropic.com/v1/models", { headers: { "x-api-key": k, "anthropic-version": "2023-06-01" } }),
  openrouter: (k) => new Request("https://openrouter.ai/api/v1/key", { headers: bearer(k) }),
  google: (k) => new Request("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": k } }),
  xai: (k) => new Request("https://api.x.ai/v1/models", { headers: bearer(k) }),
  mistral: (k) => new Request("https://api.mistral.ai/v1/models", { headers: bearer(k) }),
  groq: (k) => new Request("https://api.groq.com/openai/v1/models", { headers: bearer(k) }),
  deepseek: (k) => new Request("https://api.deepseek.com/models", { headers: bearer(k) }),
};

/** What a provider said about a key: it works, it's refused, or it couldn't be told. */
export type KeyCheck = { verdict: "ok" } | { verdict: "rejected" } | { verdict: "unknown"; reason: string };

/** Ask the provider whether a key works, without using it for anything else. */
export async function checkKey(providerId: string, key: string, fetchFn: typeof fetch = fetch): Promise<KeyCheck> {
  const signal = AbortSignal.timeout(CHECK_MS);
  try {
    if (providerId === "typesafe") {
      const jev = models.getModelsOfType("classifier", "typesafe")[0];
      if (!jev) return { verdict: "unknown", reason: "it has no model to check with" };
      const question = { type: "bool" as const, instructions: "Is this a greeting?", criteria: { true: "It is.", false: "It isn't." } };
      const r = await models.classify(jev, { state: { text: "hello" }, questions: { check: question } }, { apiKey: key, signal });
      if (r.stopReason === "stop") return { verdict: "ok" };
      return /\b(401|403)\b|unauthori[sz]ed|invalid api key|forbidden/i.test(r.errorMessage ?? "") ? { verdict: "rejected" } : { verdict: "unknown", reason: r.errorMessage ?? "no answer" };
    }
    const make = KEY_CHECKS[providerId];
    if (!make) return { verdict: "unknown", reason: "Rails can't check its keys" };
    const res = await fetchFn(make(key), { signal });
    if (res.ok) return { verdict: "ok" };
    if (res.status === 401 || res.status === 403) return { verdict: "rejected" };
    if (res.status === 429) return { verdict: "unknown", reason: "it's rate-limiting this key, or the key is out of credit" };
    return { verdict: "unknown", reason: `it answered ${res.status}` };
  } catch (e) {
    return { verdict: "unknown", reason: signal.aborted ? "it didn't answer in time" : "Rails couldn't reach it" };
  }
}

/**
 * Save a provider's API key, once the provider has accepted it. A key it refuses isn't saved; one it couldn't
 * be asked about is saved, and `note` says so.
 */
export async function setApiKey(providerId: string, rawKey: unknown, check: (providerId: string, key: string) => Promise<KeyCheck> = checkKey): Promise<{ note?: string }> {
  const p = provider(providerId);
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!key) throw new ServiceError("Enter an API key.", 400);
  const result = await check(providerId, key);
  if (result.verdict === "rejected") throw new ServiceError(`${p.name} rejected this key. Check that you copied all of it, and that it's still active.`, 400);
  await credentials.modify(providerId, async () => ({ type: "api_key", key }));
  openaiChanged(providerId);
  changed();
  return result.verdict === "unknown" ? { note: `Saved, but Rails couldn't check it: ${result.reason}.` } : {};
}

export async function removeCredential(providerId: string): Promise<void> {
  provider(providerId);
  const stored = await credentials.read(providerId);
  if (providerId === "openai" && stored?.type === "oauth" && typeof stored.clientId === "string") settings.set(CHATGPT_CLIENT, stored.clientId);
  await models.logout(providerId);
  openaiChanged(providerId);
  changed();
}

/** The fast decision models (classifiers) of the providers that are set up (ADR 0012). */
export async function classifierChoices(): Promise<ModelChoice[]> {
  const available = await models.getAvailableOfType("classifier").catch(() => []);
  return available.map((m) => ({ ref: `${m.provider}/${m.id}`, provider: m.provider, name: m.name }));
}

/** The classifier a `provider/model` ref names (whether its provider is set up shows when it's called). */
export function findClassifier(ref: string): ClassifierModel<ClassifierApi> | undefined {
  const slash = ref.indexOf("/");
  return slash > 0 ? models.getModelsOfType("classifier", ref.slice(0, slash)).find((m) => m.id === ref.slice(slash + 1)) : undefined;
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
