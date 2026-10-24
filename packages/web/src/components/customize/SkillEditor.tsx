import { useState } from "react";
import { IconDots as Dots } from "@tabler/icons-react";
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, type Skill, type SkillInput } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { MenuButton } from "../ui/Menu.tsx";
import { useSprockets } from "../sprockets/useSprockets.ts";
import { EditorHead, LongText, TextInput } from "./fields.tsx";
import { useConfirm } from "../ui/ConfirmDialog.tsx";

/**
 * One skill (ADR 0025): its name and description (what a Sprocket sees to know when it applies), its instructions
 * (SKILL.md), the other files it came with, and the Sprockets that have it.
 */
export function SkillEditor({ skill: k }: { skill: Skill }) {
  const [error, setError] = useState("");
  const { list: sprockets } = useSprockets();
  const users = (sprockets ?? []).filter((x) => k.usedBy.includes(x.id));

  const save = async (body: SkillInput) => {
    setError("");
    try {
      await api.updateSkill(k.id, body);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };
  const [confirmDialog, ask] = useConfirm();
  const remove = () =>
    ask({
      title: `Delete ${k.name}?`,
      text: "Sprockets that have it lose it. A folder it was copied from stays.",
      action: "Delete skill",
      danger: true,
      // It opened from the `…` menu, whose item is gone: back to the menu's button.
      returnFocus: () => document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(`${k.name} actions`)}"]`),
      onConfirm: async () => {
        await api.deleteSkill(k.id);
        navigate(href.customize("skills"));
      },
    });

  return (
    <div className="cz-editor">
      {confirmDialog}
      <EditorHead back={href.customize("skills")} backLabel="Skills" title={k.name}>
        <MenuButton label={`${k.name} actions`} title="More" icon={<Dots size={18} />} align="right" items={[{ label: "Delete skill", danger: true, onSelect: () => void remove() }]} />
      </EditorHead>
      <div className="cz-body">
        <section className="set-group" aria-labelledby="cz-skill-title">
          <h3 id="cz-skill-title">Skill</h3>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-skill-name">Name</label>
            </div>
            <TextInput id="cz-skill-name" value={k.name} maxLength={SKILL_NAME_MAX} onSave={(v) => save({ name: v })} />
          </div>
        </section>
        <LongText
          id="cz-skill-desc"
          label="When to use it"
          help="Sprockets see this in their instructions and read the skill when it fits. Say what it's for and when it applies."
          value={k.description}
          maxLength={SKILL_DESCRIPTION_MAX}
          rows={2}
          placeholder="e.g. How we write release notes. Use it when asked for release notes or a changelog."
          onSave={(v) => save({ description: v.replace(/\s*\n\s*/g, " ") })}
        />
        <LongText
          id="cz-skill-body"
          label="Instructions"
          help="The skill itself (SKILL.md), in Markdown."
          value={k.body}
          maxLength={SKILL_BODY_MAX}
          rows={14}
          onSave={(v) => save({ body: v })}
        />
        {k.files.length > 0 && (
          <section className="set-group" aria-labelledby="cz-skill-files">
            <h3 id="cz-skill-files">Files</h3>
            <p className="set-intro">It came with these. A Sprocket can read the text ones when the instructions point to them, but can't run scripts.</p>
            <ul className="cz-files">
              {k.files.map((f) => (
                <li key={f} className="cz-mono">{f}</li>
              ))}
            </ul>
          </section>
        )}
        <section className="set-group" aria-labelledby="cz-skill-users">
          <h3 id="cz-skill-users">Sprockets with it</h3>
          {users.length ? (
            <ul className="cz-uses">
              {users.map((u) => (
                <li key={u.id}>
                  <a href={href.sprocketSettings(u.id)}>{u.name}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="set-intro">None yet. Give it to a Sprocket in that Sprocket's settings, under Tools.</p>
          )}
        </section>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
