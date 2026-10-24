import { useState } from "react";
import { api } from "../../api.ts";
import { ModelSelect, useModelSettings } from "../ui/ModelSelect.tsx";
import { useOpenSettings } from "./context.ts";
import { DecisionsSettings } from "./DecisionsSettings.tsx";

/**
 * Settings → Models (ADR 0006, 0012): which models to use: the Sprockets' default model and the fast decision
 * model. They come from the providers connected under Providers, which a link leads to while there are none.
 */
export function ModelsSettings() {
  const { settings, error } = useModelSettings();
  const openSettings = useOpenSettings();
  const [saveError, setSaveError] = useState("");

  if (!settings) return error ? <p className="error" role="alert">{error}</p> : null;

  const setDefault = async (ref: string | null) => {
    setSaveError("");
    try {
      await api.setDefaultModel(ref);
    } catch (e: any) {
      setSaveError(e.message);
    }
  };

  return (
    <>
      <section className="set-group" aria-labelledby="sprockets-title">
        <h3 id="sprockets-title">Sprockets</h3>
        <div className="set-row" id="setting-default-model" data-settings-row tabIndex={-1}>
          <div className="set-text">
            <label htmlFor="default-model">Default model</label>
            <p>
              {settings.models.length ? (
                "Used by Sprockets that don't pick their own."
              ) : (
                <>
                  No models yet.{" "}
                  <button type="button" className="link" onClick={() => openSettings("providers")}>
                    Connect a provider
                  </button>
                </>
              )}
            </p>
          </div>
          <ModelSelect
            id="default-model"
            settings={settings}
            value={settings.defaultModel}
            empty="None"
            disabled={!settings.models.length}
            onChange={(ref) => void setDefault(ref)}
          />
        </div>
        {saveError && <p className="error" role="alert">{saveError}</p>}
      </section>

      <DecisionsSettings settings={settings} />
    </>
  );
}
