import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconSearch as Search } from "@tabler/icons-react";
import type { SkillInfo, SkillRef, SkillSource } from "@rails/shared";
import { api } from "../../api.ts";

const key = (r: SkillRef) => `${r.source}:${r.name}`;
const GROUPS: { source: SkillSource; title: string }[] = [
  { source: "library", title: "Library" },
  { source: "user", title: "Your skills" },
  { source: "project", title: "Projects" },
];

/** Where a skill comes from, in words: "Library", "Your skills", or the projects that have it. */
export function sourceLabel(s: Pick<SkillInfo, "ref"> & { projects?: string[] }): string {
  if (s.ref.source === "library") return "Library";
  if (s.ref.source === "user") return "Your skills";
  return s.projects?.length ? s.projects.join(", ") : "Project";
}

/**
 * "Choose skills": a modal over the editor with every skill Rails found, grouped by where it's from, each a
 * checkbox. Save replaces the profile's skills with what's checked; skills that can't be found anymore stay
 * until they're removed in the editor. "Import from folder…" copies a skill folder into the library, picked in
 * the native folder picker on the server's screen (ADR 0004).
 */
export function SkillPicker(props: {
  profileName: string;
  chosen: SkillRef[];
  skills: SkillInfo[] | null;
  onReload(): Promise<void>;
  onSave(next: SkillRef[]): Promise<boolean>;
  onClose(): void;
}) {
  const { profileName, chosen, skills, onReload, onSave, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState(() => new Set(chosen.map(key)));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    d.querySelector<HTMLInputElement>("input[type=search]")?.focus();
    return () => d.close();
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: SkillInfo) => !q || s.ref.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    return GROUPS.map((g) => ({ ...g, list: (skills ?? []).filter((s) => s.ref.source === g.source && match(s)) })).filter((g) => g.list.length);
  }, [skills, query]);

  const toggle = (k: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const save = async () => {
    setBusy(true);
    const known = new Set((skills ?? []).map((s) => key(s.ref)));
    // Keep the profile's order: what it had (still checked, or not found here), then what's new.
    const kept = chosen.filter((r) => checked.has(key(r)) || !known.has(key(r)));
    const added = (skills ?? []).filter((s) => checked.has(key(s.ref)) && !chosen.some((r) => key(r) === key(s.ref))).map((s) => s.ref);
    if (await onSave([...kept, ...added])) onClose();
    else setBusy(false);
  };

  const importFolder = async () => {
    setImporting(true);
    setError("");
    try {
      const { skill } = await api.importSkill();
      if (skill) {
        await onReload();
        setChecked((prev) => new Set(prev).add(key(skill.ref)));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="cz-dialog"
      aria-labelledby="cz-picker-title"
      aria-describedby="cz-picker-desc"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <p className="eyebrow">{profileName}</p>
        <h2 id="cz-picker-title">Choose skills</h2>
        <p id="cz-picker-desc" className="muted small">
          Checked skills load in this profile's panels. A project's skills load only in that project.
        </p>
        <label className="sp-search cz-picker-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Search" aria-label="Search skills" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="cz-picker-list">
          {!skills ? (
            <p className="muted small pad">Looking for skills…</p>
          ) : !skills.length ? (
            <p className="muted small pad">No skills found. Import a skill's folder, or add skills to ~/.claude/skills or a project's .claude/skills.</p>
          ) : !groups.length ? (
            <p className="muted small pad">No skills match “{query.trim()}”.</p>
          ) : (
            groups.map((g) => (
              <section key={g.source} aria-labelledby={`cz-picker-${g.source}`}>
                <h3 id={`cz-picker-${g.source}`} className="menu-heading">{g.title}</h3>
                {g.list.map((s) => {
                  const k = key(s.ref);
                  return (
                    <label key={k} className="cz-pick">
                      <input type="checkbox" checked={checked.has(k)} onChange={() => toggle(k)} />
                      <span className="cz-item-text">
                        <span className="cz-item-top">
                          <span className="cz-item-name truncate">{s.ref.name}</span>
                          {s.ref.source === "project" && <span className="cz-source truncate">{sourceLabel(s)}</span>}
                        </span>
                        <span className="cz-item-desc" title={s.description}>
                          {s.manual ? "You run it with a slash command. " : ""}
                          {s.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </section>
            ))
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="cz-dialog-foot">
          <button type="button" className="btn small" disabled={importing} onClick={() => void importFolder()} title="Opens a folder picker on the computer Rails runs on">
            {importing ? "Choose a folder in the window that opened…" : "Import from folder…"}
          </button>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </dialog>
  );
}
