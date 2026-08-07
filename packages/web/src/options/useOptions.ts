/**
 * options/useOptions.ts
 *
 * Candidate names, and picking one.
 *
 * Quill never invents them: the asking goes out over the agent bridge, the
 * agent writes `research/options.json`, and this hook reads it and writes back
 * the decisions. Same bargain as the examples gallery, for the same reason —
 * this process binds to loopback and does not fetch.
 *
 * Rounds, not one list. Asking again with sharper steering is how naming
 * actually goes, and a round records what was asked as well as what came back —
 * including the candidates you ruled out, which is what stops the next round
 * offering them back to you.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOptions, fetchRevision, requestSectionRevision, saveOptions } from "../api";
import type { OptionPoll, OptionsManifest, RevisionScope, RevisionStatus } from "../types";

const POLL_MS = 400;
const MAX_WAIT_MS = 10 * 60 * 1000;

export interface OptionsApi {
  polls: OptionPoll[];
  status: RevisionStatus;
  error: string | null;
  /** Ask for a round of candidates. `steering` may be empty. */
  ask: (subject: string, steering: string) => void;
  /** This one wins. Picking the current winner again un-picks it. */
  choose: (pollId: string, optionId: string) => void;
  /** Rule one out — kept, so a later round does not offer it again. */
  drop: (pollId: string, optionId: string, dropped: boolean) => void;
  reload: () => void;
}

export function useOptions(enabled: boolean): OptionsApi {
  const [polls, setPolls] = useState<OptionPoll[]>([]);
  const [status, setStatus] = useState<RevisionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const revisionRef = useRef("");
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const pollsRef = useRef<OptionPoll[]>([]);
  pollsRef.current = polls;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    fetchOptions()
      .then((state) => {
        if (!aliveRef.current) return;
        setPolls(state.manifest.polls);
        revisionRef.current = state.revision;
      })
      .catch(() => {
        // No endpoint and no file are both "nothing yet", not a failure.
        if (aliveRef.current) setPolls([]);
      });
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const persist = useCallback((next: OptionPoll[]) => {
    setPolls(next);
    const manifest: OptionsManifest = { version: 1, polls: next };
    void saveOptions(manifest, revisionRef.current)
      .then((state) => {
        if (!aliveRef.current) return;
        revisionRef.current = state.revision;
        setPolls(state.manifest.polls);
      })
      .catch((cause: unknown) => {
        if (aliveRef.current) setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  const choose = useCallback(
    (pollId: string, optionId: string) => {
      persist(
        pollsRef.current.map((poll) =>
          poll.id === pollId
            ? // Picking the winner again un-picks it. Without that, changing
              // your mind means editing a JSON file by hand.
              { ...poll, chosen: poll.chosen === optionId ? undefined : optionId }
            : poll,
        ),
      );
    },
    [persist],
  );

  const drop = useCallback(
    (pollId: string, optionId: string, dropped: boolean) => {
      persist(
        pollsRef.current.map((poll) =>
          poll.id === pollId
            ? {
                ...poll,
                options: poll.options.map((o) => (o.id === optionId ? { ...o, dropped } : o)),
                chosen: dropped && poll.chosen === optionId ? undefined : poll.chosen,
              }
            : poll,
        ),
      );
    },
    [persist],
  );

  const ask = useCallback(
    (subject: string, steering: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setStatus("queued");
      setError(null);

      const scope: RevisionScope = {
        document: "research/options.json",
        heading: subject.trim() || "name",
        text: "",
        kind: "options",
        mode: "append",
      };
      if (steering.trim()) scope.note = steering.trim();

      void run(scope)
        .then(() => {
          reload();
          setStatus("done");
        })
        .catch((cause: unknown) => {
          setStatus("failed");
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          busyRef.current = false;
        });
    },
    [reload],
  );

  return { polls, status, error, ask, choose, drop, reload };

  async function run(scope: RevisionScope): Promise<void> {
    await requestSectionRevision(
      { markdown: "", comments: [], edits: [] },
      renderOptionsPrompt(scope, pollsRef.current),
      scope,
    );

    const deadline = Date.now() + MAX_WAIT_MS;
    for (;;) {
      await sleep(POLL_MS);
      const state = await fetchRevision();
      if (state.status === "queued" || state.status === "working") {
        setStatus(state.status);
        if (Date.now() > deadline) throw new Error("The agent did not answer in time.");
        continue;
      }
      if (state.status === "done" || state.status === "cancelled") return;
      throw new Error(state.error?.trim() || "The agent could not answer.");
    }
  }
}

/** What the agent is told to do. Exported so it can be tested without a DOM. */
export function renderOptionsPrompt(
  scope: RevisionScope,
  previous: readonly OptionPoll[],
): string {
  const subject = scope.heading || "name";
  const seen = new Set<string>();
  for (const poll of previous) {
    for (const option of poll.options) seen.add(option.value);
  }

  const lines = [
    `Come up with candidate ${subject}s for this project and write them to`,
    "`research/options.json`, adding a NEW poll to the `polls` array and keeping",
    "every poll already there — the rounds are the argument, not just the answer.",
    "",
    "```json",
    '{ "version": 1, "polls": [',
    '  { "id": "…", "subject": "name", "steering": "what was asked for",',
    '    "createdAt": "2026-08-06T00:00:00.000Z", "options": [',
    '      { "id": "…", "value": "Steel Sunrise",',
    '        "note": "Why it works, in one line.", "dropped": false } ] } ] }',
    "```",
    "",
    "Rules:",
    "- Eight to twelve candidates. Fewer is not a choice; more is a list nobody reads.",
    `- Every one gets a \`note\` saying why it works. A ${subject} with no argument`,
    "  behind it cannot be weighed against one that has.",
    "- Spread them out: eight variations of one idea is one candidate.",
    "- Check availability where that is cheap — a taken name is not a candidate.",
    "- Do not set `chosen`. Picking is the reviewer's job, not yours.",
    "- Touch nothing else: not the plan, not the research.",
  ];

  if (seen.size > 0) {
    lines.push(
      "",
      "=== ALREADY OFFERED — do not repeat any of these ===",
      "",
      [...seen].map((value) => `- ${value}`).join("\n"),
    );
  }

  if (scope.note) {
    lines.push("", "=== WHAT THE REVIEWER ASKED FOR ===", "", scope.note);
  }

  return lines.join("\n") + "\n";
}

function sleep(ms: number): Promise<void> {
  return new Promise((fulfill) => setTimeout(fulfill, ms));
}
