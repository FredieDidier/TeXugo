// "Biblioteca": the papers the user reads, kept once for every project.
// Each PDF is copied into the app's data folder (papers/<id>/<name>.pdf);
// its text, page by page, is extracted by pdf.js in the page and stored in
// text/<id>.json, so a search runs over every paper without opening them.
// Search ignores case and accents, wants every word on the same page, and
// takes "quoted phrases".
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dataDir } from './util.js';

export const libDir = () => {
  const d = path.join(dataDir(), 'library');
  fs.mkdirSync(path.join(d, 'papers'), { recursive: true });
  fs.mkdirSync(path.join(d, 'text'), { recursive: true });
  return d;
};
const indexFile = () => path.join(libDir(), 'index.json');
const textFile = (id) => path.join(libDir(), 'text', id + '.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
  } catch {
    return { papers: [] };
  }
}
function save(idx) {
  const tmp = indexFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
  fs.renameSync(tmp, indexFile());
}

const texts = new Map(); // id -> pages, read once
function pagesOf(id) {
  if (!texts.has(id)) {
    try {
      texts.set(id, JSON.parse(fs.readFileSync(textFile(id), 'utf8')).pages || []);
    } catch {
      texts.set(id, []);
    }
  }
  return texts.get(id);
}

const META = ['title', 'authors', 'year', 'doi', 'zkey'];
const pick = (o) => Object.fromEntries(META.filter((k) => o && o[k] != null).map((k) => [k, String(o[k]).trim()]));

export function list() {
  return load().papers.map((p) => ({ ...p, path: path.join(libDir(), 'papers', p.id, p.file) }));
}

// Copies a PDF in. The same file twice (same bytes) is recognized and not
// duplicated; meta from Zotero fills the fields the user would type.
export function addBuffer(buf, name, meta = {}) {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${name} não é um PDF.`);
  const id = createHash('sha1').update(buf).digest('hex').slice(0, 12);
  const idx = load();
  const had = idx.papers.find((p) => p.id === id);
  if (had) {
    // Zotero data beats a guess made from the PDF.
    if (meta.zkey && !had.zkey) {
      Object.assign(had, pick(meta));
      save(idx);
    }
    return { id, existed: true };
  }
  const file = (path.basename(name).replace(/[/\\:\0]/g, '-').replace(/\.pdf$/i, '') || 'paper') + '.pdf';
  const dir = path.join(libDir(), 'papers', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buf);
  idx.papers.push({ id, file, title: '', authors: '', year: '', doi: '', ...pick(meta), pages: 0, indexed: false, added: new Date().toISOString() });
  save(idx);
  return { id, existed: false };
}

export function addFile(src, meta) {
  return addBuffer(fs.readFileSync(src), path.basename(src), meta);
}

// The page sends the text it extracted, plus a guess at title/authors/year
// that only fills empty fields.
export function setText(id, pages, guess = {}) {
  const idx = load();
  const p = idx.papers.find((x) => x.id === id);
  if (!p) throw new Error('Paper não está na biblioteca.');
  const clean = (pages || []).map((s) => String(s || ''));
  fs.writeFileSync(textFile(id), JSON.stringify({ pages: clean }));
  texts.set(id, clean);
  p.pages = clean.length;
  p.indexed = true;
  for (const [k, v] of Object.entries(pick(guess))) if (v && !p[k]) p[k] = v;
  save(idx);
  return p;
}

export function update(id, meta) {
  const idx = load();
  const p = idx.papers.find((x) => x.id === id);
  if (!p) throw new Error('Paper não está na biblioteca.');
  Object.assign(p, pick(meta));
  save(idx);
  return p;
}

export function remove(id) {
  const idx = load();
  idx.papers = idx.papers.filter((p) => p.id !== id);
  save(idx);
  texts.delete(id);
  fs.rmSync(path.join(libDir(), 'papers', id), { recursive: true, force: true });
  fs.rmSync(textFile(id), { force: true });
  return true;
}

// Lowercase, accents off, PDF line-break hyphens joined, runs of space
// squeezed. `map[i]` is the index in the original of normalized char i, so
// a hit can be shown in the original text.
export function normalize(s) {
  let out = '';
  const map = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    // "adapta-\ntion" → "adaptation"
    if (c === '-' && /\s/.test(s[i + 1] || '') && /\p{L}/u.test(s[i - 1] || '')) {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (/\p{Ll}/u.test(s[j] || '') && /\n/.test(s.slice(i + 1, j))) {
        i = j - 1;
        continue;
      }
    }
    if (/\s/.test(c)) {
      if (!space) {
        out += ' ';
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    for (const d of c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) {
      out += d;
      map.push(i);
    }
  }
  return { text: out, map };
}

export function parseQuery(q) {
  const terms = [];
  String(q || '').replace(/"([^"]+)"|(\S+)/g, (_m, phrase, word) => {
    const t = normalize(phrase || word).text.trim();
    if (t) terms.push(t);
  });
  return terms;
}

function snippet(orig, norm, at, len) {
  const a = norm.map[at] ?? 0;
  const b = (norm.map[at + len - 1] ?? a) + 1;
  let s = Math.max(0, a - 90);
  let e = Math.min(orig.length, b + 110);
  while (s > 0 && !/\s/.test(orig[s - 1])) s--;
  while (e < orig.length && !/\s/.test(orig[e])) e++;
  const squeeze = (x) => x.replace(/(\p{L})-[ \t]*\n\s*(\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ');
  return { before: (s > 0 ? '…' : '') + squeeze(orig.slice(s, a)).trimStart(), hit: squeeze(orig.slice(a, b)), after: squeeze(orig.slice(b, e)).trimEnd() + (e < orig.length ? '…' : '') };
}

// Papers whose title/authors/year match, and pages that hold every term.
// Up to `perPaper` pages are returned per paper, with how many there are.
export function search(q, { perPaper = 4 } = {}) {
  const terms = parseQuery(q);
  if (!terms.length) return [];
  const out = [];
  for (const p of list()) {
    const meta = normalize([p.title, p.authors, p.year, p.file].join(' ')).text;
    const metaHit = terms.every((t) => meta.includes(t));
    const hits = [];
    let pagesHit = 0;
    let count = 0;
    pagesOf(p.id).forEach((page, i) => {
      const n = normalize(page);
      if (!terms.every((t) => n.text.includes(t))) return;
      pagesHit++;
      for (const t of terms) for (let at = n.text.indexOf(t); at >= 0; at = n.text.indexOf(t, at + t.length)) count++;
      if (hits.length < perPaper) {
        const first = terms.map((t) => [n.text.indexOf(t), t.length]).sort((x, y) => x[0] - y[0])[0];
        hits.push({ page: i + 1, ...snippet(page, n, first[0], first[1]) });
      }
    });
    if (metaHit || hits.length) out.push({ paper: p, metaHit, hits, pagesHit, count });
  }
  return out.sort((a, b) => b.metaHit - a.metaHit || b.count - a.count);
}
