# ADR 0026: Permission waits wake the Coordinator

Status: accepted. It replaces ADR 0009's rule that permission prompts never wake the Coordinator.

In test run 7 Codex asked to open a browser on the Rails machine and waited in its panel for an approval. The user
was in the project chat, where nothing showed it, and the tab's attention mark was easy to miss across three
panels. Claude Code's permission prompts and pi's approval dialogs leave the same gap. Rails still can't answer
any of them: Claude Code's hooks only report the prompt, pi's extension dialogs belong to other extensions, and
Codex's daemon sends its approval requests to the TUI that started the turn (another client could answer, but
approving commands from a chat is a bigger step this doesn't take).

Decisions:
- **A permission wait wakes the Coordinator** like a question: after the same 20 s grace period, once per wait,
  with the same per-session cooldown; anything the session does meanwhile (it was allowed, denied, or moved on)
  cancels it. The event is `what: "permission"`, its text what the permission is for, as far as the agent said:
  - Claude Code: the `PermissionRequest` hook's tool and input (`Use Bash: npm install x (its description)`);
  - Codex: the daemon's `item/commandExecution/requestApproval` (the command and Codex's reason),
    `item/fileChange/requestApproval` and `item/permissions/requestApproval`, which every client hears. The
    thread's `waitingOnApproval` status comes first and arms the wake; the request fills in what it's for;
  - pi: a dialog Rails doesn't know (no questions in a running tool's input), with its title and, from the Rails
    extension, the edit or shell command running when it opened. Such a dialog may ask something instead; when
    the decision model takes it for a question (ADR 0013), the wake becomes a question.
- **The Coordinator tells the user and drafts nothing:** what the session wants to do and whether its rules and
  the brief say to allow it, and why. `suggest_reply` already refuses a session that waits on a permission.
- The chat shows the event as "is waiting for your permission", with what it's for, and Open goes to the panel.

Consequences:
- A Coordinator run per permission the user doesn't give within 20 s: cheap, and a project without a Coordinator
  costs nothing. Agents in a permissive mode (Claude Code's auto mode, Codex's sandbox) ask rarely.
- What Rails knows of a permission is what the agent reports, clipped; a pi approval from an extension Rails
  doesn't know says only its title and the running call.
- Answering permissions from Rails (Allow/Deny in the chat) stays open. It would need Codex's daemon to accept
  another client's answer and a way into Claude Code's prompt, and a rule for which ones are safe to allow remotely.
