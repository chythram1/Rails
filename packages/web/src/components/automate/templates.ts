import type { AutomationSchedule } from "@rails/shared";

/** What a template needs: a Sprocket with a project (its sessions, git and files), or a connector (CONNECTORS id). */
export type TemplateUse = "project" | string;

/**
 * A starting point for an automation (Automate's Templates): a name, its instructions and when, filled into a new
 * automation for the user to change before Create. `uses` is everything the Sprocket needs to do it.
 */
export interface AutomationTemplate {
  id: string;
  name: string;
  /** What kind of work it is, under its name ("Code review"). */
  category: string;
  /** One line on what it tells you. */
  description: string;
  prompt: string;
  schedule: AutomationSchedule;
  uses: TemplateUse[];
  group: TemplateGroup;
}

export type TemplateGroup = "project" | "work" | "ops" | "day";

export const TEMPLATE_GROUPS: { id: TemplateGroup; title: string; blurb: string }[] = [
  { id: "project", title: "Your project", blurb: "For a Sprocket with a project: its agent sessions, git and files." },
  { id: "work", title: "Issues and code", blurb: "Where your team tracks work and reviews it." },
  { id: "ops", title: "Errors and deploys", blurb: "Checks that stay quiet until something breaks." },
  { id: "day", title: "Your day", blurb: "Mail, meetings and money." },
];

export const TEMPLATES: AutomationTemplate[] = [
  {
    id: "morning-brief",
    name: "Morning brief",
    category: "Agent sessions",
    description: "What each agent session did since the last run, and what waits for you.",
    prompt:
      "Look at the project's agent sessions. For each one that did something since the last run, say in one line what it did and whether it waits for me. Then list any files two sessions both changed.",
    schedule: { kind: "weekdays", time: "09:00" },
    uses: ["project"],
    group: "project",
  },
  {
    id: "uncommitted",
    name: "Uncommitted work",
    category: "Git",
    description: "Changes left uncommitted at the end of the day, and which look finished.",
    prompt:
      "Check the project's git status. If there are uncommitted changes, list the files, grouped by the session that changed them where you can tell, and say which look finished and which look half done.",
    schedule: { kind: "weekdays", time: "17:30" },
    uses: ["project"],
    group: "project",
  },
  {
    id: "week-in-commits",
    name: "Week in commits",
    category: "Changelog",
    description: "A short changelog of the week from the project's git history.",
    prompt: "Read this week's commits in the project's git log and write a short changelog: features, fixes and other changes, one line each.",
    schedule: { kind: "weekly", days: [5], time: "16:00" },
    uses: ["project"],
    group: "project",
  },
  {
    id: "release-notes-notion",
    name: "Release notes in Notion",
    category: "Documentation",
    description: "The week's commits as release notes, ready to post as a Notion page.",
    prompt:
      "Write release notes from this week's commits in the project's git log, grouped into features and fixes, in plain words for people who don't read code. Offer them as a new Notion page for me to run; don't post it yourself.",
    schedule: { kind: "weekly", days: [5], time: "16:30" },
    uses: ["project", "notion"],
    group: "project",
  },
  {
    id: "dependency-docs",
    name: "Dependency changes",
    category: "Dependencies",
    description: "Breaking changes and deprecations in the libraries your project uses.",
    prompt:
      "Read the project's dependency manifest (package.json, pyproject.toml or similar). For its main libraries, check their current docs with Context7 and list breaking changes or deprecations that affect how this project uses them, with the file where it does.",
    schedule: { kind: "weekly", days: [1], time: "10:00" },
    uses: ["project", "context7"],
    group: "project",
  },
  {
    id: "linear-mine",
    name: "My Linear issues",
    category: "Project management",
    description: "Issues assigned to you that changed since the last run.",
    prompt: "List the Linear issues assigned to me that changed since the last run, with what changed on each: status, priority or new comments.",
    schedule: { kind: "weekdays", time: "09:00" },
    uses: ["linear"],
    group: "work",
  },
  {
    id: "linear-triage",
    name: "Linear triage",
    category: "Triage",
    description: "New issues with no owner or priority, with a suggestion for each.",
    prompt:
      "Find Linear issues created since the last run that have no assignee or no priority. For each, suggest a priority and an owner, with one line on why. Offer the changes as actions for me to run; don't make them yourself.",
    schedule: { kind: "weekdays", time: "10:00" },
    uses: ["linear"],
    group: "work",
  },
  {
    id: "standup",
    name: "Standup notes",
    category: "Team updates",
    description: "What you moved in Linear and did on GitHub since yesterday, and what's next.",
    prompt:
      "Write my standup: the Linear issues I moved and the GitHub pull requests I opened, reviewed or merged since the last run, then what's next from my assigned issues. Three short lists.",
    schedule: { kind: "weekdays", time: "09:15" },
    uses: ["linear", "github"],
    group: "work",
  },
  {
    id: "github-reviews",
    name: "Reviews waiting on you",
    category: "Code review",
    description: "Open pull requests that wait for your review, oldest first.",
    prompt: "List the open GitHub pull requests that wait for my review, oldest first, each with its repository, author and one line on what it changes.",
    schedule: { kind: "weekdays", time: "09:30" },
    uses: ["github"],
    group: "work",
  },
  {
    id: "stale-prs",
    name: "Stale pull requests",
    category: "Code review",
    description: "Pull requests with no activity for a week, and who each waits on.",
    prompt: "List the open pull requests in my GitHub repositories with no activity for seven days or more, each with who it waits on and what it needs to move.",
    schedule: { kind: "weekly", days: [1], time: "09:00" },
    uses: ["github"],
    group: "work",
  },
  {
    id: "jira-sprint",
    name: "Sprint check",
    category: "Project management",
    description: "Jira issues at risk in the active sprint: blocked, unowned or not started.",
    prompt:
      "Check the active Jira sprint for issues that are blocked, have no assignee, or haven't started with three days or less left. List each with its key, owner and why it's at risk.",
    schedule: { kind: "weekdays", time: "10:00" },
    uses: ["atlassian"],
    group: "work",
  },
  {
    id: "sentry-new",
    name: "New Sentry errors",
    category: "Monitoring",
    description: "Issues new since the last run, how often they happen and the likely cause.",
    prompt: "Look for Sentry issues first seen since the last run. For each, say how often it happened, where, and the likely cause in one line.",
    schedule: { kind: "hourly", minute: 0 },
    uses: ["sentry"],
    group: "ops",
  },
  {
    id: "sentry-to-linear",
    name: "Errors to Linear issues",
    category: "Incident triage",
    description: "Frequent new Sentry errors with no Linear issue yet, each offered as one.",
    prompt:
      "For Sentry issues first seen since the last run that happened more than 10 times, check Linear for an issue about them. For each without one, offer a Linear issue with the error, its count and the likely cause as an action for me to run.",
    schedule: { kind: "hourly", minute: 30 },
    uses: ["sentry", "linear"],
    group: "ops",
  },
  {
    id: "vercel-failed",
    name: "Failed deployments",
    category: "Deploys",
    description: "Vercel deployments that failed since the last run, and why.",
    prompt: "Check Vercel for deployments that failed since the last run. For each, give the project, the branch and why it failed, from its build log.",
    schedule: { kind: "hourly", minute: 15 },
    uses: ["vercel"],
    group: "ops",
  },
  {
    id: "supabase-logs",
    name: "Database health",
    category: "Database",
    description: "Errors and slow queries in your Supabase logs, with the worst of each.",
    prompt: "Check my Supabase project's logs since the last run for errors and slow queries. Group them by kind, with how often each happened and the worst example.",
    schedule: { kind: "daily", time: "07:00" },
    uses: ["supabase"],
    group: "ops",
  },
  {
    id: "day-ahead",
    name: "Your day ahead",
    category: "Calendar",
    description: "Today's meetings, what each is about, and time free to focus.",
    prompt: "List today's meetings on my Google Calendar with what each is about, then say which stretches of the day are free to focus.",
    schedule: { kind: "weekdays", time: "08:30" },
    uses: ["google-calendar"],
    group: "day",
  },
  {
    id: "meeting-prep",
    name: "Meeting prep",
    category: "Meetings",
    description: "For each meeting today, what's open with the people in it.",
    prompt: "For each meeting on my Google Calendar today, find recent Gmail threads with its attendees and sum up what's open with them in two lines.",
    schedule: { kind: "weekdays", time: "08:15" },
    uses: ["google-calendar", "gmail"],
    group: "day",
  },
  {
    id: "inbox",
    name: "Mail to answer",
    category: "Email",
    description: "Emails since the last run that ask something of you.",
    prompt: "Read my Gmail since the last run and list the emails that ask me something or wait for my answer, each with who sent it and what they need.",
    schedule: { kind: "weekdays", time: "09:00" },
    uses: ["gmail"],
    group: "day",
  },
  {
    id: "stripe-yesterday",
    name: "Yesterday in Stripe",
    category: "Payments",
    description: "Payments, refunds and failed charges from yesterday.",
    prompt: "Sum up yesterday in Stripe: payments and their total, refunds, and failed charges with why they failed.",
    schedule: { kind: "daily", time: "08:00" },
    uses: ["stripe"],
    group: "day",
  },
];

export const templateById = (id: string | undefined) => TEMPLATES.find((t) => t.id === id);
