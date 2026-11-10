// Import from Zotero into the project's .bib. Three ways in, tried in order:
//  1. Zotero 7's local API (Zotero open, Settings → Advanced → "Allow other
//     applications on this computer to communicate with Zotero");
//  2. a read-only copy of zotero.sqlite (works with Zotero closed or open,
//     no setting needed; the original is never touched);
//  3. a .bib exported from Zotero, Better BibTeX or Mendeley (importBib).
// Items become the same reference objects that "Adicionar referência"
// writes, so keys, fields and duplicate checks behave the same.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './util.js';
import { parseBib, texToText } from './bibparse.js';
import { addToBib } from './refs.js';

const API = 'http://127.0.0.1:23119/api/users/0';

const TYPE = {
  journalArticle: 'article', magazineArticle: 'article', newspaperArticle: 'article',
  book: 'book', bookSection: 'incollection', conferencePaper: 'inproceedings',
  report: 'techreport', thesis: 'phdthesis', preprint: 'unpublished', manuscript: 'unpublished',
  webpage: 'misc', dataset: 'misc', document: 'misc', computerProgram: 'misc',
};

// A Zotero item (API JSON "data" or the same fields read from SQLite) to a
// reference object.
export function fromZotero(d) {
  const type = TYPE[d.itemType] || 'misc';
  const authors = (d.creators || [])
    .filter((c) => !c.creatorType || c.creatorType === 'author' || c.creatorType === 'editor')
    .map((c) => (c.name ? { family: c.name, given: '' } : { family: c.lastName || '', given: c.firstName || '' }))
    .filter((a) => a.family);
  const year = (String(d.date || '').match(/\b(1[5-9]\d\d|20\d\d)\b/) || [])[1] || '';
  const ref = {
    type,
    title: d.title || '',
    authors,
    year,
    venue: d.publicationTitle || d.bookTitle || d.proceedingsTitle || d.websiteTitle || '',
    volume: d.volume || '',
    number: d.issue || (type === 'techreport' ? d.reportNumber || '' : ''),
    pages: d.pages || '',
    publisher: type === 'book' || type === 'incollection' ? d.publisher || '' : '',
    institution: type === 'techreport' ? d.institution || d.publisher || '' : '',
    school: type === 'phdthesis' ? d.university || d.publisher || '' : '',
    series: type === 'techreport' ? d.reportType || 'Working Paper' : '',
    doi: (d.DOI || (String(d.extra || '').match(/^DOI:\s*(\S+)/im) || [])[1] || '').trim(),
    url: d.url || '',
    note: '',
  };
  if (type === 'unpublished' && d.repository) ref.note = d.repository;
  return ref;
}

// Read-only query on a copy of the database: Node's own SQLite when this
// Node has it (Windows has no sqlite3 program), else the sqlite3 command.
async function querySqlite(file, sql) {
  let DatabaseSync = null;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {}
  if (DatabaseSync) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return db.prepare(sql).all().map((r) => ({ ...r }));
    } finally {
      db.close();
    }
  }
  const r = await run('sqlite3', ['-json', '-readonly', file, sql], { timeout: 30000 });
  if (r.code !== 0) throw new Error('Não deu para ler o banco do Zotero: ' + (r.stderr || '').trim());
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}

async function apiAvailable() {
  try {
    const r = await fetch(`${API}/items?limit=1`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Where Zotero keeps its data: the profile's prefs.js may move it.
export function dataDir() {
  const home = os.homedir();
  const profiles =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Zotero', 'Profiles')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Zotero', 'Zotero', 'Profiles')
        : path.join(home, '.zotero', 'zotero');
  try {
    for (const p of fs.readdirSync(profiles)) {
      const prefs = path.join(profiles, p, 'prefs.js');
      const m = fs.existsSync(prefs) && fs.readFileSync(prefs, 'utf8').match(/user_pref\("extensions\.zotero\.dataDir",\s*"([^"]+)"\)/);
      if (m && fs.existsSync(path.join(m[1], 'zotero.sqlite'))) return m[1];
    }
  } catch {}
  return path.join(home, 'Zotero');
}

async function sqliteItems(dbFile) {
  // Zotero keeps the database locked while open: query a copy.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-zotero-'));
  const copy = path.join(tmp, 'z.sqlite');
  try {
    fs.copyFileSync(dbFile, copy);
    if (fs.existsSync(dbFile + '-wal')) fs.copyFileSync(dbFile + '-wal', copy + '-wal');
    const q = (sql) => querySqlite(copy, sql);
    const items = await q(`SELECT i.itemID AS id, i.key AS key, t.typeName AS itemType FROM items i JOIN itemTypes t USING(itemTypeID)
      WHERE t.typeName NOT IN ('attachment','note','annotation') AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`);
    const fields = await q(`SELECT d.itemID AS id, f.fieldName AS f, v.value AS v FROM itemData d JOIN fields f USING(fieldID) JOIN itemDataValues v USING(valueID)`);
    const creators = await q(`SELECT ic.itemID AS id, c.firstName AS firstName, c.lastName AS lastName, c.fieldMode AS mode, ct.creatorType AS creatorType
      FROM itemCreators ic JOIN creators c USING(creatorID) JOIN creatorTypes ct USING(creatorTypeID) ORDER BY ic.itemID, ic.orderIndex`);
    const byId = new Map(items.map((it) => [it.id, { key: it.key, itemType: it.itemType, creators: [] }]));
    for (const f of fields) if (byId.has(f.id)) byId.get(f.id)[f.f] = f.v;
    for (const c of creators) {
      const it = byId.get(c.id);
      if (it) it.creators.push(c.mode === 1 ? { name: c.lastName, creatorType: c.creatorType } : { firstName: c.firstName, lastName: c.lastName, creatorType: c.creatorType });
    }
    return [...byId.values()];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The library as reference objects, each with Zotero's item key. `db`
// overrides the database path (tests).
export async function library({ db = process.env.TEXUGO_ZOTERO_DB } = {}) {
  if (!db && (await apiAvailable())) {
    const out = [];
    for (let start = 0; start < 20000; start += 100) {
      const r = await fetch(`${API}/items/top?format=json&limit=100&start=${start}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) break;
      const page = await r.json();
      for (const it of page) if (it.data && !['attachment', 'note', 'annotation'].includes(it.data.itemType)) out.push({ zkey: it.key, ...fromZotero(it.data) });
      if (page.length < 100) break;
    }
    return { source: 'api', items: out };
  }
  const file = db || path.join(dataDir(), 'zotero.sqlite');
  if (!fs.existsSync(file)) throw new Error('Não achei o Zotero neste Mac. Se você usa outro gerenciador (Mendeley, Paperpile), exporte um .bib e use “Importar .bib”.');
  const items = await sqliteItems(file);
  return { source: 'sqlite', items: items.map((d) => ({ zkey: d.key, ...fromZotero(d) })) };
}

// Adds the chosen items; returns the keys to cite, in order.
export function addItems(bibFile, refs) {
  return refs.map((r) => addToBib(bibFile, r));
}

// Merges a .bib exported by any reference manager: entries whose key, DOI
// or title is already there are skipped, the rest appended unchanged.
export function importBib(target, source) {
  const src = fs.readFileSync(source, 'utf8');
  const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const have = parseBib(cur);
  const keys = new Set(have.map((e) => e.key.toLowerCase()));
  const dois = new Set(have.map((e) => (e.fields.doi || '').toLowerCase().trim()).filter(Boolean));
  const titles = new Set(have.map((e) => texToText(e.fields.title || '').toLowerCase()).filter(Boolean));
  const added = [];
  const skipped = [];
  // Re-slice the source text entry by entry so each lands exactly as written.
  const starts = [...src.matchAll(/@\s*(\w+)\s*[{(]/g)].map((m) => ({ i: m.index, type: m[1].toLowerCase() }));
  const blocks = starts.map((s, n) => ({ ...s, text: src.slice(s.i, n + 1 < starts.length ? starts[n + 1].i : src.length).trim() }));
  let out = cur;
  for (const b of blocks) {
    if (b.type === 'comment' || b.type === 'preamble') continue;
    const [e] = parseBib(b.text);
    if (!e && b.type !== 'string') continue;
    if (b.type === 'string') {
      out += (out.endsWith('\n\n') || !out ? '' : out.endsWith('\n') ? '\n' : '\n\n') + b.text + '\n';
      continue;
    }
    const doi = (e.fields.doi || '').toLowerCase().trim();
    const title = texToText(e.fields.title || '').toLowerCase();
    if (keys.has(e.key.toLowerCase()) || (doi && dois.has(doi)) || (title && titles.has(title))) {
      skipped.push(e.key);
      continue;
    }
    keys.add(e.key.toLowerCase());
    if (doi) dois.add(doi);
    if (title) titles.add(title);
    out += (out.endsWith('\n\n') || !out ? '' : out.endsWith('\n') ? '\n' : '\n\n') + b.text + '\n';
    added.push(e.key);
  }
  if (added.length) fs.writeFileSync(target, out);
  return { added, skipped };
}

// The PDFs attached to Zotero items, with the parent item's data, for the
// paper library. Files Zotero only links to (outside its storage folder)
// count when they exist.
export async function pdfAttachments({ db = process.env.TEXUGO_ZOTERO_DB } = {}) {
  const file = db || path.join(dataDir(), 'zotero.sqlite');
  if (!fs.existsSync(file)) throw new Error('Não achei o Zotero neste Mac.');
  const storage = path.join(path.dirname(file), 'storage');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-zotero-'));
  const copy = path.join(tmp, 'z.sqlite');
  let rows;
  try {
    fs.copyFileSync(file, copy);
    if (fs.existsSync(file + '-wal')) fs.copyFileSync(file + '-wal', copy + '-wal');
    rows = await querySqlite(copy, `SELECT a.key AS akey, p.key AS pkey, ia.path AS path FROM itemAttachments ia
      JOIN items a ON a.itemID = ia.itemID LEFT JOIN items p ON p.itemID = ia.parentItemID
      WHERE ia.contentType = 'application/pdf' AND ia.itemID NOT IN (SELECT itemID FROM deletedItems)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const meta = new Map((await sqliteItems(file)).map((d) => [d.key, d]));
  const out = [];
  for (const row of rows) {
    const p = String(row.path || '');
    const full = p.startsWith('storage:') ? path.join(storage, row.akey, p.slice(8)) : path.isAbsolute(p) ? p : '';
    if (!full || !fs.existsSync(full)) continue;
    const d = meta.get(row.pkey);
    const ref = d ? fromZotero(d) : null;
    out.push({
      path: full,
      zkey: row.pkey || row.akey,
      title: ref ? ref.title : '',
      authors: ref ? ref.authors.map((a) => a.family).join(', ') : '',
      year: ref ? ref.year : '',
      doi: ref ? ref.doi : '',
    });
  }
  return out;
}
