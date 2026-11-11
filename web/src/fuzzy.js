// Fuzzy match for the command palette: the letters of the query in order,
// with a bonus for runs and word starts. Letters scattered over a long text
// do not count as a match ("body" is not "Biblioteca … library").

export function fuzzyScore(text, q) {
  text = text.toLowerCase();
  if (!q) return 0;
  const at = text.indexOf(q);
  // The query as written, with a bonus at the start of a word.
  if (at >= 0) return 100 + q.length * 3 + (at === 0 || /[\/._ -]/.test(text[at - 1]) ? 20 : 0) - at * 0.05 - text.length * 0.01;
  let ti = 0;
  let s = 0;
  let run = 0;
  let first = -1;
  let last = 0;
  let starts = 0;
  for (const ch of q) {
    const i = text.indexOf(ch, ti);
    if (i < 0) return -1;
    if (first < 0) first = i;
    last = i;
    run = i === ti ? run + 1 : 0;
    const start = i === 0 || /[\/._ :,(-]/.test(text[i - 1]);
    if (start) starts++;
    s += 1 + run * 2 + (start ? 3 : 0);
    ti = i + 1;
  }
  // Letters in order are a match when they sit close together or are the
  // initials of the words (sbt = sections/body.tex); spread out, they are not.
  if (starts < q.length && last - first + 1 > q.length * 2 + 2) return -1;
  return s - text.length * 0.01;
}

// Best score over several texts (title, title in another language, keywords).
export function bestScore(texts, q) {
  let best = -1;
  for (const t of texts) if (t) best = Math.max(best, fuzzyScore(t, q));
  return best;
}
