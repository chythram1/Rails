import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconPlus as Plus, IconStarFilled as Star } from "@tabler/icons-react";
import { TEAM_MEMBERS_MAX, TEAM_MEMBERS_MIN, type Project, type Sprocket as SprocketData, type SprocketTeam } from "@rails/shared";
import { api } from "../../api.ts";
import { MenuButton } from "../Menu.tsx";
import { Sprocket } from "./Sprocket.tsx";

export const TEAM_NAME_MAX = 40;

/**
 * A team's four member slots (ADR 0022), two to a row: the first is the lead's, marked with a star. A filled slot's
 * menu makes its Sprocket the lead or takes it out; the next empty one's adds a Sprocket. `onChange` gets the new
 * members, lead first. Used by the New team dialog and the team's settings panel, which saves each change and so
 * keeps at least `keep` members.
 */
export function MemberSlots(props: { members: string[]; all: SprocketData[]; projects: Project[]; labelledBy: string; keep?: number; onChange(next: string[]): void }) {
  const { members, all, projects, labelledBy, keep = 0, onChange } = props;
  const slots = useRef<HTMLDivElement>(null);
  const byId = (id: string) => all.find((s) => s.id === id);
  const where = (s: SprocketData) => projects.find((p) => p.id === s.projectId)?.name ?? "General";
  const available = all.filter((s) => !members.includes(s.id));
  /**
   * A pick closes the menu without putting focus back, and the slot it was in may be gone: focus slot `i`, now and
   * again once the new members arrive (the settings panel saves first).
   */
  const focusAfter = useRef<number | null>(null);
  const focusSlot = (i: number) => slots.current?.querySelectorAll<HTMLButtonElement>(".sp-slot")[Math.min(i, TEAM_MEMBERS_MAX - 1)]?.focus();
  const change = (next: string[], focus: number) => {
    focusAfter.current = focus;
    onChange(next);
    requestAnimationFrame(() => focusSlot(focus));
  };
  useEffect(() => {
    if (focusAfter.current === null) return;
    focusSlot(focusAfter.current);
    focusAfter.current = null;
  }, [members.join()]);
  return (
    <div ref={slots} className="sp-slots" role="group" aria-labelledby={labelledBy}>
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
                {
                  label: "Remove from team",
                  danger: true,
                  disabled: members.length <= keep,
                  note: members.length <= keep ? "A team needs two" : undefined,
                  onSelect: () => change(members.filter((m) => m !== s.id), members.length - 1),
                },
              ]}
            />
          );
        // Only the first empty slot adds; the ones after it wait their turn.
        return i === members.length ? (
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
  );
}

interface Props {
  /** Every Sprocket, to pick members from. */
  all: SprocketData[];
  projects: Project[];
  onSaved(team: SprocketTeam): void;
  onClose(): void;
  /** Where focus goes once it closes, when what opened it (a menu item) is gone. */
  returnFocus?(): HTMLElement | null;
}

/**
 * Make a team chat (ADR 0022), in the small dialog's frame: a name, then the member slots. Once it's made, it's
 * changed in its settings panel, as a Sprocket is.
 */
export function TeamDialog({ all, projects, onSaved, onClose, returnFocus }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    input.current!.focus();
    return () => (d.close(), returnFocus?.()?.focus());
  }, []);

  const save = async () => {
    if (!name.trim() || members.length < TEAM_MEMBERS_MIN) return setError(name.trim() ? "Add at least two Sprockets." : "Give the team a name.");
    setBusy(true);
    try {
      onSaved(await api.createTeam({ name, members }));
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
        <h2 id="team-title">New team</h2>
        <p id="team-desc" className="small-dialog-desc">
          Your messages go to whoever you @mention (or @everyone), and the lead takes the rest. Members can pass each other the turn.
        </p>
        <label className="sp-field-label" htmlFor="team-name">Name</label>
        <input
          id="team-name"
          ref={input}
          className="input"
          autoComplete="off"
          value={name}
          maxLength={TEAM_NAME_MAX}
          placeholder="e.g. Launch crew"
          onChange={(e) => (setName(e.target.value), setError(""))}
        />
        <p id="team-members-label" className="sp-field-label sp-slots-label">
          Sprockets <span className="muted">· two to four, the first leads</span>
        </p>
        <MemberSlots members={members} all={all} projects={projects} labelledBy="team-members-label" onChange={(next) => (setMembers(next), setError(""))} />
        {error && <p className="error small" role="alert">{error}</p>}
        <div className="small-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Create team</button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
