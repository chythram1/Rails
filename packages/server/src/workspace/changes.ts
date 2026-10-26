// The Git tab's list (SidePanel.tsx): git's changed files, how many lines each changed, and which open sessions
// changed it, as they reported (their edit tools and shell commands: the edits behind overlaps, ADR 0014, 0016).
// Rails keeps a session's edits only while its panel is open, so a file no open session changed may still be an
// agent's. The Sprockets' git_status reads plain gitStatus.
import { isAbsolute, join } from "node:path";
import type { GitFileEditor, GitStatus } from "@rails/shared";
import { cardOf } from "../bridge/index.ts";
import { panels } from "../db.ts";
import { gitLineCounts, gitRoot, gitStatus } from "./git.ts";
import { getProject } from "./projects.ts";
import { sessionTitle } from "./titles.ts";

export async function projectChanges(projectId: string): Promise<GitStatus> {
  const project = getProject(projectId);
  const status = await gitStatus(project.path);
  if (!status.isRepo || !status.files.length) return status;
  const [root, counts] = await Promise.all([gitRoot(project.path), gitLineCounts(project.path)]);

  // Each open session's edits, by absolute path: agents report absolute paths, or paths in the project.
  const edits: { file: string; editor: GitFileEditor }[] = [];
  for (const panel of panels.list(projectId)) {
    const card = cardOf(panel);
    if (!card.edits.length) continue;
    const title = await sessionTitle(panel);
    for (const e of card.edits)
      edits.push({ file: isAbsolute(e.file) ? e.file : join(project.path, e.file), editor: { panelId: panel.id, kind: panel.kind, title, at: e.at } });
  }

  const editorsOf = (path: string): GitFileEditor[] => {
    const abs = join(root, path);
    // git lists a new folder as one entry ("?? src/new/"): it's every file in it.
    const mine = edits.filter((e) => (path.endsWith("/") ? e.file.startsWith(abs) : e.file === abs));
    const latest = new Map<string, GitFileEditor>();
    for (const { editor } of mine) if ((latest.get(editor.panelId)?.at ?? "") < editor.at) latest.set(editor.panelId, editor);
    return [...latest.values()].sort((a, b) => b.at.localeCompare(a.at));
  };
  return { ...status, files: status.files.map((f) => ({ ...f, ...counts.get(f.path), editedBy: editorsOf(f.path) })) };
}
