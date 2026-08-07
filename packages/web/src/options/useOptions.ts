/**
 * options/useOptions.ts
 *
 * Candidate names as they come back, and picking one.
 *
 * Quill never invents them and no longer asks for them on its own: the request
 * goes out in the revision brief with every other note (see
 * `revision/briefFormat.ts`), the agent writes `research/options.json`, and
 * this hook reads it and writes back the decisions. Same bargain as the
 * examples gallery, for the same reason — this process binds to loopback and
 * does not fetch.
 *
 * Rounds, not one list. Asking again with sharper steering is how naming
 * actually goes, and a round records what was asked as well as what came back —
 * including the candidates you ruled out, which is what stops the next round
 * offering them back to you.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOptions, saveOptions } from "../api";
import type { OptionPoll, OptionsManifest } from "../types";

export interface OptionsApi {
  polls: OptionPoll[];
  error: string | null;
  /** This one wins. Picking the current winner again un-picks it. */
  choose: (pollId: string, optionId: string) => void;
  /** Rule one out — kept, so a later round does not offer it again. */
  drop: (pollId: string, optionId: string, dropped: boolean) => void;
  /** Re-read the file. Called when a revision lands, which is when it changes. */
  reload: () => void;
}

export function useOptions(enabled: boolean): OptionsApi {
  const [polls, setPolls] = useState<OptionPoll[]>([]);
  const [error, setError] = useState<string | null>(null);

  const revisionRef = useRef("");
  const aliveRef = useRef(true);
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

  return { polls, error, choose, drop, reload };
}
