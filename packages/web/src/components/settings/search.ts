// Settings search, modelled on claude.ai's: a registry of every searchable setting row (its section, label
// and synonyms), searched by words, and each row in the page marked with `data-settings-row` and the id
// `setting-<rowId>` so a result can open its section, scroll to the row and focus the row's control.
import type { ModelProvider } from "@rails/shared";

export type SettingsSection = "general" | "models" | "account";

export const SECTION_LABELS: Record<SettingsSection, string> = { general: "General", models: "Models", account: "Account" };

export interface SettingEntry {
  section: SettingsSection;
  rowId: string;
  label: string;
  /** Other words people might search for (claude.ai calls them search phrases). */
  phrases?: string[];
}

/** The rows of each section, in page order. A new setting row gets an entry here and the matching id. */
export const SETTINGS: SettingEntry[] = [
  { section: "general", rowId: "reachable", label: "Reachable from", phrases: ["network", "LAN", "Tailscale", "other devices", "remote", "phone", "RAILS_HOST", "listen"] },
  { section: "general", rowId: "browser-address", label: "This browser uses", phrases: ["address", "URL", "host", "port"] },
  { section: "general", rowId: "version", label: "Version", phrases: ["commit", "build", "update"] },
  { section: "general", rowId: "tmux", label: "tmux", phrases: ["terminal", "panels"] },
  { section: "general", rowId: "node", label: "Node.js", phrases: ["runtime"] },
  { section: "models", rowId: "default-model", label: "Default model", phrases: ["model", "LLM", "Sprocket model"] },
  { section: "models", rowId: "decision-model", label: "Decision model", phrases: ["fast decisions", "System 1", "classifier", "Jev", "TypeSafe", "GPT-6 Luna", "shadow log"] },
  { section: "account", rowId: "avatar", label: "Avatar", phrases: ["profile", "picture", "photo", "icon"] },
  { section: "account", rowId: "name", label: "Name", phrases: ["profile", "display name", "computer name", "machine", "rename"] },
  { section: "account", rowId: "sign-out", label: "Sign out on this device", phrases: ["log out", "logout", "sign off"] },
  { section: "account", rowId: "sign-out-everywhere", label: "Sign out everywhere", phrases: ["log out all devices", "access token", "new token", "reset token", "security", "lost device"] },
];

/** Extra words for provider rows, by provider id. */
const PROVIDER_PHRASES: Record<string, string[]> = {
  openai: ["ChatGPT", "GPT", "Continue with ChatGPT", "ChatGPT plan"],
  anthropic: ["Claude"],
  google: ["Gemini"],
  xai: ["Grok"],
  openrouter: ["Sign in with OpenRouter"],
  typesafe: ["Jev", "System 1", "classifier", "fast decisions"],
};

/** The provider rows of Settings → Models, which come from the server. */
export const providerEntries = (providers: ModelProvider[]): SettingEntry[] =>
  providers.map((p) => ({
    section: "models",
    rowId: `provider-${p.id}`,
    label: p.name,
    phrases: ["provider", "API key", ...(p.signIn ? ["sign in"] : []), ...(PROVIDER_PHRASES[p.id] ?? [])],
  }));

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}_.]+/u).filter(Boolean);

/**
 * Entries whose label, synonyms or section match every word of the query (a word matches the start of a
 * word, so "sign ever" finds "Sign out everywhere"). Matches in the label come first.
 */
export function searchSettings(query: string, entries: SettingEntry[]): SettingEntry[] {
  const q = words(query);
  if (!q.length) return [];
  const scored: { e: SettingEntry; score: number }[] = [];
  for (const e of entries) {
    const label = words(e.label);
    const other = [...(e.phrases ?? []).flatMap(words), ...words(SECTION_LABELS[e.section])];
    let score = 0;
    const all = q.every((w) => {
      if (label.some((x) => x.startsWith(w))) return (score += 2);
      return other.some((x) => x.startsWith(w)) && ++score;
    });
    if (all) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.e);
}
