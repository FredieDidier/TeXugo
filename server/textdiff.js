// Word diff for prose, in character offsets. LaTeX lines are rewrapped all
// the time, so whitespace counts only as "space" or "paragraph break"; a
// line diff would flag whole paragraphs that only changed their wrapping.
// Paragraphs are aligned first and only the ones that differ are diffed
// word by word, which keeps long papers fast. Pure: the page bundles it too.

const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

export function tokens(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    const s = m[0];
    const space = /^\s/.test(s);
    out.push({ s, from: m.index, to: m.index + s.length, key: space ? (/\n[ \t]*\n/.test(s) ? '¶' : ' ') : s, word: !space && /[\p{L}\p{N}]/u.test(s) });
  }
  return out;
}

// Myers' diff on two arrays of keys: [['eq'|'del'|'ins', aIndex, bIndex]...]
// one entry per element. null when the edit distance passes maxD.
export function myers(a, b, maxD = 4000) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) x++, y++;
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vp = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vp[off + k - 1] < vp[off + k + 1]) ? k + 1 : k - 1;
    const px = vp[off + prevK];
    const py = px - prevK;
    while (x > px && y > py) ops.push(['eq', --x, --y]);
    if (x === px) ops.push(['ins', x, --y]);
    else ops.push(['del', --x, y]);
  }
  while (x > 0 && y > 0) ops.push(['eq', --x, --y]);
  return ops.reverse();
}

function paragraphs(text) {
  const out = [];
  const re = /\n[ \t]*\n\s*/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push({ from: start, to: m.index, key: text.slice(start, m.index).replace(/\s+/g, ' ').trim() });
    start = m.index + m[0].length;
  }
  out.push({ from: start, to: text.length, key: text.slice(start).replace(/\s+/g, ' ').trim() });
  return out;
}

// Changes from a to b as hunks { aFrom, aTo, bFrom, bTo } in characters.
// Hunks closer than `join` words are merged; whitespace-only changes are
// dropped.
export function hunks(a, b, { join = 3 } = {}) {
  if (a === b) return [];
  const pa = paragraphs(a);
  const pb = paragraphs(b);
  const pops = myers(
    pa.map((p) => p.key),
    pb.map((p) => p.key),
  );
  // Runs of paragraphs that differ, as character ranges in a and b.
  const runs = [];
  if (!pops) runs.push({ aFrom: 0, aTo: a.length, bFrom: 0, bTo: b.length });
  else {
    let ai = 0;
    let bi = 0;
    let open = null;
    const span = (ps, i0, i1, len) => (i1 > i0 ? [ps[i0].from, ps[i1 - 1].to] : i0 < ps.length ? [ps[i0].from, ps[i0].from] : [len, len]);
    const close = () => {
      if (!open) return;
      const [aFrom, aTo] = span(pa, open.a, ai, a.length);
      const [bFrom, bTo] = span(pb, open.b, bi, b.length);
      runs.push({ aFrom, aTo, bFrom, bTo });
      open = null;
    };
    for (const [op] of pops) {
      if (op === 'eq') {
        close();
        ai++, bi++;
      } else {
        if (!open) open = { a: ai, b: bi };
        if (op === 'del') ai++;
        else bi++;
      }
    }
    close();
  }

  const out = [];
  for (const r of runs) {
    const ta = tokens(a.slice(r.aFrom, r.aTo));
    const tb = tokens(b.slice(r.bFrom, r.bTo));
    const ops = myers(
      ta.map((t) => t.key),
      tb.map((t) => t.key),
      2000,
    );
    if (!ops) {
      out.push({ aFrom: r.aFrom, aTo: r.aTo, bFrom: r.bFrom, bTo: r.bTo });
      continue;
    }
    // Group edits; merge groups separated by fewer than `join` equal words.
    let cur = null;
    let gapWords = 0;
    let gap = [];
    const flush = () => {
      if (cur) out.push(cur), (cur = null);
    };
    const posA = (i) => r.aFrom + (i < ta.length ? ta[i].from : ta.length ? ta[ta.length - 1].to : 0);
    const posB = (j) => r.bFrom + (j < tb.length ? tb[j].from : tb.length ? tb[tb.length - 1].to : 0);
    for (const [op, i, j] of ops) {
      if (op === 'eq') {
        if (!cur) continue;
        gap.push([i, j]);
        if (ta[i].word) gapWords++;
        if (gapWords >= join) flush(), (gap = []), (gapWords = 0);
        continue;
      }
      if (!cur) cur = { aFrom: posA(i), aTo: posA(i), bFrom: posB(j), bTo: posB(j) };
      gap = [];
      gapWords = 0;
      if (op === 'del') cur.aTo = r.aFrom + ta[i].to, (cur.bTo = Math.max(cur.bTo, posB(j)));
      else cur.bTo = r.bFrom + tb[j].to, (cur.aTo = Math.max(cur.aTo, posA(i)));
    }
    flush();
  }
  return out.filter((x) => a.slice(x.aFrom, x.aTo).replace(/\s+/g, ' ').trim() !== b.slice(x.bFrom, x.bTo).replace(/\s+/g, ' ').trim());
}

// Word-level pieces of a change for display: [['eq'|'del'|'ins', text]...].
export function pieces(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  const ops = myers(
    ta.map((t) => t.key),
    tb.map((t) => t.key),
    3000,
  );
  if (!ops) return [['del', a], ['ins', b]];
  const out = [];
  const push = (k, s) => (out.length && out[out.length - 1][0] === k ? (out[out.length - 1][1] += s) : out.push([k, s]));
  for (const [op, i, j] of ops) push(op, op === 'ins' ? tb[j].s : ta[i].s);
  return out;
}
