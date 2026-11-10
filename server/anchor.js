// Where a comment's passage is now. A comment keeps the passage it was made
// on (quote), a little text before and after it, and the line it was on.
// After edits, pulls and coauthors' changes, the passage is found again by
// its text: among several copies, the one whose surroundings match and that
// sits nearest the old line wins. Pure: the page bundles it too.

export const CONTEXT = 40;

// The anchor for text[from, to).
export function anchorAt(text, from, to) {
  return {
    quote: text.slice(from, to),
    before: text.slice(Math.max(0, from - CONTEXT), from),
    after: text.slice(to, to + CONTEXT),
    line: text.slice(0, from).split('\n').length,
  };
}

const lineOf = (text, pos) => {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

// Characters two strings share from the end of a / the start of b.
function commonSuffix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefix(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function best(text, a, hits, len) {
  let top = null;
  for (const from of hits) {
    const to = from + len(from);
    const ctx = commonSuffix(text.slice(Math.max(0, from - CONTEXT), from), a.before || '') + commonPrefix(text.slice(to, to + CONTEXT), a.after || '');
    const line = lineOf(text, from);
    const score = ctx * 10 - Math.min(500, Math.abs(line - (a.line || line)));
    if (!top || score > top.score) top = { from, to, line, score };
  }
  return top;
}

// Collapses runs of whitespace, keeping a map back to the original offsets.
function squeeze(s) {
  let out = '';
  const map = [];
  let space = false;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) {
      if (!space && out) (out += ' '), map.push(i);
      space = true;
    } else {
      out += s[i];
      map.push(i);
      space = false;
    }
  }
  map.push(s.length);
  return { out: out.trimEnd(), map };
}

// { from, to, line, exact } or null when the passage is gone. Exact copies
// and rewrapped ones compete on their surroundings, so an identical
// sentence elsewhere does not beat the commented one after a rewrap.
export function locate(text, a) {
  if (!a || !a.quote) return null;
  const hits = [];
  for (let i = text.indexOf(a.quote); i >= 0; i = text.indexOf(a.quote, i + 1)) hits.push(i);
  const exact = hits.length ? best(text, a, hits, () => a.quote.length) : null;
  if (exact) exact.score += 5;
  let loose = null;
  const q = squeeze(a.quote).out;
  if (q.length >= 3) {
    const t = squeeze(text);
    const sh = [];
    for (let i = t.out.indexOf(q); i >= 0; i = t.out.indexOf(q, i + 1)) sh.push(i);
    const orig = sh.map((i) => t.map[i]).filter((from) => !hits.includes(from));
    if (orig.length) {
      const endOf = new Map(sh.map((i) => [t.map[i], t.map[i + q.length - 1] + 1]));
      loose = best(text, a, orig, (from) => endOf.get(from) - from);
    }
  }
  const b = !loose || (exact && exact.score >= loose.score) ? exact : loose;
  return b ? { from: b.from, to: b.to, line: b.line, exact: b === exact } : null;
}
