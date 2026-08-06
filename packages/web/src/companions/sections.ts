/**
 * companions/sections.ts
 *
 * A research document, as the units you can act on.
 *
 * Research is not prose you converge on the way a plan is; it is an
 * accumulation of lines of enquiry, each with its own findings and citations.
 * So the unit that matters is the `##` section, not the sentence: you re-run a
 * line of enquiry, you cut one, you push one further. Everything the verbs do
 * is scoped to a section, which is also what keeps a re-run from rewriting the
 * parts of the document you were happy with.
 *
 * Pure string arithmetic, no DOM and no editor — the boundaries are computed
 * from the markdown source, which is what gets sent to the agent and what gets
 * written back to disk.
 */

export interface Section {
  /** Stable within one parse; the index is enough to address a section. */
  index: number;
  /** Heading text with the marker stripped: "Prior art". */
  title: string;
  /** Number of `#`. */
  level: number;
  /** Line index of the heading itself. */
  headingLine: number;
  /** Line index one past the section's last line. */
  endLine: number;
  /** The whole section including its heading, as it appears in the source. */
  text: string;
  /** The section's content, without the heading line. */
  body: string;
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const FENCE = /^(\s*)(```+|~~~+)/;

/**
 * Splits a document into its headed sections.
 *
 * Only headings at the document's shallowest heading level below the title are
 * treated as section starts, so a `###` inside a line of enquiry stays part of
 * that line of enquiry rather than becoming a unit of its own — re-running
 * "Sources" on its own would produce something with no question attached to it.
 *
 * A heading inside a fenced block is not a heading. Research documents quote
 * markdown constantly.
 */
export function splitSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const found: { line: number; level: number; title: string }[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2]!;
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence[0]!) && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      found.push({ line: i, level: heading[1]!.length, title: heading[2]!.trim() });
    }
  }

  if (found.length === 0) return [];

  // The document title is the single shallowest heading, when there is one of
  // it. Sections are the next level down.
  const shallowest = Math.min(...found.map((h) => h.level));
  const shallowestCount = found.filter((h) => h.level === shallowest).length;
  const sectionLevel =
    shallowestCount === 1 && found.length > 1
      ? Math.min(...found.filter((h) => h.level > shallowest).map((h) => h.level))
      : shallowest;

  const starts = found.filter((h) => h.level === sectionLevel);
  if (starts.length === 0) return [];

  return starts.map((start, index) => {
    const next = starts[index + 1];
    const endLine = next ? next.line : lines.length;
    const text = lines.slice(start.line, endLine).join("\n");
    return {
      index,
      title: start.title,
      level: start.level,
      headingLine: start.line,
      endLine,
      text,
      body: lines.slice(start.line + 1, endLine).join("\n").trim(),
    };
  });
}

/** The section containing a line, or null above the first heading. */
export function sectionAtLine(sections: readonly Section[], line: number): Section | null {
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i]!;
    if (line >= section.headingLine && line < section.endLine) return section;
  }
  return null;
}

/**
 * The document with one section replaced.
 *
 * Replacing rather than patching in place is deliberate: the agent is asked to
 * return a whole section, so what comes back is what the section now is. The
 * surrounding document is untouched byte for byte, which is what keeps a
 * re-run of one line of enquiry from reflowing the rest of the file.
 */
export function replaceSection(
  markdown: string,
  section: Section,
  replacement: string,
): string {
  const lines = markdown.split("\n");
  const tail = lines.slice(section.endLine);
  const body = replacement.replace(/\s+$/, "").split("\n");
  return [...lines.slice(0, section.headingLine), ...body, ...tail].join("\n");
}

/** The document with a section removed, and the blank line it left behind. */
export function removeSection(markdown: string, section: Section): string {
  const lines = markdown.split("\n");
  const before = lines.slice(0, section.headingLine);
  const after = lines.slice(section.endLine);

  // Cutting between two sections leaves the previous section's trailing blank
  // line and the next section's leading one back to back. One is enough.
  while (before.length > 0 && before[before.length - 1]!.trim() === "") before.pop();
  if (before.length > 0 && after.length > 0) before.push("");

  return [...before, ...after].join("\n");
}

/** The document with a section appended at the end. */
export function appendSection(markdown: string, text: string): string {
  const trimmed = markdown.replace(/\s+$/, "");
  const body = text.replace(/^\s+|\s+$/g, "");
  return `${trimmed}\n\n${body}\n`;
}
