// Connectors (ADR 0025): MCP servers Rails knows, to add in one step from Customize. Each was checked to connect
// as described (2026-10-21): the "sign-in" ones register Rails themselves and hand back a sign-in page, the "none"
// ones answer without an account, Google's want the user's own app, GitHub a token. Adding one makes an ordinary MCP
// server (`McpServer.connector` names the entry), so everything else (tools, approvals, Sprockets) is the same.

/**
 * How a connector gets going: `sign-in` (with the user's account, OAuth), `none` (no account), `token` (a token the
 * user pastes, sent as a header), `own-app` (OAuth with an app the user registers with the service), `folder` (a
 * local server given a folder on this computer).
 */
export type ConnectorSetup = "sign-in" | "none" | "token" | "own-app" | "folder";

export type ConnectorGroup = "accounts" | "docs" | "google" | "local";

/**
 * An app (OAuth client) the user registers once with a service and every connector of that service uses (Google's,
 * which let no app register itself): set up in Customize, kept with the other secrets.
 */
export type McpAppId = "google";

export interface Connector {
  /** Also the name the server gets when added (`<id>_<tool>` for Sprockets). */
  id: string;
  name: string;
  /** Who makes it. */
  by: string;
  /** One line, for its card. */
  description: string;
  /** More, for its page. */
  about: string;
  group: ConnectorGroup;
  setup: ConnectorSetup;
  url?: string;
  command?: string;
  args?: string[];
  /**
   * `token`: the header it goes in, and what to put before it. `create` opens the service's page for making one,
   * filled in as far as the service allows, so it's a click and a paste.
   */
  token?: { header: string; prefix: string; label: string; help: string; create?: { url: string; label: string } };
  /** A page on setting it up. */
  guide?: string;
  /** Every tool only reads, though the server doesn't mark them so: they start as Allow instead of Ask. */
  readOnly?: boolean;
  /** `own-app`: the shared app it signs in with, once the user has set it up (an app of its own overrides it). */
  app?: McpAppId;
  /** `own-app`: the scopes the app must be allowed, for its setup page (the service's own list). */
  scopes?: string[];
}

export const CONNECTOR_GROUPS: { id: ConnectorGroup; title: string }[] = [
  { id: "accounts", title: "Your accounts" },
  { id: "docs", title: "Docs and knowledge" },
  { id: "google", title: "Google Workspace" },
  { id: "local", title: "On this computer" },
];

const GOOGLE_GUIDE = "https://developers.google.com/workspace/guides/configure-mcp-servers";
/** Google's scopes for each MCP server (its guide, "Set up the OAuth consent screen"). */
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"];
const GOOGLE_ABOUT =
  "Google's MCP servers are in preview: you need to be in the Google Workspace Developer Preview Program, and to register an app for Rails in Google Cloud once. Customize walks you through it, and every Google connector then signs in with that app.";

export const CONNECTORS: Connector[] = [
  {
    id: "linear",
    name: "Linear",
    by: "Linear",
    description: "Find, create and update issues, projects and comments.",
    about: "Linear's own MCP server. Sign in with your Linear account; Sprockets can then work with the issues and projects you can see.",
    group: "accounts",
    setup: "sign-in",
    url: "https://mcp.linear.app/mcp",
  },
  {
    id: "notion",
    name: "Notion",
    by: "Notion",
    description: "Search, read and update pages and databases.",
    about: "Notion's own MCP server. Sign in and pick the workspace; Sprockets see what you share with the connection.",
    group: "accounts",
    setup: "sign-in",
    url: "https://mcp.notion.com/mcp",
  },
  {
    id: "sentry",
    name: "Sentry",
    by: "Sentry",
    description: "Look into errors, issues and releases.",
    about: "Sentry's own MCP server. Sign in with your Sentry account to let Sprockets read your projects' issues and events.",
    group: "accounts",
    setup: "sign-in",
    url: "https://mcp.sentry.dev/mcp",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    by: "Atlassian",
    description: "Jira issues and Confluence pages.",
    about: "Atlassian's remote MCP server, for Jira and Confluence Cloud. Sign in with your Atlassian account.",
    group: "accounts",
    setup: "sign-in",
    url: "https://mcp.atlassian.com/v1/mcp",
  },
  {
    id: "stripe",
    name: "Stripe",
    by: "Stripe",
    description: "Customers, payments, invoices and Stripe's docs.",
    about: "Stripe's own MCP server. Sign in to your Stripe account; consider a test-mode account first.",
    group: "accounts",
    setup: "sign-in",
    url: "https://mcp.stripe.com",
  },
  {
    id: "supabase",
    name: "Supabase",
    by: "Supabase",
    description: "Your projects' tables, SQL, logs and docs.",
    about: "Supabase's own MCP server. Sign in with your Supabase account; tools that change data ask first.",
    group: "accounts",
    setup: "sign-in",
    url: "https://mcp.supabase.com/mcp",
  },
  {
    id: "vercel",
    name: "Vercel",
    by: "Vercel",
    description: "Projects, deployments, logs and Vercel's docs.",
    about: "Vercel's own MCP server. Sign in with your Vercel account.",
    group: "accounts",
    setup: "sign-in",
    url: "https://mcp.vercel.com",
  },
  {
    id: "github",
    name: "GitHub",
    by: "GitHub",
    description: "Repositories, issues, pull requests and code.",
    about: "GitHub's remote MCP server. It takes a personal access token: what the token may do is what Sprockets may do.",
    group: "accounts",
    setup: "token",
    url: "https://api.githubcopilot.com/mcp/",
    token: {
      header: "Authorization",
      prefix: "Bearer ",
      label: "Personal access token",
      help: "Make a fine-grained token on GitHub: it opens filled in (repository contents, issues and pull requests, 90 days). Pick the repositories it may reach, generate it and paste it here. Its access is what Sprockets get.",
      // GitHub's token templates (docs.github.com, "Pre-filling fine-grained personal access token details").
      create: {
        url: `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
          name: "Rails",
          description: "For Rails' Sprockets, through GitHub's MCP server. What this token may do is what they may do.",
          expires_in: "90",
          contents: "write",
          issues: "write",
          pull_requests: "write",
        })}`,
        label: "Make one on GitHub",
      },
    },
    guide: "https://github.com/github/github-mcp-server",
  },
  {
    id: "context7",
    name: "Context7",
    by: "Upstash",
    description: "Current docs and examples for libraries and frameworks.",
    about: "Looks up up-to-date documentation and code examples for a library, so Sprockets don't go by what they remember.",
    group: "docs",
    setup: "none",
    url: "https://mcp.context7.com/mcp",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    by: "Cognition",
    description: "Ask about any public GitHub repository.",
    about: "Answers questions about public GitHub repositories from their generated wikis.",
    group: "docs",
    setup: "none",
    url: "https://mcp.deepwiki.com/mcp",
    readOnly: true,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    by: "Google",
    description: "Search and read your files, and create new ones.",
    about: GOOGLE_ABOUT,
    group: "google",
    setup: "own-app",
    url: "https://drivemcp.googleapis.com/mcp/v1",
    guide: GOOGLE_GUIDE,
    app: "google",
    scopes: DRIVE_SCOPES,
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    by: "Google",
    description: "Read and edit spreadsheets.",
    about: GOOGLE_ABOUT,
    group: "google",
    setup: "own-app",
    url: "https://sheetsmcp.googleapis.com/mcp/v1",
    guide: GOOGLE_GUIDE,
    app: "google",
    scopes: [...DRIVE_SCOPES, "https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/spreadsheets"],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    by: "Google",
    description: "Read your calendars and events, and find free time.",
    about: GOOGLE_ABOUT,
    group: "google",
    setup: "own-app",
    url: "https://calendarmcp.googleapis.com/mcp/v1",
    guide: GOOGLE_GUIDE,
    app: "google",
    scopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.freebusy", "https://www.googleapis.com/auth/calendar.events.readonly"],
  },
  {
    id: "gmail",
    name: "Gmail",
    by: "Google",
    description: "Search and read mail, and draft replies.",
    about: GOOGLE_ABOUT,
    group: "google",
    setup: "own-app",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
    guide: GOOGLE_GUIDE,
    app: "google",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    by: "MCP reference servers",
    description: "Read and write files in a folder you choose.",
    about: "Runs @modelcontextprotocol/server-filesystem with npx, limited to the folder you pick. Writing files asks you first.",
    group: "local",
    setup: "folder",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
  },
];

export const connectorById = (id: string | undefined) => CONNECTORS.find((c) => c.id === id);
