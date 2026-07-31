/** FROZEN PROP CONTRACT — the shape may not change; the implementation is yours. */
export interface PlanEditorProps {
  /** Raw markdown source of the plan. */
  markdown: string;
}

// STUB — replaced by the editor workstream.
export function PlanEditor({ markdown }: PlanEditorProps) {
  return <pre>{markdown}</pre>;
}
