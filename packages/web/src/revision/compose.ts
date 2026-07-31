import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { RevisionBrief } from "../types";
import { buildBrief } from "./buildBrief";

/**
 * revision/compose.ts
 *
 * The one call site of `buildBrief` (payload lane). It exists so the wiring
 * between the control and the payload — which arguments go where, and what an
 * "empty" instruction means — is a thing that can be tested without a DOM.
 *
 * The instruction is what the user typed in the popover. Whitespace, or nothing
 * at all, is not an instruction: the field is dropped so the agent is never
 * handed an empty string to interpret.
 */
export function composeBrief(
  markdown: string,
  annotations: AnnotationsApi,
  tracking: TrackedChangesApi,
  instruction?: string,
): RevisionBrief {
  const note = instruction?.trim();
  return buildBrief(markdown, annotations, tracking, note ? note : undefined);
}
