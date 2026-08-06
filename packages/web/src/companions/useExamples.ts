/**
 * companions/useExamples.ts
 *
 * The gallery's state: what the agent found, and what you decided to keep.
 *
 * Quill does not go and look for anything — it binds to loopback and has no
 * egress story. The asking happens over the agent bridge and the answer arrives
 * as files on disk; this hook only reads the manifest, writes back your keep
 * and cut decisions, and knows the URL of each picture.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { exampleImageUrl, fetchExamples, saveExamples } from "../api";
import type { Example } from "../types";
export interface ExamplesApi {
  examples: Example[];
  loading: boolean;
  error: string | null;
  /** Removes one from the manifest. The file on disk is left alone. */
  cut: (id: string) => void;
  /** Re-reads the manifest — what a finished "find examples" request triggers. */
  reload: () => void;
  imageUrl: (image: string) => string;
}

export function useExamples(enabled: boolean): ExamplesApi {
  const [examples, setExamples] = useState<Example[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revisionRef = useRef("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    fetchExamples()
      .then((state) => {
        if (!aliveRef.current) return;
        setExamples(state.manifest.examples);
        revisionRef.current = state.revision;
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!aliveRef.current) return;
        // A server without the endpoint is an empty gallery, not a failure.
        setExamples([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const cut = useCallback((id: string) => {
    setExamples((prev) => {
      const next = prev.filter((example) => example.id !== id);
      void saveExamples({ version: 1, examples: next }, revisionRef.current)
        .then((state) => {
          if (!aliveRef.current) return;
          revisionRef.current = state.revision;
          // A conflict hands back what is on disk; adopt it rather than
          // insisting on a list that no longer matches the file.
          setExamples(state.manifest.examples);
        })
        .catch((cause: unknown) => {
          if (!aliveRef.current) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      return next;
    });
  }, []);

  return { examples, loading, error, cut, reload, imageUrl: exampleImageUrl };
}
