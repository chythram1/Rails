# ADR 0006: Sprockets run, on the user's own model providers

Status: accepted (stage 2, part 1: replies, models, projects, description and core memory).

ADR 0005 gave Sprockets a look and a chat that nobody answered. Sprockets are meant to be project-first:
each one helps with one project, and later acts as a coordination layer between that project's agent
sessions (seeing what each is doing, warning about clashes, passing on handoffs). This first part makes
them reply and gives them the pieces that later work builds on.

Decisions:
- **Rails runs its own small agent loop**, in the server process, through `@earendil-works/pi-ai` (model
  providers, auth, streaming) and `@earendil-works/pi-agent-core` (the tool loop). These are MIT npm
  libraries; users don't need pi installed. Sprockets aren't a fourth provider (ADR 0002) and don't run in
  panels or tmux.
- **The user brings the model.** Settings → Providers (once part of Models) sets up providers with an API key (OpenAI, Anthropic,
  OpenRouter, Google, xAI, Mistral, Groq, DeepSeek) or a sign-in: "Continue with ChatGPT" (OpenAI allows
  open-source and locally run apps to use a ChatGPT plan) and OpenRouter's sign-in. **No Anthropic
  subscription sign-in**: Anthropic doesn't allow its subscriptions in other apps, so Anthropic takes an API
  key. Rails ignores provider env vars (`OPENAI_API_KEY`, …) so it never bills a key set for something else.
  With a ChatGPT sign-in only the plan's models work, so Rails offers the ones OpenAI's `/v1/models` lists
  for the account (`visibility: "list"`), not pi-ai's whole OpenAI catalog.
- **Keys are checked before they're saved** (added later): Rails asks the key's own provider for something free
  (its model list, or the key's info for OpenRouter; TypeSafe has nothing free, so one tiny classification).
  A key the provider refuses (401/403) isn't saved, and the user is told; one Rails couldn't check (no answer,
  rate limits, an unknown provider) is saved with a note saying so.
- **Credentials stay on the server**, in `RAILS_HOME/credentials.json` (mode 0600). The API only says which
  providers are set up. Sign-in runs on the server: the provider redirects to a callback on the server's own
  `127.0.0.1` (OpenAI's is port 1455, shared with the Codex CLI and pi). A browser on another device can't
  reach that, so the user pastes the address the redirect landed on.
- **Rails runs the sign-in flows itself** (`signin.ts`), not pi-ai's `login()`, so every page the user sees
  says Rails (pi-ai's callback page shows pi's logo and name). Everything after sign-in stays with pi-ai:
  token refresh, request auth and model calls. That works because `signin.ts` stores exactly the
  credential pi-ai's own sign-in would (`{type: "oauth", access, refresh, expires, clientId, scopes}` for
  ChatGPT, the minted key as `access` for OpenRouter). `signin.test.ts` checks this against the installed
  pi-ai (its `toAuth` and `refresh` accept our credential), so an upgrade that changes the shape fails the
  tests. The flows follow pi-ai 1.3's (`dist/auth/oauth/openai-chatgpt.js`, `openrouter.js`): when OpenAI
  or OpenRouter change theirs, update `signin.ts` the same way. pi-ai is pinned to `~1.3`.
- **ChatGPT sign-in registers Rails once.** The first sign-in registers Rails with the ChatGPT account, and
  OpenAI asks the user to name it (pre-filled "Rails"). Rails remembers the client id OpenAI issues (not a
  secret, kept even when the provider is removed) and signs in with it later, which skips the naming and
  consent screens. That id only works for the same ChatGPT account, so the sign-in offers "Use a different
  account" (a fresh registration), and a failed sign-in with a remembered id forgets it.
- **No spending limits in Rails.** Users manage spend with their providers. Rails only has runaway guards:
  at most 12 model calls per reply, 30 replies per Sprocket per hour (counted in memory, so a server
  restart resets it) and 2 runs at once.
- **A run is one bounded reply.** A user message starts a run; nothing runs otherwise, so idle Sprockets
  cost nothing. Messages sent during a run get their own run afterwards. Replies stream to every device
  (`sprockets.typing`), and Rails' own notices (no model, model errors, guard stops) show in the chat.
- **One project per Sprocket**, any number of Sprockets per project. Moving a Sprocket to another project,
  or detaching it, deletes its chat (it belonged to that project). Removing a project detaches its Sprockets.
- **A description and a core memory**, both staying with a Sprocket wherever it goes:
  - the **description** (at most 500 characters) is the user's standing instructions for it, like a small
    AGENTS.md or Muse's and Hermes' identity files. The user writes it in the Sprocket's settings; every run
    follows it.
  - the **core memory** (at most 1,500 characters) is the Sprocket's own: durable facts about its user that
    it keeps with its `remember` tool, loaded as a snapshot at the start of each run (as Hermes does). It's
    internal: it isn't shown in the UI or sent to browsers.
- New dependencies on the server: pi-ai and pi-agent-core (and the provider SDKs they load lazily).
- `make test` (Vitest) runs the run engine against pi-ai's scripted "faux" provider.
