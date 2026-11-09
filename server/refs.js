// Add a reference to a .bib file from a DOI, an arXiv id or a title.
// DOIs and titles go through Crossref's JSON (cleaner than doi.org's
// one-line BibTeX); arXiv ids through the arXiv API, switching to the
// journal DOI when the preprint has one.
import fs from 'node:fs';

const UA = 'TeXugo (LaTeX editor; https://github.com/FredieDidier/TeXugo)';
const TIMEOUT = 15000;

async function get(url, accept = 'application/json') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: ctrl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${new URL(url).host} respondeu ${r.status}`);
    return accept.includes('json') ? r.json() : r.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`${new URL(url).host} não respondeu a tempo`);
    if (err.cause && /ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(err.cause.code || '')) throw new Error('Sem conexão com a internet');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// What the user pasted: a DOI, an arXiv id, or free text (a title).
export function classify(q) {
  const s = String(q || '').trim();
  const doi = s.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/);
  if (doi) return { kind: 'doi', id: doi[1].replace(/[.,;)\]]+$/, '') };
  const ax = s.match(/(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*|^)(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?(?:\.pdf)?\s*$/i);
  if (ax) return { kind: 'arxiv', id: ax[1] };
  return { kind: 'title', q: s };
}

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'and', 'to', 'do', 'da', 'de', 'o', 'os', 'as', 'um', 'uma', 'el', 'la', 'los', 'is', 'are', 'does', 'how', 'what', 'why', 'when', 'with']);
const ascii = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

// Google Scholar style: deschenes2011climate.
export function makeKey(ref, taken = new Set()) {
  const last = ref.authors[0] ? ascii(ref.authors[0].family) : 'anon';
  const word = (String(ref.title || '').split(/[\s\-:]+/).map(ascii).find((w) => w && !STOP.has(w)) || '');
  const base = `${last}${ref.year || ''}${word}`;
  let key = base;
  for (let i = 0; taken.has(key); i++) key = base + 'abcdefghijklmnopqrstuvwxyz'[i % 26] + (i >= 26 ? i : '');
  return key;
}

const clean = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
// Escape the characters BibTeX/LaTeX choke on, leave accents as UTF-8.
const tex = (s) => clean(s).replace(/([&%$#_])/g, '\\$1').replace(/[–—]/g, '--');

function fromCrossref(m) {
  const date = (m['published-print'] || m['published-online'] || m.issued || m.created || {})['date-parts'];
  const kindMap = { 'journal-article': 'article', 'book-chapter': 'incollection', book: 'book', 'proceedings-article': 'inproceedings', report: 'techreport', 'posted-content': 'unpublished', monograph: 'book', dissertation: 'phdthesis' };
  return {
    type: kindMap[m.type] || 'misc',
    title: clean((m.title || [])[0]) + (m.subtitle && m.subtitle[0] ? ': ' + clean(m.subtitle[0]) : ''),
    authors: (m.author || []).map((a) => ({ family: clean(a.family || a.name), given: clean(a.given) })).filter((a) => a.family),
    year: date && date[0] && date[0][0] ? String(date[0][0]) : '',
    venue: clean((m['container-title'] || [])[0]),
    volume: m.volume,
    number: m.issue,
    pages: m.page,
    publisher: m.type === 'book' || m.type === 'monograph' ? clean(m.publisher) : '',
    institution: m.type === 'report' || m.type === 'posted-content' ? clean(m.institution?.[0]?.name || m.publisher) : '',
    doi: m.DOI,
    ...(/^10\.3386\/w(\d+)/i.test(m.DOI || '') ? { type: 'techreport', series: 'Working Paper', number: m.DOI.match(/w(\d+)/i)[1], institution: 'National Bureau of Economic Research' } : {}),
  };
}

export function toBibtex(ref, key) {
  const venueField = { article: 'journal', incollection: 'booktitle', inproceedings: 'booktitle' }[ref.type];
  const fields = [
    ['author', ref.authors.map((a) => (a.given ? `${tex(a.family)}, ${tex(a.given)}` : `{${tex(a.family)}}`)).join(' and ')],
    ['title', ref.title && tex(ref.title)],
    [venueField, ref.venue && tex(ref.venue)],
    ['year', ref.year],
    ['volume', ref.volume],
    ['type', ref.series],
    ['number', ref.number],
    ['pages', ref.pages && tex(ref.pages).replace(/(\d)-(\d)/, '$1--$2')],
    ['publisher', ref.publisher && tex(ref.publisher)],
    ['institution', ref.institution && tex(ref.institution)],
    ['note', ref.note],
    ['eprint', ref.eprint],
    ['archiveprefix', ref.eprint && 'arXiv'],
    ['primaryclass', ref.primaryClass],
    ['doi', ref.doi],
  ].filter(([k, v]) => k && v);
  const w = Math.max(...fields.map(([k]) => k.length));
  return `@${ref.type}{${key},\n${fields.map(([k, v]) => `  ${k.padEnd(w)} = {${v}}`).join(',\n')}\n}\n`;
}

async function byDoi(doi) {
  const r = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (!r) throw new Error(`DOI não encontrado: ${doi}`);
  return fromCrossref(r.message);
}

async function byArxiv(id) {
  const xml = await get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, 'application/atom+xml');
  const entry = (xml || '').split('<entry>')[1];
  if (!entry) throw new Error(`arXiv não encontrado: ${id}`);
  const tag = (t) => clean((entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
  const doi = tag('arxiv:doi');
  if (doi) {
    try {
      return { ...(await byDoi(doi)), note: `arXiv:${id}` };
    } catch {}
  }
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => {
    const parts = clean(m[1]).split(' ');
    return { family: parts.pop(), given: parts.join(' ') };
  });
  const cat = (entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/) || [])[1];
  return { type: 'misc', title: tag('title'), authors, year: tag('published').slice(0, 4), eprint: id, primaryClass: cat, venue: '', note: `arXiv preprint arXiv:${id}` };
}

// Returns candidates: one for a DOI or arXiv id, up to six for a title.
export async function lookup(q) {
  const c = classify(q);
  if (c.kind === 'doi') return [await byDoi(c.id)];
  if (c.kind === 'arxiv') return [await byArxiv(c.id)];
  if (c.q.length < 4) throw new Error('Digite um DOI, um ID do arXiv ou parte do título.');
  const r = await get(`https://api.crossref.org/works?rows=6&query.bibliographic=${encodeURIComponent(c.q)}`);
  return ((r && r.message.items) || []).filter((m) => m.title && m.title[0]).map(fromCrossref);
}

// Appends the entry unless the .bib already has this DOI or arXiv id;
// returns the key to cite either way.
export function addToBib(bibFile, ref) {
  const text = fs.existsSync(bibFile) ? fs.readFileSync(bibFile, 'utf8') : '';
  const entries = [...text.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|$)/g)];
  const norm = (s) => String(s || '').toLowerCase();
  for (const [, key, body] of entries) {
    if (ref.doi && norm(body).includes(norm(ref.doi))) return { key, existed: true };
    if (ref.eprint && norm(body).includes(norm(ref.eprint))) return { key, existed: true };
  }
  const key = makeKey(ref, new Set(entries.map((e) => e[1])));
  const bib = toBibtex(ref, key);
  fs.writeFileSync(bibFile, text + (text && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : '') + bib);
  return { key, existed: false, bibtex: bib };
}

// The .bib files a document names in \bibliography / \addbibresource.
export function bibsOf(doc) {
  let text = '';
  try {
    text = fs.readFileSync(doc, 'utf8').replace(/(^|[^\\])%.*$/gm, '$1');
  } catch {
    return [];
  }
  const dir = doc.replace(/\/[^/]*$/, '');
  const out = [];
  for (const m of text.matchAll(/\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    for (let n of m[1].split(',')) {
      n = n.trim();
      if (!n) continue;
      if (!n.endsWith('.bib')) n += '.bib';
      out.push(n.startsWith('/') ? n : `${dir}/${n}`.replace(/\/\.\//g, '/'));
    }
  }
  return [...new Set(out)];
}
