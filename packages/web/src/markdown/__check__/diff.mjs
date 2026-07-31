/**
 * Line diff used by the round-trip check.
 *
 * Longest-common-subsequence based, so inserting or removing a line reports one
 * change rather than shifting every line after it. That distinction is the
 * whole point of the check: "one keystroke rewrote 75 lines" has to be a number
 * you can trust.
 */

/** @returns {{ del: number, ins: number, total: number, hunks: string[] }} */
export function diffLines(a, b) {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;

  // lcs[i][j] = length of the longest common subsequence of A[i:] and B[j:]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        A[i] === B[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const hunks = [];
  let del = 0;
  let ins = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      hunks.push(`- ${A[i++]}`);
      del++;
    } else {
      hunks.push(`+ ${B[j++]}`);
      ins++;
    }
  }
  while (i < n) {
    hunks.push(`- ${A[i++]}`);
    del++;
  }
  while (j < m) {
    hunks.push(`+ ${B[j++]}`);
    ins++;
  }

  return { del, ins, total: del + ins, hunks };
}
