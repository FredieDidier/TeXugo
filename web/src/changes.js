// Marks in the margin for lines changed since a baseline: the text of the
// file at the last build that compiled it (or when it was opened). Added and
// changed lines get a bar; a deletion gets a small notch under the line
// before it. Turned off with the body class no-change-marks.
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';

export const setBaseline = StateEffect.define();

// Line-level diff of a against b: for each line of b, 'add' | 'mod' | null,
// and the lines of b after which something was deleted.
export function lineChanges(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const X = x.slice(p, x.length - s);
  const Y = y.slice(p, y.length - s);
  const marks = new Map();
  const dels = new Set();
  const n = X.length;
  const m = Y.length;
  if (n * m > 4e6) {
    for (let j = 0; j < m; j++) marks.set(p + j, 'mod');
    return { marks, dels };
  }
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * (m + 1) + j] = X[i] === Y[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
  let i = 0;
  let j = 0;
  let removed = 0; // deleted lines not yet paired with an added one
  while (i < n || j < m) {
    if (i < n && j < m && X[i] === Y[j]) {
      if (removed) dels.add(p + j - 1);
      removed = 0;
      i++, j++;
    } else if (j < m && (i >= n || dp[i * (m + 1) + j + 1] > dp[(i + 1) * (m + 1) + j])) {
      // An added line right after deleted ones is a changed line.
      marks.set(p + j, removed ? 'mod' : 'add');
      if (removed) removed--;
      j++;
    } else {
      removed++;
      i++;
    }
  }
  if (removed) dels.add(p + m - 1);
  return { marks, dels };
}

function build(state, base) {
  if (base == null) return Decoration.none;
  const { marks, dels } = lineChanges(base, state.doc.toString());
  const out = [];
  for (let k = 1; k <= state.doc.lines; k++) {
    const cls = [marks.get(k - 1) && `cm-chg-${marks.get(k - 1)}`, dels.has(k - 1) && 'cm-chg-del'].filter(Boolean).join(' ');
    if (cls) out.push(Decoration.line({ class: cls }).range(state.doc.line(k).from));
  }
  if (dels.has(-1)) out.unshift(Decoration.line({ class: 'cm-chg-del-top' }).range(0));
  return Decoration.set(out, true);
}

export const changesField = StateField.define({
  create: (state) => ({ base: state.doc.toString(), deco: Decoration.none }),
  update(v, tr) {
    let base = v.base;
    for (const e of tr.effects) if (e.is(setBaseline)) base = e.value;
    if (base === v.base && !tr.docChanged) return v;
    return { base, deco: build(tr.state, base) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});
