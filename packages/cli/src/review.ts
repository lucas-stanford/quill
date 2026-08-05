import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Sidecar, TicketPlan, TicketPreview } from "./types.js";

/**
 * A plan's job is to become work. Headings become parents, the steps beneath
 * them become children, and stated ordering becomes dependency edges.
 */

export const FER_COMMAND = "fer";

/** Exit codes. A parent branches on these without parsing prose. */
export const EXIT_APPROVED = 0;
export const EXIT_CANCELLED = 10;
export const EXIT_ERRORED = 11;

interface Heading {
  title: string;
  level: number;
  /** Body lines belonging to this heading, before the next one. */
  body: string[];
}

/** Splits markdown into headings, ignoring anything inside fenced code. */
function splitHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch = /^(\s*)(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence[0]) && marker.length >= fence.length) fence = null;
      if (out.length > 0) out[out.length - 1].body.push(line);
      continue;
    }
    if (fence !== null) {
      if (out.length > 0) out[out.length - 1].body.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      out.push({ level: heading[1].length, title: heading[2].trim(), body: [] });
      continue;
    }
    if (out.length > 0) out[out.length - 1].body.push(line);
  }

  return out;
}

/**
 * Numbered steps in a plan are almost always sequential, so they get dependency
 * edges. Bullets are a set of related things, not an order, so they do not —
 * inventing an order the author did not write would produce a board that lies.
 *
 * A step is its whole item, not its first line. A plan is soft-wrapped
 * markdown, so a sentence longer than the wrap width continues on an indented
 * line; reading only the line with the marker on it truncates the instruction
 * mid-sentence and hands an agent half a job. Continuation lines are folded
 * back into the title, and any nested list beneath a step is kept as that
 * step's detail rather than dropped.
 */
interface Step {
  title: string;
  ordered: boolean;
  /** Nested detail lines beneath the step, verbatim. */
  detail: string[];
}

function extractSteps(body: string[]): Step[] {
  const steps: Step[] = [];
  let fence: string | null = null;
  /** A blank line ends the item's opening sentence; what follows is detail. */
  let blankSeen = false;

  for (const raw of body) {
    const fenceMatch = /^(\s*)(```+|~~~+)/.exec(raw);
    if (fenceMatch) {
      const marker = fenceMatch[2];
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence[0]) && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;

    // Top-level list items only: an indented item is a detail of its parent.
    const ordered = /^(\d+)[.)]\s+(.*\S)\s*$/.exec(raw);
    if (ordered) {
      steps.push({ title: stripInline(ordered[2]), ordered: true, detail: [] });
      blankSeen = false;
      continue;
    }
    const bullet = /^[-*+]\s+(.*\S)\s*$/.exec(raw);
    if (bullet) {
      steps.push({ title: stripInline(bullet[1]), ordered: false, detail: [] });
      blankSeen = false;
      continue;
    }

    const step = steps[steps.length - 1];
    if (step === undefined) continue;

    // Blank, or back at column 0: the sentence is over. Scanning continues —
    // a heading's body may hold prose and then a second list.
    if (raw.trim() === "" || !/^\s/.test(raw)) {
      blankSeen = true;
      continue;
    }

    const trimmed = raw.trim();
    // An indented marker is a sub-item, and a line after a blank is a second
    // paragraph of the item: detail either way, never part of the title.
    if (blankSeen || /^(\d+[.)]|[-*+])\s+/.test(trimmed)) {
      step.detail.push(trimmed);
      continue;
    }
    step.title = `${step.title} ${stripInline(trimmed)}`.trim();
  }

  return steps;
}

/** Strips markdown emphasis and code ticks so a ticket title reads as prose. */
function stripInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/** Plans open with a title and a problem statement; neither is work. */
const NON_WORK = /^(problem|background|context|motivation|non-goals?|open questions?|principles?|appendix|glossary|risks?)$/i;

export function planToTickets(markdown: string): TicketPreview[] {
  const headings = splitHeadings(markdown);
  const tickets: TicketPreview[] = [];

  // A single H1 is the document title, not an epic.
  const topLevel = Math.min(...headings.map((h) => h.level), 6);
  const h1Count = headings.filter((h) => h.level === topLevel).length;
  const skipTitle = h1Count === 1;

  for (const heading of headings) {
    if (skipTitle && heading.level === topLevel) continue;
    if (NON_WORK.test(heading.title)) continue;

    const steps = extractSteps(heading.body);
    const prose = heading.body.join("\n").trim();

    const parentIndex = tickets.length;
    tickets.push({
      title: heading.title,
      level: heading.level,
      deps: [],
      body: steps.length > 0 ? undefined : prose || undefined,
    });

    let previousOrdered: number | null = null;
    for (const step of steps) {
      const index = tickets.length;
      tickets.push({
        title: step.title,
        level: heading.level + 1,
        parent: parentIndex,
        deps: step.ordered && previousOrdered !== null ? [previousOrdered] : [],
        // Sub-items are the step's detail. They are not steps of their own, but
        // they are still instructions, and a ticket that quietly drops them
        // gives an agent half the job.
        body: step.detail.length > 0 ? step.detail.join("\n") : undefined,
      });
      if (step.ordered) previousOrdered = index;
    }
  }

  return tickets;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((fulfill) => {
    // Argument array, never a shell string: plan headings are arbitrary text
    // and may contain quotes, backticks or command substitution.
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => (stderr += String(c)));
    child.on("error", (err) => fulfill({ code: -1, stdout, stderr: String(err) }));
    child.on("close", (code) => fulfill({ code: code ?? -1, stdout, stderr }));
  });
}

export async function ferAvailable(cwd: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const probe = await run(FER_COMMAND, ["--version"], cwd, env);
  return probe.code === 0;
}

export async function buildTicketPlan(
  planPath: string,
  markdown: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TicketPlan> {
  const cwd = dirnameOf(planPath);
  const tickets = planToTickets(markdown);

  if (!(await ferAvailable(cwd, env))) {
    return {
      available: false,
      tickets,
      reason: `\`${FER_COMMAND}\` is not on PATH — install ferricket to turn this plan into tickets`,
    };
  }
  return { available: true, tickets };
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export interface CreateTicketsResult {
  ids: string[];
  /** Set when the run stopped partway; the ids created so far are still real. */
  error?: string;
}

export async function createTickets(
  planPath: string,
  tickets: TicketPreview[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreateTicketsResult> {
  const cwd = dirnameOf(planPath);
  const ids: (string | null)[] = [];

  for (const ticket of tickets) {
    const args = ["create", ticket.title, "-t", ticket.parent === undefined ? "epic" : "task"];
    if (ticket.body) args.push("-d", ticket.body);
    const parentId = ticket.parent !== undefined ? ids[ticket.parent] : null;
    if (parentId) args.push("--parent", parentId);

    const result = await run(FER_COMMAND, args, cwd, env);
    if (result.code !== 0) {
      const made = ids.filter((id): id is string => id !== null);
      return {
        ids: made,
        error:
          `\`${FER_COMMAND} create\` failed on "${ticket.title}" after creating ${made.length} ticket(s). ` +
          `Those tickets are real and were left in place. ${result.stderr.trim() || result.stdout.trim()}`,
      };
    }
    ids.push(result.stdout.trim().split("\n").pop()?.trim() || null);
  }

  for (const [index, ticket] of tickets.entries()) {
    const id = ids[index];
    if (!id) continue;
    for (const dep of ticket.deps) {
      const depId = ids[dep];
      if (depId) await run(FER_COMMAND, ["dep", id, depId], cwd, env);
    }
  }

  return { ids: ids.filter((id): id is string => id !== null) };
}

/** Counts unresolved comments from the sidecar on disk, not from the browser. */
export async function countOpenComments(sidecarPath: string): Promise<number> {
  try {
    const raw = await readFile(sidecarPath, "utf-8");
    const parsed = JSON.parse(raw) as Sidecar;
    if (!Array.isArray(parsed?.comments)) return 0;
    return parsed.comments.filter((c) => !c.resolved).length;
  } catch {
    return 0;
  }
}
