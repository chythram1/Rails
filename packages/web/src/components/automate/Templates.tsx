import { IconFolder as Folder } from "@tabler/icons-react";
import { connectorById, scheduleText, type McpServer, type Sprocket as SprocketData } from "@rails/shared";
import { href } from "../../router.ts";
import { ConnectorLogo } from "../customize/ConnectorLogo.tsx";
import { TEMPLATE_GROUPS, TEMPLATES, type AutomationTemplate } from "./templates.ts";

/** What a template needs, and whether it's here: a Sprocket with a project, or the connector added in Customize. */
export function needs(t: AutomationTemplate, servers: McpServer[], sprockets: SprocketData[]): { name: string; missing?: string } {
  if (t.uses === "project") return { name: "Your project", missing: sprockets.some((s) => s.projectId) ? undefined : "No Sprocket has a project" };
  const c = connectorById(t.uses);
  const name = c?.name ?? t.uses;
  return { name, missing: servers.some((s) => s.connector === t.uses) ? undefined : `Add ${name} first` };
}

/**
 * Automate's templates: starting points in groups, each a card that opens a new automation filled in from it. A card
 * says when it runs and what it uses, and in red when that isn't here yet (it still opens, to see and change it).
 */
export function Templates({ query, servers, sprockets }: { query: string; servers: McpServer[]; sprockets: SprocketData[] }) {
  const q = query.trim().toLowerCase();
  const shown = TEMPLATES.filter((t) => !q || [t.name, t.description, t.prompt, needs(t, servers, sprockets).name].some((x) => x.toLowerCase().includes(q)));
  if (!shown.length) return <p className="muted cz-none">No template matches “{query.trim()}”.</p>;
  return (
    <>
      {TEMPLATE_GROUPS.filter((g) => shown.some((t) => t.group === g.id)).map((g) => (
        <section key={g.id} className="cz-section" aria-labelledby={`au-tpl-${g.id}`}>
          <div className="cz-section-head">
            <h2 id={`au-tpl-${g.id}`}>{g.title}</h2>
            <p className="cz-section-blurb">{g.blurb}</p>
          </div>
          <ul className="cz-cards">
            {shown
              .filter((t) => t.group === g.id)
              .map((t) => {
                const need = needs(t, servers, sprockets);
                return (
                  <li key={t.id} className="cz-card">
                    {t.uses === "project" ? (
                      <span className="cz-logo" aria-hidden>
                        <Folder size={20} stroke={1.6} />
                      </span>
                    ) : (
                      <ConnectorLogo id={t.uses} />
                    )}
                    <div className="cz-card-text">
                      <span className="cz-card-title">
                        <a className="cz-card-name" href={href.newAutomation(t.id)}>
                          {t.name}
                        </a>
                        <span className="cz-card-kind">
                          {scheduleText(t.schedule)} · {need.missing ? <span className="cz-card-warn">{need.missing}</span> : need.name}
                        </span>
                      </span>
                      <p className="cz-card-desc">{t.description}</p>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </>
  );
}
