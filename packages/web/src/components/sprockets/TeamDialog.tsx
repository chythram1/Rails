import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconPlus as Plus, IconStarFilled as Star } from "@tabler/icons-react";
import { TEAM_MEMBERS_MAX, TEAM_MEMBERS_MIN, type Project, type Sprocket as SprocketData, type SprocketTeam } from "@rails/shared";
import { api } from "../../api.ts";
import { MenuButton } from "../Menu.tsx";
import { Sprocket } from "./Sprocket.tsx";

const NAME_MAX = 40;

interface Props {
  /** The team to edit; none to make one. */
  team?: SprocketTeam;
  /** Every Sprocket, to pick members from. */
  all: SprocketData[];
  projects: Project[];
  onSaved(team: SprocketTeam): void;
  onClose(): void;
  /** Where focus goes once it closes, when what opened it (a menu item) is gone. */
  returnFocus?(): HTMLElement | null;
}

/**
 * Make or edit a team chat (ADR 0022), in the small dialog's frame: a name, then four member slots, two to a row.
 * The first slot is the lead's, marked with a star; a filled slot's menu makes its Sprocket the lead or takes it
 * out, an empty one's adds a Sprocket.
 */
export function TeamDialog({ team, all, projects, onSaved, onClose, returnFocus }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const slots = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(team?.name ?? "");
  const [members, setMembers] = useState<string[]>(team?.members.filter((id) => all.some((s) => s.id === id)) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    input.current!.focus();
    return () => (d.close(), returnFocus?.()?.focus());
  }, []);

  const byId = (id: string) => all.find((s) => s.id === id);
  const where = (s: SprocketData) => projects.find((p) => p.id === s.projectId)?.name ?? "General";
  /** A pick closes the menu without putting focus back, and the slot it was in may be gone: focus slot `i`. */
  const focusSlot = (i: number) => requestAnimationFrame(() => slots.current?.querySelectorAll<HTMLButtonElement>(".sp-slot")[i]?.focus());
  const change = (next: string[], focus: number) => {
    setMembers(next);
    setError("");
    focusSlot(Math.min(focus, TEAM_MEMBERS_MAX - 1));
  };
  const available = all.filter((s) => !members.includes(s.id));
  const ready = name.trim() && members.length >= TEAM_MEMBERS_MIN;

  const save = async () => {
    if (!ready) return setError(name.trim() ? "Add at least two Sprockets." : "Give the team a name.");
    setBusy(true);
    try {
      const body = { name, members };
      onSaved(team ? await api.updateTeam(team.id, body) : await api.createTeam(body));
      onClose();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialog}
      className="small-dialog"
      aria-labelledby="team-title"
      aria-describedby="team-desc"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <h2 id="team-title">{team ? "Edit team" : "New team"}</h2>
        <p id="team-desc" className="small-dialog-desc">
          Your messages go to the lead unless you @mention someone. A reply can pass the turn on by mentioning another member.
        </p>
        <label className="sp-field-label" htmlFor="team-name">Name</label>
        <input
          id="team-name"
          ref={input}
          className="input"
          autoComplete="off"
          value={name}
          maxLength={NAME_MAX}
          placeholder="e.g. Launch crew"
          onChange={(e) => (setName(e.target.value), setError(""))}
        />
        <p id="team-members-label" className="sp-field-label sp-slots-label">
          Sprockets <span className="muted">· two to four, the first leads</span>
        </p>
        <div ref={slots} className="sp-slots" role="team" aria-labelledby="team-members-label">
          {Array.from({ length: TEAM_MEMBERS_MAX }, (_, i) => {
            const s = members[i] ? byId(members[i]) : undefined;
            if (s)
              return (
                <MenuButton
                  key={s.id}
                  plain
                  className="sp-slot"
                  label={`${s.name}${i === 0 ? ", the lead" : ""}. Change`}
                  title={s.name}
                  icon={
                    <>
                      <span className="sp-slot-face">
                        <Sprocket look={s.look} size={28} seed={s.id} still />
                        {i === 0 && (
                          <span className="sp-lead-badge">
                            <Star size={8} />
                          </span>
                        )}
                      </span>
                      <span className="sp-slot-text">
                        <span className="truncate">{s.name}</span>
                        <span className="muted small truncate">{i === 0 ? "Lead" : where(s)}</span>
                      </span>
                    </>
                  }
                  items={[
                    { label: "Make lead", disabled: i === 0, onSelect: () => change([s.id, ...members.filter((m) => m !== s.id)], 0) },
                    { label: "Remove from team", danger: true, onSelect: () => change(members.filter((m) => m !== s.id), members.length - 1) },
                  ]}
                />
              );
            // Only the first empty slot adds; the ones after it wait their turn.
            const next = i === members.length;
            return next ? (
              <MenuButton
                key={`empty-${i}`}
                plain
                className="sp-slot empty"
                label={i === 0 ? "Add the lead" : "Add a Sprocket"}
                icon={
                  <>
                    <Plus size={16} aria-hidden />
                    <span>{i === 0 ? "Add the lead" : "Add a Sprocket"}</span>
                  </>
                }
                items={
                  available.length
                    ? available.map((a) => ({ label: a.name, note: where(a), icon: <Sprocket look={a.look} size={18} seed={a.id} still />, onSelect: () => change([...members, a.id], i) }))
                    : [{ label: "Every Sprocket is in", disabled: true, onSelect: () => {} }]
                }
              />
            ) : (
              <span key={`empty-${i}`} className="sp-slot empty idle" aria-hidden />
            );
          })}
        </div>
        {error && <p className="error small" role="alert">{error}</p>}
        <div className="small-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{team ? "Save" : "Create team"}</button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
