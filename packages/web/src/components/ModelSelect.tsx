import { useCallback, useEffect, useState } from "react";
import type { ModelSettings } from "@rails/shared";
import { api } from "../api.ts";
import { socket } from "../ws.ts";

/** The model settings (providers, models, default), kept fresh across devices. */
export function useModelSettings() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setSettings(await api.models());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "models.changed") void load();
    });
  }, [load]);
  return { settings, error, reload: load };
}

/**
 * A native select of the models of the providers that are set up, grouped by provider. `empty` labels
 * the "no choice" option (e.g. "Use the default model").
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
  const groups = new Map<string, typeof settings.models>();
  for (const m of settings.models) groups.set(m.provider, [...(groups.get(m.provider) ?? []), m]);
  // A saved model whose provider was removed still shows, so the select doesn't silently change.
  const missing = value && !settings.models.some((m) => m.ref === value);
  return (
    <select id={id} className="input" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{empty}</option>
      {missing && <option value={value}>{value} (not available)</option>}
      {[...groups].map(([provider, list]) => (
        <optgroup key={provider} label={names.get(provider) ?? provider}>
          {list.map((m) => (
            <option key={m.ref} value={m.ref}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
