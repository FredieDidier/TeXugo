// "Versões enviadas": the same paper goes to a coauthor and to a friend;
// the coauthor's fixes are already in when the friend's come back. Comparing
// the friend's version with today's text would show the coauthor's fixes as
// if the friend had undone them. So TeXugo keeps what was sent (a snapshot
// of the document's sources, its PDF and SyncTeX in .texugo/sent/<id>/) and
// compares what comes back with THAT, which isolates the friend's changes.
// Each change is then looked for in today's text (server/anchor.js):
//   aplica    the passage is as it was sent: one click applies it;
//   feita     today's text already has it (someone made the same fix);
//   conflito  the passage changed since it was sent: show the three versions;
//   sumiu     the passage is gone.
// When nothing was marked, the base is guessed: the sent version or recent
// Git commit closest to what came back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { includeClosure } from './project.js';
import { buildMirror } from './compare.js';
import { anchorAt, locate } from './anchor.js';
import { hunks, tokens, pieces } from './textdiff.js';
import { run, readText } from './util.js';

const ID = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/;
const dirOf = (root) => path.join(root, '.texugo', 'sent');
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const newId = () => `${stamp()}-${randomBytes(2).toString('hex')}`;
const rel = (from, to) => path.relative(from, to).split(path.sep).join('/');
const checkId = (id) => {
  if (!ID.test(id || '')) throw new Error('Versão inválida.');
  return id;
};

// ------------------------------------------------------------ marking

// The text files of a document (main + \input/\include), relative to its
// folder, with their contents now.
function sources(doc) {
  const dir = path.dirname(doc);
  const out = {};
  for (const f of includeClosure(doc)) {
    const r = rel(dir, f);
    const t = readText(f);
    if (t != null) out[r] = t;
  }
  return out;
}

export async function mark(root, doc, { to = '', note = '' } = {}) {
  root = path.resolve(root);
  const id = newId();
  const dir = path.join(dirOf(root), id);
  const files = sources(doc);
  for (const [r, text] of Object.entries(files)) {
    const target = path.join(dir, 'src', r);
    if (!target.startsWith(path.join(dir, 'src'))) continue; // ../ inputs: kept by name below
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  // Inputs above the document folder (../sections/x.tex) go in a flat map.
  const outside = Object.fromEntries(Object.entries(files).filter(([r]) => r.startsWith('..')));
  if (Object.keys(outside).length) fs.writeFileSync(path.join(dir, 'outside.json'), JSON.stringify(outside));
  // The PDF as sent, and its SyncTeX, to read an annotated copy against.
  const stem = doc.replace(/\.tex$/, '');
  let pdf = null;
  let stale = false;
  if (fs.existsSync(stem + '.pdf')) {
    fs.copyFileSync(stem + '.pdf', path.join(dir, 'sent.pdf'));
    pdf = 'sent.pdf';
    if (fs.existsSync(stem + '.synctex.gz')) fs.copyFileSync(stem + '.synctex.gz', path.join(dir, 'sent.synctex.gz'));
    const pdfTime = fs.statSync(stem + '.pdf').mtimeMs;
    stale = [...includeClosure(doc)].some((f) => {
      try {
        return fs.statSync(f).mtimeMs > pdfTime + 1000;
      } catch {
        return false;
      }
    });
  }
  let commit = null;
  const r = await run('git', ['-C', path.dirname(doc), 'rev-parse', 'HEAD'], { timeout: 8000 });
  if (r.code === 0) commit = r.stdout.trim();
  const meta = { id, doc: rel(root, doc), to: String(to).trim().slice(0, 200), note: String(note).trim().slice(0, 1000), date: new Date().toISOString(), files: Object.keys(files), pdf, stale, commit };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

export function list(root) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dirOf(root));
  } catch {}
  for (const n of names) {
    if (!ID.test(n)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dirOf(root), n, 'meta.json'), 'utf8'));
      m.feedback = feedbackList(root).filter((f) => f.base && f.base.kind === 'sent' && f.base.id === n).map(({ id, label, date, counts }) => ({ id, label, date, counts }));
      out.push(m);
    } catch {}
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function remove(root, id) {
  fs.rmSync(path.join(dirOf(root), checkId(id)), { recursive: true, force: true });
  return true;
}

// The text of a document file as it was sent (r relative to the doc folder).
function sentText(root, id, r) {
  const dir = path.join(dirOf(root), checkId(id));
  if (r.startsWith('..')) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'outside.json'), 'utf8'))[r] ?? null;
    } catch {
      return null;
    }
  }
  return readText(path.join(dir, 'src', r));
}

export function sentPdf(root, id) {
  const p = path.join(dirOf(root), checkId(id), 'sent.pdf');
  return fs.existsSync(p) ? p : null;
}

// ------------------------------------------------------------ the base

// A reader rel -> text for a base: a sent version or a Git commit.
async function baseReader(root, doc, base) {
  if (base.kind === 'sent') return async (r) => sentText(root, base.id, r);
  if (!/^[0-9a-f]{7,40}$/.test(base.rev || '')) throw new Error('Versão do Git inválida.');
  const docDir = path.dirname(doc);
  const top = (await run('git', ['-C', docDir, 'rev-parse', '--show-toplevel'], { timeout: 8000 })).stdout.trim();
  const prefix = rel(fs.realpathSync(top), fs.realpathSync(docDir));
  return async (r) => {
    const p = path.posix.normalize(path.posix.join(prefix, r));
    if (p.startsWith('..')) return null;
    const out = await run('git', ['-C', top, 'show', `${base.rev}:${p}`], { timeout: 15000 });
    return out.code === 0 ? out.stdout : null;
  };
}

// How far two texts are apart: lines (whitespace squeezed) one has and the
// other does not. Cheap, and enough to rank candidates.
function distance(a, b) {
  const count = (t) => {
    const m = new Map();
    for (const l of t.split('\n')) {
      const k = l.replace(/\s+/g, ' ').trim();
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  let d = 0;
  for (const [k, n] of ca) d += Math.abs(n - (cb.get(k) || 0));
  for (const [k, n] of cb) if (!ca.has(k)) d += n;
  return d;
}

// The sent versions and recent commits, nearest to what came back first.
async function candidates(root, doc, theirsMain) {
  const out = [];
  const mainRel = path.basename(doc);
  for (const m of list(root)) {
    if (m.doc !== rel(root, doc)) continue;
    const t = sentText(root, m.id, mainRel);
    if (t != null) out.push({ base: { kind: 'sent', id: m.id }, label: `enviada${m.to ? ' a ' + m.to : ''} em ${m.date.slice(0, 10)}`, date: m.date, d: distance(t, theirsMain) });
  }
  const log = await run('git', ['-C', path.dirname(doc), 'log', '-n', '40', '--format=%H%x09%cI%x09%s', '--', '.'], { timeout: 15000 });
  if (log.code === 0) {
    for (const line of log.stdout.trim().split('\n').filter(Boolean)) {
      const [rev, date, subject] = line.split('\t');
      const read = await baseReader(root, doc, { kind: 'git', rev });
      const t = await read(mainRel);
      if (t != null) out.push({ base: { kind: 'git', rev }, label: `commit ${rev.slice(0, 7)} de ${date.slice(0, 10)} (${subject.slice(0, 60)})`, date, d: distance(t, theirsMain) });
    }
  }
  return out.sort((a, b) => a.d - b.d || b.date.localeCompare(a.date));
}

// ------------------------------------------------------------ suggestions

// A hunk widened by one word on each side, so even an insertion has text
// to anchor on, and the replacement carries the same neighbours.
function widen(text, from, to) {
  const tk = tokens(text);
  let i = tk.findIndex((t) => t.to > from);
  if (i < 0) i = tk.length;
  let j = i;
  while (j < tk.length && tk[j].from < to) j++;
  let s = i;
  for (let k = i - 1, words = 0; k >= 0; k--) {
    s = k;
    if (tk[k].word && ++words >= 1) break;
  }
  let e = j;
  for (let k = j, words = 0; k < tk.length; k++) {
    e = k + 1;
    if (tk[k].word && ++words >= 1) break;
  }
  return { from: s < i ? tk[s].from : from, to: e > j ? tk[e - 1].to : to };
}

const squeeze = (s) => s.replace(/\s+/g, ' ').trim();

// Where the area around a passage is in `mine` when the passage itself is
// not: the end of its "before" text and the start of its "after" text.
function region(mine, a) {
  const before = (a.before || '').slice(-30);
  const after = (a.after || '').slice(0, 30);
  if (before.trim().length < 8 || after.trim().length < 8) return null;
  const b = locate(mine, { quote: before, before: '', after: '', line: a.line });
  if (!b) return null;
  const rest = mine.slice(b.to, b.to + 4000);
  const k = locate(rest, { quote: after, before: '', after: '', line: 1 });
  if (!k) return null;
  return { from: b.to, to: b.to + k.from };
}

// Today's area already carries the friend's change (and maybe more): every
// word they added is there and none of the words they removed is.
function sameFix(sentArea, theirsArea, mine) {
  const ps = pieces(sentArea, theirsArea);
  const words = new Set(tokens(mine).filter((t) => t.word).map((t) => t.s));
  const mineSq = squeeze(mine);
  let any = false;
  for (const [op, text] of ps) {
    if (op === 'ins' && squeeze(text)) {
      any = true;
      if (!mineSq.includes(squeeze(text))) return false;
    }
    if (op === 'del') for (const t of tokens(text)) if (t.word && words.has(t.s)) return false;
  }
  return any;
}

const lineAt = (text, pos) => text.slice(0, pos).split('\n').length;

// A three-way merge in words. base -> theirs are the friend's changes;
// base -> mine are the changes made since sending (coauthors, you). A
// friend's change that touches none of them applies as is; one that
// overlaps them is a conflict, shown with the three versions of the area.
export function classify(baseText, theirsText, mineText, file) {
  const ours = hunks(baseText, mineText);
  // A position of base, carried into mine through the changes before it.
  const carry = (p) => {
    let shift = 0;
    for (const h of ours) {
      if (h.aTo <= p) shift += h.bTo - h.bFrom - (h.aTo - h.aFrom);
      else break;
    }
    return p + shift;
  };
  const out = [];
  for (const hk of hunks(baseText, theirsText)) {
    const wa = widen(baseText, hk.aFrom, hk.aTo);
    const wb = widen(theirsText, hk.bFrom, hk.bTo);
    const anchor = anchorAt(baseText, wa.from, wa.to);
    const sent = baseText.slice(wa.from, wa.to);
    const theirs = theirsText.slice(wb.from, wb.to);
    const s = { file, anchor, sent, theirs, status: 'aplica', line: lineAt(mineText, carry(wa.from)), mine: null };
    const hit = ours.filter((h) => h.aFrom < wa.to && wa.from < h.aTo || (h.aFrom === h.aTo && h.aFrom >= wa.from && h.aFrom <= wa.to));
    if (hit.length) {
      // The area both touched, in base and in mine.
      const bFrom = Math.min(wa.from, hit[0].aFrom);
      const bTo = Math.max(wa.to, hit[hit.length - 1].aTo);
      const mFrom = bFrom === hit[0].aFrom ? hit[0].bFrom : carry(bFrom);
      const last = hit[hit.length - 1];
      const mTo = bTo === last.aTo ? last.bTo : carry(bTo);
      const mine = mineText.slice(mFrom, mTo);
      const theirsArea = baseText.slice(bFrom, wa.from) + theirs + baseText.slice(wa.to, bTo);
      Object.assign(s, { line: lineAt(mineText, mFrom), area: { sent: baseText.slice(bFrom, bTo), theirs: theirsArea, anchor: anchorAt(mineText, mFrom, mTo) }, mine });
      if (squeeze(mine) === squeeze(theirsArea) || sameFix(baseText.slice(bFrom, bTo), theirsArea, mine)) s.status = 'feita';
      else if (!squeeze(mine) && squeeze(baseText.slice(bFrom, bTo))) s.status = 'sumiu';
      else s.status = 'conflito';
    }
    out.push(s);
  }
  return out;
}

// ------------------------------------------------------------ feedback

const fbDir = (root) => path.join(dirOf(root), 'feedback');
function feedbackList(root) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(fbDir(root)).filter((n) => n.endsWith('.json'));
  } catch {}
  for (const n of names) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(fbDir(root), n), 'utf8')));
    } catch {}
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function feedbackGet(root, id) {
  return JSON.parse(fs.readFileSync(path.join(fbDir(root), checkId(id) + '.json'), 'utf8'));
}

function countsOf(items) {
  const c = { aplica: 0, feita: 0, conflito: 0, sumiu: 0, open: 0 };
  for (const s of items) {
    c[s.status]++;
    if (!s.decision && s.status !== 'feita') c.open++;
  }
  return c;
}

function saveFeedback(root, fb) {
  fb.counts = countsOf(fb.items);
  fs.mkdirSync(fbDir(root), { recursive: true });
  fs.writeFileSync(path.join(fbDir(root), fb.id + '.json'), JSON.stringify(fb, null, 1) + '\n');
  return fb;
}

// What came back (a .tex/ZIP/folder: source { kind:'path', path }) read
// against a base (a sent version, a commit, or null to guess). `buffers`
// are the editor's unsaved texts, so "today" is what the user sees.
export async function feedback(root, doc, source, { base = null, buffers = {}, from = '' } = {}) {
  root = path.resolve(root);
  const docDir = path.dirname(doc);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-sent-'));
  try {
    const m = await buildMirror(doc, source, tmp);
    const theirsOf = (r) => (m.fromCurrent.includes(r) ? null : readText(path.resolve(m.oldDir, r)));
    const theirsMain = readText(m.oldDoc);
    let guessed = null;
    if (!base) {
      const cands = await candidates(root, doc, theirsMain);
      if (!cands.length) throw new Error('Não há versão enviada marcada nem commits do Git para comparar. Marque a versão quando enviar o paper.');
      base = cands[0].base;
      guessed = { label: cands[0].label, others: cands.slice(1, 6).map((c) => ({ base: c.base, label: c.label })) };
    }
    const readBase = await baseReader(root, doc, base);
    const items = [];
    const files = [...includeClosure(doc)].map((f) => rel(docDir, f));
    for (const r of files) {
      const baseText = await readBase(r);
      const theirs = r === path.basename(doc) ? theirsMain : theirsOf(r);
      if (baseText == null || theirs == null || theirs === baseText) continue;
      const abs = path.resolve(docDir, r);
      const mine = buffers[abs] ?? readText(abs) ?? '';
      for (const s of classify(baseText, theirs, mine, abs)) items.push(s);
    }
    items.forEach((s, i) => (s.n = i + 1));
    let label = '';
    if (base.kind === 'sent') {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dirOf(root), base.id, 'meta.json'), 'utf8'));
        label = `enviada${meta.to ? ' a ' + meta.to : ''} em ${meta.date.slice(0, 10)}`;
      } catch {}
    } else label = `commit ${base.rev.slice(0, 7)}`;
    const fb = { id: newId(), doc: rel(root, doc), from: String(from || m.src.label).slice(0, 200), source: source.kind === 'path' ? path.basename(source.path) : source.rev, date: new Date().toISOString(), base: { ...base, label }, guessed, items };
    return saveFeedback(root, fb);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function decide(root, id, n, decision) {
  const fb = feedbackGet(root, id);
  const s = fb.items.find((x) => x.n === n);
  if (!s) throw new Error('Sugestão não encontrada.');
  if (![null, 'aceita', 'rejeitada'].includes(decision)) throw new Error('Decisão inválida.');
  s.decision = decision;
  return saveFeedback(root, fb);
}

export function feedbackRemove(root, id) {
  fs.rmSync(path.join(fbDir(root), checkId(id) + '.json'), { force: true });
  return true;
}

export { feedbackList };

// A line of a file as it was sent, located in today's text: for a PDF
// annotated on the sent version (SyncTeX of the sent PDF gives the old line).
export function mapLine(root, id, file, line, { marked = '', text = null } = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(dirOf(root), checkId(id), 'meta.json'), 'utf8'));
  const docDir = path.dirname(path.join(root, meta.doc));
  const r = rel(docDir, file);
  const old = sentText(root, id, r);
  const now = text ?? readText(file);
  if (old == null || now == null) return { ok: false };
  const lines = old.split('\n');
  const i = Math.max(0, Math.min(lines.length - 1, line - 1));
  // Anchor on the marked words when they are on that line, else the line.
  let from = old.split('\n').slice(0, i).join('\n').length + (i ? 1 : 0);
  let to = from + lines[i].length;
  const mk = squeeze(marked);
  if (mk.length >= 6) {
    const k = lines[i].indexOf(mk.slice(0, 40));
    if (k >= 0) (from += k), (to = Math.min(from + mk.length, to));
  }
  if (!old.slice(from, to).trim()) return { ok: false };
  const at = locate(now, anchorAt(old, from, to));
  if (at) return { ok: true, line: at.line, changed: false };
  const reg = region(now, anchorAt(old, from, to));
  if (reg) return { ok: true, line: now.slice(0, reg.from).split('\n').length, changed: true, was: old.slice(from, to).trim() };
  return { ok: true, line: Math.min(line, now.split('\n').length), changed: true, gone: true, was: old.slice(from, to).trim() };
}
