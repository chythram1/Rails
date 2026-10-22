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
  /** `token`: the header it goes in, and what to put before it. */
  token?: { header: string; prefix: string; label: string; help: string };
  /** A page on setting it up. */
  guide?: string;
  /** Every tool only reads, though the server doesn't mark them so: they start as Allow instead of Ask. */
  readOnly?: boolean;
}

export const CONNECTOR_GROUPS: { id: ConnectorGroup; title: string; blurb: string }[] = [
  { id: "accounts", title: "Your accounts", blurb: "Sign in, or paste a token. Rails keeps it on this computer." },
  { id: "docs", title: "Docs and knowledge", blurb: "No account needed." },
  { id: "google", title: "Google Workspace", blurb: "In preview at Google: needs your own app in Google Cloud." },
  { id: "local", title: "On this computer", blurb: "Programs Rails runs here, with your access." },
];

const GOOGLE_GUIDE = "https://developers.google.com/workspace/guides/configure-mcp-servers";
const GOOGLE_ABOUT =
  "Google's MCP servers are in preview: you need to be in the Google Workspace Developer Preview Program, then register an app in Google Cloud (a Web application client marked for an AI-powered agent) with Rails' redirect address, and enter its client ID and secret here.";

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
      help: "Make one at github.com → Settings → Developer settings → Personal access tokens. Its access is what Sprockets get.",
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

/** Collections for the banner at the top of Customize's connectors. */
export const CONNECTOR_COLLECTIONS: { eyebrow: string; title: string; text: string; ids: string[] }[] = [
  { eyebrow: "For building", title: "Your code, issues and errors", text: "Give Sprockets the tools your projects already use.", ids: ["github", "linear", "sentry", "vercel", "supabase"] },
  { eyebrow: "No account needed", title: "Docs on hand", text: "Current library docs and answers about any public repository.", ids: ["context7", "deepwiki"] },
  { eyebrow: "Google Workspace", title: "Drive, Sheets, Calendar and Gmail", text: "Google's own servers, with an app you register.", ids: ["google-drive", "google-sheets", "google-calendar", "gmail"] },
];

export const connectorById = (id: string | undefined) => CONNECTORS.find((c) => c.id === id);
