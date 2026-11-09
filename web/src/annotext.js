// Geometry of PDF annotations, pure (shared with the tests).

// Boxes [x1, y1, x2, y2] (PDF space, origin bottom-left) of an annotation:
// one per quad, or its rectangle.
export function quadBoxes(a) {
  const q = a.quadPoints;
  const out = [];
  if (q && q.length) {
    const flat = Array.isArray(q[0]) ? q.flat().flatMap((p) => (typeof p === 'object' ? [p.x, p.y] : [p])) : Array.from(q);
    for (let i = 0; i + 7 < flat.length; i += 8) {
      const xs = [flat[i], flat[i + 2], flat[i + 4], flat[i + 6]];
      const ys = [flat[i + 1], flat[i + 3], flat[i + 5], flat[i + 7]];
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  }
  if (!out.length && a.rect) out.push([Math.min(a.rect[0], a.rect[2]), Math.min(a.rect[1], a.rect[3]), Math.max(a.rect[0], a.rect[2]), Math.max(a.rect[1], a.rect[3])]);
  return out;
}

// The words of the page under the boxes (the highlighted text).
// pdf.js gives whole runs of text, so each run is cut to the part inside
// the box by the horizontal position of its characters.
export function textUnder(items, boxes, tol = 2) {
  const parts = [];
  for (const it of items) {
    const x1 = it.transform[4];
    const y1 = it.transform[5];
    const x2 = x1 + it.width;
    const hgt = it.height || Math.abs(it.transform[3]) || 8;
    for (const [a, b, c, d] of boxes) {
      // The box must cover most of the run's height (same line).
      const overlapY = Math.min(y1 + hgt, d) - Math.max(y1, b);
      if (x2 <= a - tol || x1 >= c + tol || overlapY < hgt * 0.4) continue;
      const n = it.str.length;
      if (!n || it.width <= 0) continue;
      // Each word counts when the box covers most (60%) of it.
      const cw = it.width / n;
      for (const m of it.str.matchAll(/\S+/g)) {
        const wx1 = x1 + m.index * cw;
        const wx2 = wx1 + m[0].length * cw;
        if (Math.min(wx2, c) - Math.max(wx1, a) >= (wx2 - wx1) * 0.6) parts.push({ y: -y1, x: wx1, s: m[0] });
      }
    }
  }
  parts.sort((p, q) => p.y - q.y || p.x - q.x);
  return parts.map((p) => p.s).join(' ').replace(/-\s+/g, '').replace(/\s+/g, ' ').trim();
}

