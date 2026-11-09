// "Verificar referências": each .bib entry against Crossref. With a DOI the
// record is read directly; without one, the best match by title and first
// author is used only when it clearly is the same work. Differences in
// year, journal, volume, number and pages are reported with Crossref's
// value, and a missing DOI is offered; nothing changes until the user
// accepts a suggestion.
import fs from 'node:fs';
import { parseBib, texToText, setField } from './bibparse.js';

const UA = 'TeXugo (LaTeX editor; https://github.com/FredieDidier/TeXugo)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Crossref's public pool allows few requests at once; on 429 wait as told.
async function get(url, tries = 6) {
  for (let t = 0; ; t++) {
    try {
      return await get1(url);
    } catch (err) {
      if (err.status !== 429 || t >= tries) throw err;
      await sleep((err.retryAfter || 2 ** t) * 1000);
    }
  }
}
async function get1(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
    if (r.status === 404) return null;
    if (r.status === 429) throw Object.assign(new Error('O Crossref pediu para ir mais devagar; tente de novo em um minuto.'), { status: 429, retryAfter: Number(r.headers.get('retry-after')) || 0 });
    if (!r.ok) throw new Error(`Crossref respondeu ${r.status}`);
    return r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Crossref não respondeu a tempo');
    if (err.cause && /ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(err.cause.code || '')) throw new Error('Sem conexão com a internet');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const norm = (s) =>
  texToText(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
// Share of title words in common (Jaccard).
export function titleSimilarity(a, b) {
  const A = new Set(norm(a));
  const B = new Set(norm(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
const firstFamily = (author) => norm((texToText(author).split(/\s+and\s+/)[0] || '').split(',')[0])[0] || '';
const yearOf = (m) => {
  const d = (m['published-print'] || m['published-online'] || m.issued || {})['date-parts'];
  return d && d[0] && d[0][0] ? String(d[0][0]) : '';
};
const pagesNorm = (p) => String(p || '').replace(/[–—-]+/g, '--').replace(/\s/g, '');
const dashNorm = (p) => String(p || '').replace(/[–—]|--/g, '-').replace(/\s/g, '');

export function compareEntry(e, m) {
  const f = e.fields;
  const out = [];
  const ref = {
    year: yearOf(m),
    journal: (m['container-title'] || [])[0] || '',
    volume: m.volume || '',
    number: m.issue || '',
    pages: m.page ? pagesNorm(m.page) : '',
    doi: m.DOI || '',
  };
  if (ref.year && f.year && texToText(f.year) !== ref.year) out.push({ field: 'year', have: texToText(f.year), crossref: ref.year });
  const venueField = f.journal != null ? 'journal' : f.journaltitle != null ? 'journaltitle' : null;
  if (e.type === 'article' && ref.journal) {
    if (!venueField) out.push({ field: 'journal', have: '', crossref: ref.journal });
    else if (titleSimilarity(f[venueField], ref.journal) < 0.5 && !norm(f[venueField]).every((w) => norm(ref.journal).includes(w))) out.push({ field: venueField, have: texToText(f[venueField]), crossref: ref.journal });
  }
  for (const k of ['volume', 'number', 'pages']) {
    if (!ref[k]) continue;
    const have = f[k] == null ? '' : k === 'pages' ? pagesNorm(texToText(f[k])) : texToText(f[k]);
    // Only fill in what is missing or contradicts; an article number vs a
    // page range is not worth flagging.
    if (!have && e.type === 'article') out.push({ field: k, have: '', crossref: ref[k] });
    else if (have && dashNorm(have) !== dashNorm(ref[k]) && !(k === 'pages' && !/--/.test(ref[k]))) out.push({ field: k, have, crossref: ref[k] });
  }
  if (!f.doi && ref.doi) out.push({ field: 'doi', have: '', crossref: ref.doi });
  return out;
}

async function checkOne(e) {
  const f = e.fields;
  const title = texToText(f.title || '');
  const doi = (f.doi || '').replace(/^\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').trim();
  let m = null;
  let how = 'doi';
  if (doi) {
    const r = await get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!r) return { key: e.key, status: 'baddoi', note: `O DOI ${doi} não existe no Crossref.` };
    m = r.message;
    if (title && titleSimilarity(title, (m.title || [])[0]) < 0.3) return { key: e.key, status: 'mismatch', note: `O DOI aponta para outro trabalho: “${(m.title || [])[0] || '?'}”.`, crossrefTitle: (m.title || [])[0] };
  } else {
    if (!title) return { key: e.key, status: 'skip', note: 'Sem título para buscar.' };
    how = 'busca';
    const q = `${title} ${firstFamily(f.author || f.editor || '')}`;
    const r = await get(`https://api.crossref.org/works?rows=6&query.bibliographic=${encodeURIComponent(q)}`);
    const items = (r && r.message.items) || [];
    const fam = firstFamily(f.author || f.editor || '');
    const same = items.filter((it) => titleSimilarity(title, (it.title || [])[0]) >= 0.8 && (!fam || (it.author || []).some((a) => norm(a.family || a.name || '')[0] === fam)));
    // A published article is often also an NBER/SSRN working paper with the
    // same title and another year: for an @article only the journal version
    // counts, preferring the journal the .bib names.
    const venue = f.journal || f.journaltitle || '';
    const score = (it) => (venue && titleSimilarity(venue, (it['container-title'] || [])[0]) >= 0.5 ? 2 : 0) + (it.type === 'journal-article' ? 1 : 0);
    const pool = e.type === 'article' ? same.filter((it) => it.type === 'journal-article') : same;
    // A search hit decades away is another work with a similar title.
    const y = Number((texToText(f.year || '').match(/\d{4}/) || [])[0]);
    const near = (it) => !y || !Number(yearOf(it)) || Math.abs(Number(yearOf(it)) - y) <= 2;
    m = pool.filter(near).sort((a, b) => score(b) - score(a))[0];
    if (!m) return { key: e.key, status: 'notfound', note: e.type === 'article' ? 'Não achei no Crossref com segurança.' : 'Não está no Crossref (comum para working papers, livros e relatórios).' };
  }
  if (e.type === 'article' && m.type && m.type !== 'journal-article') return { key: e.key, status: 'notfound', note: `O DOI é de ${m.type === 'report' ? 'um working paper' : 'outro tipo de registro'}, não do artigo publicado.` };
  const diffs = compareEntry(e, m);
  return { key: e.key, status: diffs.length ? 'diffs' : 'ok', how, diffs, url: m.DOI ? `https://doi.org/${m.DOI}` : null };
}

export async function checkBib(bibFile, { keys } = {}) {
  const entries = parseBib(fs.readFileSync(bibFile, 'utf8')).filter((e) => !keys || keys.includes(e.key));
  const results = [];
  let i = 0;
  let fatal = null;
  // Two at a time: Crossref's public pool rejects more.
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (i < entries.length && !fatal) {
        const e = entries[i++];
        try {
          results.push({ ...(await checkOne(e)), line: e.line, file: bibFile });
        } catch (err) {
          if (/internet|tempo|devagar/.test(err.message)) fatal = err;
          results.push({ key: e.key, status: 'error', note: err.message, line: e.line, file: bibFile });
        }
      }
    }),
  );
  if (fatal && !results.some((r) => r.status !== 'error')) throw fatal;
  const done = new Set(results.map((r) => r.key));
  for (const e of entries) if (!done.has(e.key)) results.push({ key: e.key, status: 'error', note: 'Não verificada: ' + (fatal ? fatal.message : 'interrompida'), line: e.line, file: bibFile });
  const order = { mismatch: 0, baddoi: 1, diffs: 2, notfound: 3, error: 4, skip: 5, ok: 6 };
  return results.sort((a, b) => order[a.status] - order[b.status] || a.line - b.line);
}

// Applies accepted suggestions: [{key, field, value}].
export function applyFixes(bibFile, fixes) {
  let text = fs.readFileSync(bibFile, 'utf8');
  let n = 0;
  for (const { key, field, value } of fixes) {
    if (!/^[a-z]+$/i.test(field)) continue;
    const v = field === 'pages' ? String(value).replace(/-+/g, '--') : String(value).replace(/([&%#])/g, (c, x, i, s) => (s[i - 1] === '\\' ? c : '\\' + c));
    const next = setField(text, key, field, v);
    if (next != null) (text = next), n++;
  }
  fs.writeFileSync(bibFile, text);
  return { applied: n };
}
