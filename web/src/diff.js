// Pure helpers shared by the browser code and the tests.

// Word-level diff (LCS on tokens), rendered as <del>/<ins>.
const TOKENS = /\s+|[\p{L}\p{N}_\\'’-]+|[^\s\p{L}\p{N}_\\]/gu;
export function wordDiff(a, b) {
  const x = a.match(TOKENS) || [];
  const y = b.match(TOKENS) || [];
  const n = x.length;
  const m = y.length;
  if (n * m > 4e6) return [{ op: 'del', s: a }, { op: 'ins', s: b }];
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * (m + 1) + j] = x[i] === y[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
  const out = [];
  const push = (op, s) => (out.length && out[out.length - 1].op === op ? (out[out.length - 1].s += s) : out.push({ op, s }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) push('eq', x[i++]), j++;
    else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) push('del', x[i++]);
    else push('ins', y[j++]);
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('ins', y[j++]);
  return out;
}

