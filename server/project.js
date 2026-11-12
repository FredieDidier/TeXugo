// Project model: file tree, which documents a file belongs to, and the
// per-document facts the build needs (engine, external documents, kind).
import fs from 'node:fs';
import path from 'node:path';
import { readText, stripComments } from './util.js';
import { parseBib, bibSummary } from './bibparse.js';
import { macrosFrom } from './texmacros.js';

export const ARTIFACT_EXT = new Set([
  '.aux', '.log', '.fls', '.fdb_latexmk', '.bbl', '.blg', '.out', '.toc', '.lof', '.lot',
  '.nav', '.snm', '.vrb', '.bcf', '.xdv', '.idx', '.ilg', '.ind', '.synctex', '.dvi',
  '.run.xml', '.synctex.gz', '.synctex(busy)', '.thm', '.loa', '.glo', '.gls', '.glg', '.ist',
]);
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.Rproj.user', '__pycache__', '.venv', '.texugo']);

export function isArtifact(name) {
  if (name.endsWith('.synctex.gz') || name.endsWith('.run.xml') || name.endsWith('.synctex(busy)')) return true;
  return ARTIFACT_EXT.has(path.extname(name).toLowerCase());
}

// Lists the project folder as a nested tree. Large data folders are cut off
// at `limit` entries so a project that sits next to raw data stays usable.
export function listTree(root, { showArtifacts = false, limit = 4000 } = {}) {
  let count = 0;
  function walk(dir, depth) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'pt', { numeric: true, sensitivity: 'base' });
    });
    const out = [];
    for (const e of entries) {
      if (count >= limit) break;
      if (e.name === '.DS_Store') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        count++;
        out.push({ name: e.name, path: full, dir: true, children: depth < 12 ? walk(full, depth + 1) : [] });
      } else {
        if (!showArtifacts && isArtifact(e.name)) continue;
        count++;
        out.push({ name: e.name, path: full, dir: false });
      }
    }
    return out;
  }
  return { root, children: walk(root, 0), truncated: count >= limit };
}

// All .tex files of the project (used to find documents and include graphs).
// Breadth-first, so a shallow paper/ folder is always reached before the
// thousands of generated tables deep in analysis/output/. The returned array
// carries `truncated` when the limit cut the scan.
export function listTexFiles(root, limit = 3000) {
  const out = [];
  let queue = [root];
  let truncated = false;
  for (let depth = 0; queue.length && depth <= 10 && !truncated; depth++) {
    const next = [];
    for (const dir of queue) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) next.push(full);
        } else if (e.name.endsWith('.tex')) {
          if (out.length >= limit) {
            truncated = true;
            break;
          }
          out.push(full);
        }
      }
      if (truncated) break;
    }
    queue = next;
  }
  if (truncated) out.truncated = true;
  return out;
}

const RE_DOCCLASS = /\\documentclass\s*(\[[^\]]*\])?\s*\{([^}]+)\}/;

export function magicComments(text) {
  const out = {};
  const head = text.split('\n').slice(0, 30);
  for (const line of head) {
    const m = line.match(/^\s*%\s*!\s*TEX\s+(\w+)\s*=\s*(.+?)\s*$/i);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function resolveTex(baseDir, name) {
  let p = path.resolve(baseDir, name.trim());
  if (!path.extname(p)) p += '.tex';
  return p;
}

// Files that a .tex file pulls in with \input, \include, \subfile, \import.
// Paths are resolved against the document directory, as TeX does.
export function includesOf(file, docDir) {
  const text = readText(file);
  if (text == null) return [];
  const body = stripComments(text);
  const out = [];
  const re = /\\(input|include|subfile|subfileinclude)\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(body))) out.push(resolveTex(docDir, m[2]));
  const reImp = /\\(sub)?(import|includefrom|inputfrom)\*?\s*\{([^}]*)\}\s*\{([^}]+)\}/g;
  while ((m = reImp.exec(body))) {
    const base = m[1] ? path.dirname(file) : docDir;
    out.push(resolveTex(path.resolve(base, m[3]), m[4]));
  }
  return out;
}

// Everything a document reads, transitively, starting at the document itself.
export function includeClosure(doc) {
  const docDir = path.dirname(doc);
  const seen = new Set([doc]);
  const stack = [doc];
  while (stack.length) {
    const f = stack.pop();
    for (const inc of includesOf(f, docDir)) {
      if (!seen.has(inc) && fs.existsSync(inc)) {
        seen.add(inc);
        stack.push(inc);
      }
    }
  }
  return seen;
}

// Facts about a compilable document.
export function docInfo(doc) {
  const text = readText(doc) || '';
  const body = stripComments(text);
  const magic = magicComments(text);
  const cls = body.match(RE_DOCCLASS);
  const info = {
    path: doc,
    name: path.basename(doc),
    isDocument: !!cls,
    documentClass: cls ? cls[2].trim() : null,
    engine: 'pdflatex',
    engineSource: 'padrão',
    externals: [],
    kind: 'document',
    bibTool: null,
  };
  // Scan the preamble and the files it inputs so packages loaded from a
  // separate preamble file still count.
  let all = body;
  for (const f of includeClosure(doc)) {
    if (f !== doc) all += '\n' + stripComments(readText(f) || '');
  }
  const prog = (magic.program || magic['ts-program'] || '').toLowerCase();
  if (prog.includes('xelatex')) Object.assign(info, { engine: 'xelatex', engineSource: 'comentário !TEX' });
  else if (prog.includes('lualatex')) Object.assign(info, { engine: 'lualatex', engineSource: 'comentário !TEX' });
  else if (prog.includes('pdflatex')) Object.assign(info, { engine: 'pdflatex', engineSource: 'comentário !TEX' });
  else if (/\\usepackage(\[[^\]]*\])?\{[^}]*\b(fontspec|unicode-math|polyglossia)\b/.test(all)) {
    Object.assign(info, { engine: 'xelatex', engineSource: 'usa fontspec' });
  }
  if (info.documentClass === 'beamer' || /\\documentclass(\[[^\]]*\])?\{beamer\}/.test(body)) info.kind = 'slides';
  else if (/letter|moderncv|cv/i.test(info.documentClass || '')) info.kind = 'letter';
  const docDir = path.dirname(doc);
  const reExt = /\\(z)?externaldocument\s*(\[[^\]]*\])?\s*(\[[^\]]*\])?\s*\{([^}]+)\}/g;
  let m;
  while ((m = reExt.exec(all))) {
    let p = path.resolve(docDir, m[4].trim());
    if (p.endsWith('.tex')) p = p.slice(0, -4);
    info.externals.push(p + '.tex');
  }
  if (/\\usepackage(\[[^\]]*\])?\{biblatex\}/.test(all)) {
    info.bibTool = /backend\s*=\s*bibtex/.test(all) ? 'bibtex' : 'biber';
  } else if (/\\bibliography\{/.test(all)) info.bibTool = 'bibtex';
  return info;
}

// The documents a file is compiled through. A file with \documentclass is its
// own document; otherwise a `% !TEX root` comment wins; otherwise every
// document of the project whose include closure contains the file.
export function rootsFor(projectRoot, file) {
  const text = readText(file);
  if (text != null && file.endsWith('.tex')) {
    if (RE_DOCCLASS.test(stripComments(text))) return [file];
    const magic = magicComments(text);
    if (magic.root) {
      const r = resolveTex(path.dirname(file), magic.root);
      if (fs.existsSync(r)) return [r];
    }
  }
  const docs = listDocuments(projectRoot);
  const hits = docs.filter((d) => includeClosure(d).has(file));
  // A .bib or figure is not \input; attach it to documents that cite the bib.
  if (!hits.length && file.endsWith('.bib')) {
    const stem = path.basename(file, '.bib');
    return docs.filter((d) => {
      const t = stripComments(readText(d) || '');
      return new RegExp(`\\\\(bibliography|addbibresource)\\{[^}]*${stem}`).test(t) || includeClosureText(d).includes(stem);
    });
  }
  return hits;
}

function includeClosureText(doc) {
  let all = '';
  for (const f of includeClosure(doc)) all += stripComments(readText(f) || '');
  return all;
}

export function listDocuments(projectRoot) {
  return listTexFiles(projectRoot).filter((f) => {
    const t = readText(f);
    return t && RE_DOCCLASS.test(stripComments(t.slice(0, 20000)));
  });
}

// Every \label in the project with its file and line, plus .bib keys, for
// completion and for explaining undefined references.
export function projectSymbols(projectRoot) {
  const labels = [];
  const bibKeys = [];
  const cites = {}; // key -> number of \cite uses in the project
  const macros = {}; // \newcommand & co., for the equation preview
  // Files the documents pull in come first, so a scan cut by the file limit
  // still sees every label of the papers themselves.
  const scanned = listTexFiles(projectRoot);
  const files = new Set();
  if (scanned.truncated) for (const d of listDocuments(projectRoot)) for (const f of includeClosure(d)) files.add(f);
  for (const f of scanned) files.add(f);
  for (const f of files) {
    const src = readText(f) || '';
    if (/\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|def)\b/.test(src)) Object.assign(macros, macrosFrom(src));
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      const clean = line.replace(/(^|[^\\])%.*$/, '$1');
      const re = /\\label\s*\{([^}]+)\}/g;
      let m;
      while ((m = re.exec(clean))) labels.push({ key: m[1], file: f, line: i + 1 });
      const rc = /\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
      while ((m = rc.exec(clean))) for (const k of m[1].split(',')) if (k.trim()) cites[k.trim()] = (cites[k.trim()] || 0) + 1;
    });
  }
  const bibs = [];
  (function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) walk(full, depth + 1);
      } else if (e.name.endsWith('.bib')) bibs.push(full);
      else if (e.name.endsWith('.sty')) Object.assign(macros, macrosFrom(readText(full) || ''));
    }
  })(projectRoot, 0);
  for (const b of bibs) {
    for (const e of parseBib(readText(b) || '')) bibKeys.push(bibSummary(e, b));
  }
  for (const b of bibKeys) b.uses = cites[b.key] || 0;
  return { labels, bibKeys, macros };
}

// Document outline: sectioning commands and Beamer frames of a file.
export function outline(file, given) {
  const text = given ?? (readText(file) || '');
  const lines = text.split('\n');
  const items = [];
  const levels = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };
  lines.forEach((raw, i) => {
    const line = raw.replace(/(^|[^\\])%.*$/, '$1');
    let m = line.match(/\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(\[[^\]]*\])?\s*\{(.*)/);
    if (m) {
      items.push({ level: levels[m[1]], kind: m[1], title: cleanTitle(m[3]), line: i + 1 });
      return;
    }
    m = line.match(/\\begin\{frame\}(\[[^\]]*\])?(\{(.*))?/);
    if (m) {
      let title = m[3] ? cleanTitle(m[3]) : '';
      if (!title) {
        const next = lines.slice(i + 1, i + 4).join(' ').match(/\\frametitle\{(.*)/);
        title = next ? cleanTitle(next[1]) : '(slide sem título)';
      }
      items.push({ level: 3, kind: 'frame', title, line: i + 1 });
    }
  });
  return items;
}

function cleanTitle(s) {
  let depth = 1;
  let out = '';
  for (const ch of s) {
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
    out += ch;
  }
  return out.replace(/\\(emph|textbf|textit|texttt)\{([^}]*)\}/g, '$2').replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}]/g, '').trim();
}
