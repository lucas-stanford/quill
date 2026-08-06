import { useCallback, useRef, useState } from "react";
import { fetchRevision, requestSectionRevision } from "../api";
import type { RevisionScope, RevisionStatus } from "../types";
import { appendSection, replaceSection, splitSections } from "./sections";
import type { Section } from "./sections";

/**
 * companions/useSectionRevision.ts
 *
 * Asking the agent to redo, deepen or add a line of enquiry.
 *
 * The request rides the plan's own bridge with routing attached, so an agent
 * that already services **Update with AI** services this too — and one request
 * in flight stays one request in flight.
 *
 * What comes back is the section, not the document. Quill splices it into the
 * text it already has rather than trusting a whole-file rewrite, which is what
 * keeps a re-run of one section from reflowing the rest of the file and turning
 * a targeted question into a diff nobody can read.
 *
 * Nothing is overwritten irrecoverably: the text as it stood before the splice
 * is kept, and `undo()` puts it back. That is the same promise the plan's
 * tracked changes make, at the granularity this document works in.
 */

const POLL_MS = 400;
const MAX_WAIT_MS = 15 * 60 * 1000;

export interface SectionRevisionApi {
  status: RevisionStatus;
  error: string | null;
  /** The section being worked on, for the pending state. */
  pending: string | null;
  /** Set once a result has landed, until it is dismissed. */
  undo: (() => void) | null;
  run: (
    section: Section | null,
    kind: RevisionScope["kind"],
    mode: RevisionScope["mode"],
    note: string,
  ) => void;
  dismiss: () => void;
}

export interface UseSectionRevisionOptions {
  /** The companion's file name, e.g. "research.md". */
  document: string | null;
  markdown: string;
  /** How a landed result is written back. */
  onResult: (markdown: string) => void;
}

/** What the agent is told to do, rendered from the scope. */
export function renderSectionPrompt(scope: RevisionScope): string {
  const lines: string[] = [];

  if (scope.kind === "add") {
    lines.push(
      `Open a NEW line of enquiry and append it to ${scope.document} as its own \`##\``,
      "section, at the end. Do not alter any section that is already there.",
    );
  } else if (scope.kind === "redo") {
    lines.push(
      `Re-run ONE line of enquiry in ${scope.document}. The section named below is`,
      "what we have; treat it as unreliable rather than as a starting point, and go",
      "and find out again.",
      scope.mode === "replace"
        ? "Replace that section with what you find."
        : "Leave it where it is and add your findings after it as a further pass.",
    );
  } else {
    lines.push(
      `Take ONE line of enquiry in ${scope.document} further. Keep what is already`,
      "established and answer the question below in addition to it.",
      scope.mode === "replace"
        ? "Replace that section with the fuller version."
        : "Leave it where it is and add the fuller version after it.",
    );
  }

  lines.push(
    "",
    `Edit ${scope.document} on disk. Leave every OTHER section byte-identical — this`,
    "is a targeted question, and a rewrite of the whole file turns it into a diff",
    "nobody can read. Then answer on the bridge as usual.",
    "",
    "Rules for what you write:",
    "- A URL for every claim. An uncited assertion is a guess wearing a suit.",
    "- Prefer primary sources — docs, source, postmortems, the spec itself.",
    "- Where sources disagree, say so, and say which one this project should follow.",
    "- Keep the heading style and depth of the section you are replacing.",
  );

  if (scope.note) {
    lines.push("", "=== WHAT THE REVIEWER ASKED FOR ===", "", scope.note);
  }

  if (scope.kind !== "add") {
    lines.push("", "=== THE SECTION AS IT STANDS ===", "", scope.text);
  }

  return lines.join("\n") + "\n";
}

export function useSectionRevision({
  document,
  markdown,
  onResult,
}: UseSectionRevisionOptions): SectionRevisionApi {
  const [status, setStatus] = useState<RevisionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [undo, setUndo] = useState<(() => void) | null>(null);

  const busyRef = useRef(false);
  const markdownRef = useRef(markdown);
  markdownRef.current = markdown;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const dismiss = useCallback(() => {
    setUndo(null);
    setError(null);
    setStatus("idle");
  }, []);

  const run = useCallback(
    (
      section: Section | null,
      kind: RevisionScope["kind"],
      mode: RevisionScope["mode"],
      note: string,
    ) => {
      if (document === null || busyRef.current) return;
      if (kind !== "add" && section === null) return;

      const scope: RevisionScope = {
        document,
        heading: section ? `${"#".repeat(section.level)} ${section.title}` : "",
        text: section?.text ?? "",
        kind,
        mode,
      };
      if (note.trim()) scope.note = note.trim();

      busyRef.current = true;
      setStatus("queued");
      setError(null);
      setUndo(null);
      setPending(section?.title ?? "a new line of enquiry");

      /** The document as it stood, so a bad answer costs one click. */
      const before = markdownRef.current;

      const land = (answer: string) => {
        const cleaned = stripFence(answer).trim();
        if (cleaned === "") {
          setStatus("failed");
          setError("The agent returned nothing, so the document was not changed.");
          return;
        }
        /*
         * Two shapes arrive here, and both are legitimate.
         *
         * The bridge answers by reading the target file back, so an agent that
         * edited the section in place returns the WHOLE document with the change
         * already in it — that is used as-is. An agent that returned only the
         * new section instead is spliced into the document Quill already has.
         * Splicing a whole file into one section would nest the research inside
         * itself, so the two are told apart before anything is written.
         */
        const next = isWholeDocument(cleaned, before)
          ? cleaned
          : kind === "add" || mode === "append" || section === null
            ? appendSection(before, cleaned)
            : replaceSection(before, section, cleaned);
        onResultRef.current(next);
        setStatus("done");
        setUndo(() => () => {
          onResultRef.current(before);
          setUndo(null);
        });
      };

      void poll(scope, land)
        .catch((cause: unknown) => {
          setStatus("failed");
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          busyRef.current = false;
          setPending(null);
        });
    },
    [document],
  );

  return { status, error, pending, undo, run, dismiss };

  async function poll(scope: RevisionScope, land: (answer: string) => void): Promise<void> {
    // The brief carries the document under review; the prompt carries the ask.
    await requestSectionRevision(
      { markdown: markdownRef.current, comments: [], edits: [] },
      renderSectionPrompt(scope),
      scope,
    );

    const deadline = Date.now() + MAX_WAIT_MS;
    for (;;) {
      await sleep(POLL_MS);
      const state = await fetchRevision();
      if (state.status === "working" || state.status === "queued") {
        setStatus(state.status);
        if (Date.now() > deadline) throw new Error("The agent did not answer in time.");
        continue;
      }
      if (state.status === "done") {
        land(state.markdown ?? "");
        return;
      }
      if (state.status === "cancelled") {
        setStatus("cancelled");
        return;
      }
      throw new Error(state.error?.trim() || "The agent could not answer.");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((fulfill) => setTimeout(fulfill, ms));
}

/**
 * Agents fence things. The prompt says not to, and they do anyway, and a fence
 * around the answer would land in the document as a code block containing the
 * research rather than as the research.
 */
function stripFence(text: string): string {
  const fenced = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return fenced ? fenced[1]! : text;
}

/**
 * Is this the whole document, or one section of it?
 *
 * A whole document keeps its title line, and has more than one section in it.
 * One section has neither. Getting this wrong in the safe direction — treating
 * a section as a document — would throw the rest of the research away, so the
 * test asks for both signals rather than either.
 */
function isWholeDocument(answer: string, before: string): boolean {
  const title = before.split("\n").find((line) => /^#\s+\S/.test(line));
  if (title && answer.includes(title)) return true;
  return splitSections(answer).length > 1;
}
