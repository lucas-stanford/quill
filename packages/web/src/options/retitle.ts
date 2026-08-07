/**
 * options/retitle.ts
 *
 * Giving a document the name you picked.
 *
 * A plan states what it is called in exactly one place — its `# H1` — so taking
 * a candidate means rewriting that line and nothing else. Every other byte is
 * left alone, because this is a rename, not a revision, and a rename that
 * reflows the file is a diff nobody can read.
 */

const H1 = /^#\s+\S/;
const FENCE = /^(\s*)(```+|~~~+)/;

/**
 * The document with its title set to `value`.
 *
 * When there is no title, one is added at the top: a plan with a name and
 * nowhere to say it would lose the name on the next round trip.
 */
export function retitle(markdown: string, value: string): string {
  const name = value.trim();
  if (name === "") return markdown;

  const lines = markdown.split("\n");
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // A "# heading" inside a fenced block is a shell prompt or a comment, not
    // this document's title.
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[2]!;
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence[0]!) && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;

    if (H1.test(line)) {
      const next = [...lines];
      next[i] = `# ${name}`;
      return next.join("\n");
    }
  }

  return `# ${name}\n\n${markdown.replace(/^\s+/, "")}`;
}
