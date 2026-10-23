import type { AutomationSchedule } from "@rails/shared";

/**
 * A starting point for an automation (Automate's Templates): a name, its instructions and when, filled into a new
 * automation for the user to change before Create. `uses` is what the Sprocket needs to do it: its project (the
 * sessions, git and files it reads as its project's Coordinator) or a connector (shared CONNECTORS id).
 */
export interface AutomationTemplate {
  id: string;
  name: string;
  /** One line on what it tells you. */
  description: string;
  prompt: string;
  schedule: AutomationSchedule;
  uses: "project" | string;
  group: TemplateGroup;
}

export type TemplateGroup = "project" | "work" | "ops" | "day";

export const TEMPLATE_GROUPS: { id: TemplateGroup; title: string; blurb: string }[] = [
  { id: "project", title: "Your project", blurb: "For a Sprocket with a project: its agent sessions, git and files." },
  { id: "work", title: "Issues and code", blurb: "With a connector to where your team tracks work." },
  { id: "ops", title: "Errors and deploys", blurb: "Hourly checks that stay quiet until something breaks." },
  { id: "day", title: "Your day", blurb: "Mail, meetings and money, once a day." },
];

export const TEMPLATES: AutomationTemplate[] = [
  {
    id: "morning-brief",
    name: "Morning brief",
    description: "What each agent session did since the last run, and what waits for you.",
    prompt:
      "Look at the project's agent sessions. For each one that did something since the last run, say in one line what it did and whether it waits for me. Then list any files two sessions both changed.",
    schedule: { kind: "weekdays", time: "09:00" },
    uses: "project",
    group: "project",
  },
  {
    id: "uncommitted",
    name: "Uncommitted work",
    description: "Changes left uncommitted at the end of the day, and which look finished.",
    prompt:
      "Check the project's git status. If there are uncommitted changes, list the files, grouped by the session that changed them where you can tell, and say which look finished and which look half done.",
    schedule: { kind: "weekdays", time: "17:30" },
    uses: "project",
    group: "project",
  },
  {
    id: "week-in-commits",
    name: "Week in commits",
    description: "A short changelog of the week from the project's git history.",
    prompt: "Read this week's commits in the project's git log and write a short changelog: features, fixes and other changes, one line each.",
    schedule: { kind: "weekly", days: [5], time: "16:00" },
    uses: "project",
    group: "project",
  },
  {
    id: "linear-mine",
    name: "My Linear issues",
    description: "Issues assigned to you that changed since the last run.",
    prompt: "List the Linear issues assigned to me that changed since the last run, with what changed on each: status, priority or new comments.",
    schedule: { kind: "weekdays", time: "09:00" },
    uses: "linear",
    group: "work",
  },
  {
    id: "linear-triage",
    name: "Linear triage",
    description: "New issues with no owner or priority, with a suggestion for each.",
    prompt:
      "Find Linear issues created since the last run that have no assignee or no priority. For each, suggest a priority and an owner, with one line on why. Offer the changes as actions for me to run; don't make them yourself.",
    schedule: { kind: "weekdays", time: "10:00" },
    uses: "linear",
    group: "work",
  },
  {
    id: "github-reviews",
    name: "Reviews waiting on you",
    description: "Open pull requests that wait for your review, oldest first.",
    prompt: "List the open GitHub pull requests that wait for my review, oldest first, each with its repository, author and one line on what it changes.",
    schedule: { kind: "weekdays", time: "09:30" },
    uses: "github",
    group: "work",
  },
  {
    id: "sentry-new",
    name: "New Sentry errors",
    description: "Issues new since the last run, how often they happen and the likely cause.",
    prompt: "Look for Sentry issues first seen since the last run. For each, say how often it happened, where, and the likely cause in one line.",
    schedule: { kind: "hourly", minute: 0 },
    uses: "sentry",
    group: "ops",
  },
  {
    id: "vercel-failed",
    name: "Failed deployments",
    description: "Vercel deployments that failed since the last run, and why.",
    prompt: "Check Vercel for deployments that failed since the last run. For each, give the project, the branch and why it failed, from its build log.",
    schedule: { kind: "hourly", minute: 15 },
    uses: "vercel",
    group: "ops",
  },
  {
    id: "day-ahead",
    name: "Your day ahead",
    description: "Today's meetings, what each is about, and time free to focus.",
    prompt: "List today's meetings on my Google Calendar with what each is about, then say which stretches of the day are free to focus.",
    schedule: { kind: "weekdays", time: "08:30" },
    uses: "google-calendar",
    group: "day",
  },
  {
    id: "inbox",
    name: "Mail to answer",
    description: "Emails since the last run that ask something of you.",
    prompt: "Read my Gmail since the last run and list the emails that ask me something or wait for my answer, each with who sent it and what they need.",
    schedule: { kind: "weekdays", time: "09:00" },
    uses: "gmail",
    group: "day",
  },
  {
    id: "stripe-yesterday",
    name: "Yesterday in Stripe",
    description: "Payments, refunds and failed charges from yesterday.",
    prompt: "Sum up yesterday in Stripe: payments and their total, refunds, and failed charges with why they failed.",
    schedule: { kind: "daily", time: "08:00" },
    uses: "stripe",
    group: "day",
  },
];

export const templateById = (id: string | undefined) => TEMPLATES.find((t) => t.id === id);
