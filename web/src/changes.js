// Marks in the margin for lines changed since a baseline: the text of the
// file at the last build that compiled it (or when it was opened). Added and
// changed lines get a bar; a deletion gets a small notch under the line
// before it. Turned off with the body class no-change-marks.
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';

export const setBaseline = StateEffect.define();

// Myers' O((N+M)D) diff of two arrays of line ids: the edit script as runs
// of 'eq' | 'del' | 'ins'. Fast when the files differ in few places, which
// is the case while typing. Returns null past maxD edits.
function myers(X, Y, maxD) {
  const n = X.length;
  const m = Y.length;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && X[x] === Y[y]) x++, y++;
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, v, d, n, m, off);
    }
  }
  return null;
}

function backtrack(trace, last, D, n, m, off) {
  const ops = [];
  let x = n;
  let y = m;
  for (let d = D; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]);
    const pk = down ? k + 1 : k - 1;
    const px = v[off + pk];
    const py = px - pk;
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) ops.push('eq'), x--, y--;
    ops.push(down ? 'ins' : 'del');
    if (down) y--;
    else x--;
  }
  while (x > 0 && y > 0) ops.push('eq'), x--, y--;
  return ops.reverse();
}

// Line-level diff of a against b: for each line of b, 'add' | 'mod' | null,
// and the lines of b after which something was deleted.
export function lineChanges(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const ids = new Map();
  const id = (t) => {
    let k = ids.get(t);
    if (k === undefined) ids.set(t, (k = ids.size));
    return k;
  };
  const X = x.slice(p, x.length - s).map(id);
  const Y = y.slice(p, y.length - s).map(id);
  const marks = new Map();
  const dels = new Set();
  const ops = myers(X, Y, 2000);
  if (!ops) {
    // Thousands of separate edits: mark the whole changed range.
    for (let j = 0; j < Y.length; j++) marks.set(p + j, 'mod');
    return { marks, dels };
  }
  let j = 0;
  let removed = 0; // deleted lines not yet paired with an added one
  for (let t = 0; t < ops.length; t++) {
    const op = ops[t];
    if (op === 'eq') {
      if (removed) dels.add(p + j - 1);
      removed = 0;
      j++;
    } else if (op === 'del') {
      removed++;
    } else if (op === 'ins') {
      // An added line right after deleted ones is a changed line. Deletions
      // that come after insertions in the same run count as before them.
      let r = removed;
      for (let u = t; u < ops.length && ops[u] !== 'eq'; u++) if (ops[u] === 'del') r++;
      marks.set(p + j, r ? 'mod' : 'add');
      if (r) {
        // consume one deletion, from the run's pending ones first
        if (removed) removed--;
        else {
          const u = ops.indexOf('del', t + 1);
          ops[u] = 'skip';
        }
      }
      j++;
    }
  }
  if (removed) dels.add(p + Y.length - 1);
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
