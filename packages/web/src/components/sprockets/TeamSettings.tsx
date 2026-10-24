import { useEffect, useRef, useState } from "react";
import { IconChevronLeft as ChevronLeft, IconLayoutSidebarRight as PanelRight } from "@tabler/icons-react";
import { TEAM_MEMBERS_MIN, type Sprocket as SprocketData, type SprocketTeam } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { MemberSlots, TEAM_NAME_MAX } from "./TeamDialog.tsx";

/** The button that opens and closes a team's settings panel, as a Sprocket's PanelToggle does. */
export function TeamPanelToggle({ team, open }: { team: SprocketTeam; open: boolean }) {
  return (
    <a
      className={"icon-btn sp-panel-toggle" + (open ? " active" : "")}
      href={open ? href.team(team.id) : href.teamSettings(team.id)}
      aria-label={`${team.name} settings`}
      aria-expanded={open}
      title={open ? "Close settings" : "Settings"}
    >
      <PanelRight size={18} />
    </a>
  );
}

/**
 * A team's panel beside its chat (ADR 0022), in the frame of a Sprocket's: its name, its members (the first stands in front in its face),
 * and Delete at the end. Everything saves as you go, and a quiet "Saved" in the header confirms it. It has its own
 * URL (`#/sprockets/teams/<id>/settings`); its toggle, Escape or the browser's back button close it.
 */
export function TeamSettings({ team, all }: { team: SprocketTeam; all: SprocketData[] }) {
  const { projects } = useStore();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const close = () => navigate(href.team(team.id));

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  const save = async (body: { name?: string; members?: string[] }) => {
    try {
      await api.updateTeam(team.id, { name: body.name ?? team.name, members: body.members ?? team.members });
      setError("");
      setSaved(Date.now());
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  return (
    <aside className="sp-panel" aria-labelledby="sp-panel-title" onKeyDown={(e) => e.key === "Escape" && !deleting && close()}>
      <header className="sp-panel-head">
        <div className="sp-panel-start">
          <button className="icon-btn sp-panel-back" aria-label={`Back to ${team.name}`} onClick={close}>
            <ChevronLeft size={18} />
          </button>
        </div>
        <h2 id="sp-panel-title" className="sr-only">{team.name} settings</h2>
        <div className="sp-panel-end">
          <span className="sp-saved muted small" role="status">{saved ? "Saved" : ""}</span>
          <TeamPanelToggle team={team} open />
        </div>
      </header>
      <div className="sp-panel-body">
        <section className="sp-section" aria-label="Team">
          <NameField team={team} onSave={(name) => save({ name })} />
          <div className="settings-field">
            <p id="team-panel-members" className="sp-field-label">Sprockets</p>
            <MemberSlots members={team.members} all={all} projects={projects} labelledBy="team-panel-members" keep={TEAM_MEMBERS_MIN} onChange={(members) => void save({ members })} />
            <p className="muted small">Two to four. Each reads every message and answers when it has something to add.</p>
          </div>
        </section>
        <div className="sp-danger-zone">
          <button ref={deleteButton} type="button" className="btn small danger" onClick={() => setDeleting(true)}>
            Delete team
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {deleting && (
        <ConfirmDialog
          title="Delete this team?"
          text={`${team.name} and its chat are deleted, on every device. Its Sprockets stay, with their own chats and memory.`}
          action="Delete team"
          danger
          onConfirm={async () => {
            await api.deleteTeam(team.id);
            navigate(href.sprockets());
          }}
          onClose={() => setDeleting(false)}
          returnFocus={() => deleteButton.current}
        />
      )}
    </aside>
  );
}

/** The name, saved when the field loses focus (or on Enter); Escape puts it back. */
function NameField({ team, onSave }: { team: SprocketTeam; onSave(name: string): Promise<boolean> }) {
  const [value, setValue] = useState(team.name);
  useEffect(() => setValue(team.name), [team.name]);
  const commit = async () => {
    const next = value.trim();
    if (!next || next === team.name) return setValue(team.name);
    if (!(await onSave(next))) setValue(team.name);
  };
  return (
    <div className="settings-field">
      <label htmlFor="team-panel-name">Name</label>
      <input
        id="team-panel-name"
        className="input"
        maxLength={TEAM_NAME_MAX}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && value !== team.name) {
            e.stopPropagation(); // put it back; a second Escape closes the panel
            setValue(team.name);
          }
        }}
      />
    </div>
  );
}
