// SyncTeX: source line -> PDF position (forward) and PDF click -> source
// line (inverse), through the synctex command line tool of TeX Live.
import path from 'node:path';
import { run } from './util.js';

function fields(stdout) {
  const blocks = [];
  let cur = null;
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(\w+):(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    // Every hit starts with an Output: line.
    if (k === 'Output') {
      if (cur) blocks.push(cur);
      cur = {};
    }
    if (cur) cur[k] = v;
  }
  if (cur) blocks.push(cur);
  return blocks;
}

export async function forward({ file, line, column = 0, pdf }) {
  const r = await run('synctex', ['view', '-i', `${line}:${column}:${file}`, '-o', pdf], { cwd: path.dirname(pdf), timeout: 10000 });
  if (r.code !== 0) return { ok: false, error: r.stderr || r.stdout };
  const hits = fields(r.stdout)
    .filter((b) => b.Page)
    .map((b) => ({ page: Number(b.Page), x: Number(b.x), y: Number(b.y), h: Number(b.h), v: Number(b.v), W: Number(b.W), H: Number(b.H) }));
  return { ok: hits.length > 0, hits };
}

export async function inverse({ pdf, page, x, y }) {
  const r = await run('synctex', ['edit', '-o', `${page}:${x}:${y}:${pdf}`], { cwd: path.dirname(pdf), timeout: 10000 });
  if (r.code !== 0) return { ok: false, error: r.stderr || r.stdout };
  const b = fields(r.stdout).find((x) => x.Input);
  if (!b) return { ok: false };
  return { ok: true, file: path.resolve(path.dirname(pdf), b.Input.trim()), line: Number(b.Line), column: Math.max(0, Number(b.Column)) };
}
