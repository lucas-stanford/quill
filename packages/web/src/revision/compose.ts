/**
 * revision/compose.ts
 *
 * The one call site of `buildBrief` and `formatBriefPrompt` (payload lane). It
 * exists so the wiring between the control and the payload — which arguments
 * go where, what an "empty" instruction means, and when there is nothing worth
 * sending — is a thing that can be tested without a DOM.
 *
 * The instruction is what the user typed in the popover. Whitespace, or nothing
 * at all, is not an instruction: the field is dropped so the agent is never
 * handed an empty string to interpret.
 */

import type { AnnotationsApi } from "../annotations";
import type { TrackedChangesApi } from "../tracking";
import type { RevisionBrief, BriefPoll } from "../types";
import { buildBrief, formatBriefPrompt, isBriefEmpty } from "./buildBrief";
export function composeBrief(
  markdown: string,
  annotations: AnnotationsApi,
  tracking: TrackedChangesApi,
  instruction?: string,
): RevisionBrief {
  return buildBrief(markdown, annotations, tracking, cleanInstruction(instruction));
}

/**
 * The same brief with the popover's note attached, without scanning the plan
 * again. `buildBrief` puts the trimmed instruction in a field and derives
 * nothing else from it, so this is exactly what a rebuild would produce — which
 * is what lets `useRevision` memoize the brief across renders and still send a
 * current one.
 */
export function withInstruction(brief: RevisionBrief, instruction?: string): RevisionBrief {
  const note = cleanInstruction(instruction);
  if (note === undefined) {
    if (brief.instruction === undefined) return brief;
    const { instruction: _dropped, ...rest } = brief;
    return rest;
  }
  return { ...brief, instruction: note };
}

/**
 * The same brief with a request for candidate names attached.
 *
 * Separate from `composeBrief` for the same reason the instruction is: it comes
 * from the dialog rather than from the document, so attaching it must not cost
 * another scan of the plan and must not invalidate the memo the scan produced.
 */
export function withPolls(brief: RevisionBrief, polls?: readonly BriefPoll[]): RevisionBrief {
  if (!polls || polls.length === 0) {
    if (brief.polls === undefined) return brief;
    const { polls: _dropped, ...rest } = brief;
    return rest;
  }
  return { ...brief, polls: [...polls] };
}

/**
 * The prompt the browser renders and the request carries, or `null` when the
 * brief asks for nothing.
 *
 * The prompt crosses the wire because there is exactly one prompt
 * implementation in the product and it lives in the browser (CONTRACT.md).
 * `formatBriefPrompt` throws on an empty brief on purpose — a no-op round trip
 * is not free, it hands the model a document it was not asked to change — so
 * `isBriefEmpty` is checked first and the null is how that refusal reaches the
 * user as a sentence instead of an unhandled exception.
 */
export function renderPrompt(brief: RevisionBrief): string | null {
  if (isBriefEmpty(brief)) return null;
  return formatBriefPrompt(brief);
}

function cleanInstruction(instruction?: string): string | undefined {
  const note = instruction?.trim();
  return note ? note : undefined;
}
