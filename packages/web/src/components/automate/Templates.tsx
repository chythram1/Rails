import { useState } from "react";
import { IconCheck as Check, IconFolder as Folder, IconLayoutGrid as Grid, IconPlus as Plus } from "@tabler/icons-react";
import { connectorById, scheduleText, type McpServer, type Sprocket as SprocketData } from "@rails/shared";
import { href } from "../../router.ts";
import { ConnectorGlyph, ConnectorLogo } from "../customize/ConnectorLogo.tsx";
import { TEMPLATE_GROUPS, TEMPLATES, type AutomationTemplate, type TemplateUse } from "./templates.ts";

/** A use's name: "Project", or the connector's ("Linear"). */
export const useName = (u: TemplateUse) => (u === "project" ? "Project" : (connectorById(u)?.name ?? u));

/** Whether a use is here: a Sprocket with a project, or the connector added in Customize. */
function hasUse(u: TemplateUse, servers: McpServer[], sprockets: SprocketData[]) {
  return u === "project" ? sprockets.some((s) => s.projectId) : servers.some((s) => s.connector === u);
}

function UseGlyph({ use, size }: { use: TemplateUse; size: number }) {
  return use === "project" ? <Folder size={size} stroke={1.6} aria-hidden /> : <ConnectorGlyph id={use} size={size} />;
}

/** A template's mark: its one connector's (or a folder), or for two or more, the first two overlapping. */
function TemplateMark({ uses }: { uses: TemplateUse[] }) {
  const tile = (u: TemplateUse, size: number) =>
    u === "project" ? (
      <span className="cz-logo cz-logo-soft" style={{ "--size": `${size}px` } as React.CSSProperties} aria-hidden>
        <Folder size={Math.round(size * 0.5)} stroke={1.6} />
      </span>
    ) : (
      <ConnectorLogo id={u} size={size} />
    );
  if (uses.length === 1) return tile(uses[0], 40);
  return (
    <span className="au-tpl-mark" aria-hidden>
      {tile(uses[0], 24)}
      {tile(uses[1], 24)}
    </span>
  );
}

/**
 * Automate's templates: chips to show only those using one thing (a connector, or the project), then starting points
 * in groups. A card opens a new automation filled in from it. What it uses is a chip each with its mark: "Connected"
 * when it's here, dashed and muted when not (never a warning: setting it up is part of starting one).
 */
export function Templates({ query, servers, sprockets }: { query: string; servers: McpServer[]; sprockets: SprocketData[] }) {
  const [only, setOnly] = useState<TemplateUse | "">("");
  const q = query.trim().toLowerCase();
  const chips = [...new Set(TEMPLATES.flatMap((t) => t.uses))];
  const shown = TEMPLATES.filter(
    (t) =>
      (!only || t.uses.includes(only)) && (!q || [t.name, t.category, t.description, t.prompt, ...t.uses.map(useName)].some((x) => x.toLowerCase().includes(q))),
  );
  return (
    <>
      <div className="au-chips" role="group" aria-label="Show templates that use">
        <button type="button" className="au-chip" aria-pressed={!only} onClick={() => setOnly("")}>
          <Grid size={14} aria-hidden /> All
        </button>
        {chips.map((u) => (
          <button key={u} type="button" className="au-chip" aria-pressed={only === u} onClick={() => setOnly(only === u ? "" : u)}>
            <UseGlyph use={u} size={14} /> {useName(u)}
          </button>
        ))}
      </div>
      {!shown.length && <p className="muted cz-none">No template matches{q ? ` “${query.trim()}”` : ""}.</p>}
      {TEMPLATE_GROUPS.filter((g) => shown.some((t) => t.group === g.id)).map((g) => {
        const list = shown.filter((t) => t.group === g.id);
        return (
          <section key={g.id} className="cz-section" aria-labelledby={`au-tpl-${g.id}`}>
            <div className="cz-section-head">
              <h2 id={`au-tpl-${g.id}`}>
                {g.title}
                <span className="cz-count">{list.length}</span>
              </h2>
              <p className="cz-section-blurb">{g.blurb}</p>
            </div>
            <ul className="cz-cards">
              {list.map((t) => (
                <TemplateCard key={t.id} t={t} servers={servers} sprockets={sprockets} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function TemplateCard({ t, servers, sprockets }: { t: AutomationTemplate; servers: McpServer[]; sprockets: SprocketData[] }) {
  return (
    <li className="cz-card au-tpl">
      <TemplateMark uses={t.uses} />
      <div className="cz-card-text">
        <span className="cz-card-title">
          <a className="cz-card-name" href={href.newAutomation(t.id)}>
            {t.name}
          </a>
          <span className="cz-card-kind">
            {t.category} · {scheduleText(t.schedule)}
          </span>
        </span>
        <p className="cz-card-desc">{t.description}</p>
        <ul className="au-tags au-tpl-tags" aria-label="Uses">
          {t.uses.map((u) => {
            const here = hasUse(u, servers, sprockets);
            return (
              <li key={u} className={here ? "au-tag" : "au-tag au-tag-quiet"} title={here ? undefined : u === "project" ? "Attach a Sprocket to a project" : `Add ${useName(u)} in Customize`}>
                <UseGlyph use={u} size={14} />
                {useName(u)}
                {here && (
                  <span className="au-tag-ok">
                    <Check size={12} aria-hidden /> {u === "project" ? "Ready" : "Connected"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <span className="icon-btn cz-plus cz-card-action" aria-hidden>
        <Plus size={16} />
      </span>
    </li>
  );
}
