# ADR 0025: Customize is the Sprockets' toolbox

Status: accepted. It replaces ADR 0020's agent profiles; its saved prompts stand.

Customize held agent profiles: Claude Code's launch options (model, effort, permission mode, instructions, tool
lists) for panels. They only ever worked for Claude Code (pi's and Codex's flags weren't checked, and Codex leaves
its daemon on most flags), and the agents in panels already have their own ways to add MCP servers, plugins and
skills, which their users keep up. What Rails alone can shape is its own harness: the Sprockets. Giving them tools
beyond the board, files and git is also what later work needs: Automate's jobs and interactive cards act through
tools too.

Decisions:
- **Customize holds what Sprockets can use: MCP servers, skills and saved prompts.** One library, global. A
  Sprocket picks which servers and skills it has (its settings panel, Tools). Automate will pick from the same
  library. Panels and the coding agents in them are left alone: Rails passes them nothing new.
- **Agent profiles go.** Their editor, the profile pickers (the `+` menu, Home), `profileFlags`, the snapshot on
  panels (`panels.profile`) and its line on the board. Panels start agents with their own settings again. The
  `agent_profiles` table and `panels.profile` column stay in the database, unread, so nothing is deleted.
- **MCP servers** are a name, then a local command (with its arguments and environment) or a remote URL (with
  headers). Rails connects with `@earendil-works/pi-mcp` (MIT, the pi family Rails already pins, no other
  dependencies): stdio or Streamable HTTP. A connection opens when a run first needs it and closes after 5 idle
  minutes, or when the server is changed or removed. A local server runs as the user on the Rails machine, as
  panels do (ADR 0003), with the environment panels get (no `RAILS_*`), plus its own.
- **Secrets stay on the server.** Environment and header values are kept in `RAILS_HOME/mcp-secrets.json`
  (readable only by the user), never in the database, and the API reports only which are set.
- **Remote servers can be signed in to** (OAuth). pi-mcp does the protocol: it finds the service's sign-in server,
  registers Rails with it (dynamic client registration) or uses the user's own app (a client ID and secret, for
  services that don't let apps register themselves, such as Google's and GitHub's), uses PKCE, and renews tokens
  when the service turns one away. The browser comes back to a listener on the Rails machine's
  `127.0.0.1:4328` (`RAILS_MCP_OAUTH_PORT`), the way ChatGPT's sign-in does (ADR 0006); on another device that
  page won't load, so the user pastes its address into Customize instead. The redirect address is fixed, so it can
  be given to a service when registering an app. One sign-in runs at a time. Tokens and the registered app are
  kept with the other secrets, and the browser only learns whether Rails is signed in. A server that turns Rails
  away (on connecting, or only on a call, as Google's do) is marked as needing a sign-in, and a Sprocket calling it
  is told the user has to sign in. Signing out forgets the tokens; it doesn't revoke them at the service.
- **A server's tools are capabilities** (ADR 0008: still one codemode tool), named `<server>_<tool>`, with the
  tool's own input schema. Their results reach the model labelled as data from that server, trimmed to 20,000
  characters. Rails keeps the last tool list it saw, so the page shows it without connecting.
- **Each tool is allowed, asked or off.** A tool the server marks read-only (`readOnlyHint`) starts as allow,
  every other one as ask. The user changes it per tool. Off tools aren't offered.
- **Asking ends the turn with an approval.** A call to an ask tool doesn't run: Rails posts an approval card (the
  tool and its arguments, Allow and Deny) and the run waits, as with `ask_user` (ADR 0023). Allow runs the call
  then, saves its result on the card and gives the Sprocket a new turn to go on with it; Deny tells it so in a new
  turn. Approvals are stored on their message, so they survive a restart and hold no run open meanwhile. Automate's
  unattended jobs will reuse the same rule.
- **MCP tools are offered in direct and team chats, not the project chat** for now: the project chat keeps one
  reply per run (ADR 0023), which approvals would break, and the Coordinator check measures it.
- **Skills** are `SKILL.md` folders in `RAILS_HOME/skills/<id>/`: written in Customize, or copied from a folder
  (the native picker, ADR 0004) or from the skills the user's agents already have (`~/.agents/skills`,
  `~/.claude/skills`, `~/.pi/agent/skills`). A Sprocket's instructions list its skills' names and descriptions,
  and `read_skill` reads one (its `SKILL.md`, or a text file beside it). Sprockets can't run a skill's scripts;
  the page says so. Skills are offered in every chat, since reading one changes nothing.
- **The page** keeps Customize's list beside an editor, with three groups: MCP servers, Skills, Saved prompts. A
  server's editor has its settings (secret values as "Set", with Replace), Test (connects and lists the tools),
  the tools with their allow, ask or off, and the Sprockets that use it.

Consequences:
- Sprockets can act outside Rails for the first time. Acting tools ask by default, and a Sprocket can't change
  its own tools or their settings.
- A tool's description and results come from its server. A malicious server could try to steer a Sprocket; the
  ask default and the data label are the guards, and the page says a server is trusted like a program you run.
- A server with many tools makes every run's instructions longer. Codemode lists them compactly; looking tools up
  on demand can come if it matters.
- **Connectors** are MCP servers Rails knows (`packages/shared/src/connectors.ts`), added in one step: each entry
  says how it connects (sign in, no account, a token sent as a header, the user's own app, a folder from the native
  picker, or a local program) and adding it makes an ordinary server that remembers the entry
  (`mcp_servers.connector`). Every entry was checked to connect that way before it went in (services that refuse
  apps registering themselves, such as Figma's, stay out); the list is small on purpose and grows the same way.
  Their marks come from simple-icons (CC0), copied in rather than installed.
- **Customize is a page of cards** with Connectors, Skills and Prompts tabs, each with Yours and Discover (Rails'
  connectors; the user's agents' skills to copy in). One item opens full width in its place.
- **Fewer fields to fill in** (added after researching other apps, `scratch/research/customize/findings.md`).
  Google's MCP servers let no app register itself (no dynamic registration, no client metadata documents), and every
  self-hosted app (n8n, Home Assistant) has users register their own; one-click sign-in would need an app the Rails
  project registers and has Google verify, with a yearly security assessment for Gmail and Drive. So the user
  registers one Google app, once: Customize's "Your Google app" page (`AppSetup.tsx`) gives the steps with a link to
  each Google Cloud page, the scopes and redirect address to copy, and takes its client ID and secret, kept in
  `RAILS_HOME/mcp-apps.json` (readable only by the user). Every Google connector signs in with it (`Connector.app`),
  unless a server has an app of its own; changing it signs those servers out. GitHub's connector opens GitHub's new
  fine-grained token page filled in (its token templates), so a token is a click and a paste. A new custom server
  takes a pasted config: the README's `mcpServers` JSON, a `claude mcp add` / `codex mcp add` line or Codex's TOML;
  placeholder values are left for the user to fill in.
- Not yet: plugins (bundles of skills, servers and prompts), MCP in the project chat, Sprockets writing their own
  skills, client metadata documents (pi-mcp supports them; Rails would publish one file), and signing in from
  another device without pasting the address back.
