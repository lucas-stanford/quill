/**
 * Minimal line-by-line diff helper for the round-trip check.
 * Returns an array of changed lines: { lineNo, original, result }.
 */
export function diffLines(a, b) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const maxLen = Math.max(aLines.length, bLines.length);
  const changes = [];
  for (let i = 0; i < maxLen; i++) {
    const aLine = aLines[i] ?? "<EOF>";
    const bLine = bLines[i] ?? "<EOF>";
    if (aLine !== bLine) {
      changes.push({ lineNo: i + 1, original: aLine, result: bLine });
    }
  }
  return changes;
}
