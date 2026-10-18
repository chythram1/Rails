import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck as Check, IconPencil as Pencil } from "@tabler/icons-react";
import { PROFILE_AVATARS, PROFILE_NAME_MAX, type ProfileAvatar } from "@rails/shared";
import { useStore } from "../../store.tsx";
import { Avatar, AVATAR_LABELS } from "../Avatar.tsx";

/**
 * Settings → Account → Profile (Claude's Profile rows): the avatar and name at the foot of the sidebar,
 * shared by every device. The name is the computer's until it's changed, and goes back to it when cleared.
 */
export function ProfileSettings() {
  const { profile, saveProfile } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(profile?.name ?? "");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  // Follow the saved name, except while it's being typed (a change from another device would wipe it).
  useEffect(() => {
    if (document.activeElement !== input.current) setName(profile?.name ?? "");
  }, [profile?.name]);
  if (!profile) return null;

  const commit = async () => {
    if (name.trim() === profile.name) return setName(profile.name);
    try {
      await saveProfile({ name: name.trim() });
      setError("");
    } catch (e: any) {
      setError(e.message);
      setName(profile.name);
    }
  };
  const onNameKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape" && name !== profile.name) {
      e.preventDefault(); // undoes the edit instead of closing Settings
      setName(profile.name);
    }
  };

  return (
    <section className="set-group" aria-labelledby="profile-title">
      <h3 id="profile-title">Profile</h3>
      <div className="set-row" id="setting-avatar" data-settings-row tabIndex={-1}>
        <div className="set-text">
          <span className="set-label">Avatar</span>
          <p>Shown next to the name at the foot of the sidebar.</p>
        </div>
        <button className="avatar-btn" aria-label="Change avatar" aria-haspopup="dialog" title="Change avatar" onClick={() => setPicking(true)}>
          <Avatar avatar={profile.avatar} size={40} />
          <span className="avatar-edit" aria-hidden>
            <Pencil size={16} />
          </span>
        </button>
      </div>
      <div className="set-row" id="setting-name" data-settings-row tabIndex={-1}>
        <div className="set-text">
          <label htmlFor="profile-name">Name</label>
          <p>Shown in the sidebar. Leave it empty to use the computer's name.</p>
        </div>
        <input
          id="profile-name"
          ref={input}
          className="input"
          maxLength={PROFILE_NAME_MAX}
          placeholder={profile.machineName}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onNameKey}
        />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {picking && (
        <AvatarPicker value={profile.avatar} onSave={(avatar) => saveProfile({ avatar })} onClose={() => setPicking(false)} />
      )}
    </section>
  );
}

/**
 * "Choose an avatar" (ref/sprockets/stage2/avatar-picker.png): a small modal over Settings with the avatars
 * as radio buttons, so the arrow keys move between them and Enter saves.
 */
function AvatarPicker({ value, onSave, onClose }: { value: ProfileAvatar; onSave(avatar: ProfileAvatar): Promise<void>; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    d.querySelector<HTMLInputElement>("input:checked")?.focus();
    return () => d.close();
  }, []);

  const save = async () => {
    if (choice === value) return onClose();
    setBusy(true);
    try {
      await onSave(choice);
      onClose();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="avatar-dialog"
      aria-labelledby="avatar-title"
      aria-describedby="avatar-desc"
      // Escape closes only this, not Settings behind it (React passes the event up to Settings' dialog).
      onCancel={(e) => (e.preventDefault(), e.stopPropagation(), onClose())}
      // A click on the backdrop lands on the dialog element itself; the form covers the rest.
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <h2 id="avatar-title">Choose an avatar</h2>
        <p id="avatar-desc">It shows next to the name in the sidebar, on every device.</p>
        <div className="avatar-grid" role="radiogroup" aria-labelledby="avatar-title">
          {PROFILE_AVATARS.map((id) => (
            <label key={id} className="avatar-option" title={AVATAR_LABELS[id]}>
              <input type="radio" name="avatar" className="sr-only" aria-label={AVATAR_LABELS[id]} checked={choice === id} onChange={() => setChoice(id)} />
              <Avatar avatar={id} size={52} />
              {choice === id && (
                <span className="avatar-check" aria-hidden>
                  <Check size={12} stroke={3} />
                </span>
              )}
            </label>
          ))}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="avatar-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </dialog>
  );
}
