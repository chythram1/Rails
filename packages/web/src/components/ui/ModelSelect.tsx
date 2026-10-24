import { useLive } from "./useLive.ts";
import type { ModelSettings } from "@rails/shared";
import { api } from "../../api.ts";
import { Dropdown, type DropdownOption } from "./Dropdown.tsx";

/**
 * The model settings last fetched. The server can take a moment to answer (it asks providers which models they
 * have), so a panel that opens again shows these at once while it checks for changes.
 */
let cached: ModelSettings | null = null;
let fetching: Promise<ModelSettings> | null = null;

/** Fetch the model settings (one request at a time) and keep them for the next panel that opens. */
export function fetchModelSettings(): Promise<ModelSettings> {
  fetching ??= api
    .models()
    .then((s) => (cached = s))
    .finally(() => (fetching = null));
  return fetching;
}

/** The model settings (providers, models, default), kept fresh across devices. */
export function useModelSettings() {
  const { data: settings, error, reload } = useLive(fetchModelSettings, (m) => m.type === "models.changed", { initial: cached });
  return { settings, error, reload };
}

/**
 * The models of the providers that are set up, grouped by provider, in a Dropdown. `empty` labels the
 * "no choice" option (e.g. "Default (…)").
 */
export function ModelSelect({
  id,
  settings,
  value,
  empty,
  onChange,
  disabled,
}: {
  id: string;
  settings: ModelSettings;
  value: string | undefined;
  empty: string;
  onChange(ref: string | null): void;
  disabled?: boolean;
}) {
  const names = new Map(settings.providers.map((p) => [p.id, p.name]));
  const options: DropdownOption[] = [
    { value: "", label: empty },
    // A saved model whose provider was removed still shows, so the choice doesn't silently change.
    ...(value && !settings.models.some((m) => m.ref === value) ? [{ value, label: `${value} (not available)` }] : []),
    ...settings.models.map((m) => ({ value: m.ref, label: m.name, group: names.get(m.provider) ?? m.provider })),
  ];
  return <Dropdown id={id} value={value ?? ""} options={options} disabled={disabled} onChange={(v) => onChange(v || null)} />;
}
