// A coauthor on Overleaf's free plan, without Git: the round trip by ZIP.
// Going out, the ZIP is the sources as Overleaf compiles them (with latexmk,
// so the .bib goes in and the .bbl stays out), files from outside the
// document folder pulled in with their paths fixed in the copies, and the
// version is marked as sent (server/sent.js) with the texts exactly as they
// went in the ZIP. Coming back, the ZIP Overleaf downloads is read against
// that mark, so only the coauthor's changes show, and the files that were
// moved are read from their place in the ZIP.
import { outputs } from './outdirs.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { includeClosure, docInfo } from './project.js';
import { sourceFiles, zipLayout, rewritePaths, checkZip } from './submission.js';
import * as sent from './sent.js';
import { readText, run, stripComments } from './util.js';
import { zipCommand } from './platform.js';
import { L } from './lang.js';

const REWRITABLE = /\.(tex|ltx|sty|cls|cfg|def|tikz|pgf|bib|bst)$/i;
// Overleaf takes up to 180 files per upload; the rest would be dropped.
export const OVERLEAF_MAX_FILES = 180;
const GENERIC = /^(latex|tex|paper|papers|src|source|manuscript|draft|docs?|text|writing)$/i;

// The .bib files, local .bst styles and latexmkrc the document needs on
// Overleaf, where BibTeX or Biber runs from the sources.
export function bibInputs(doc) {
  const dir = path.dirname(doc);
  const out = [];
  for (const f of includeClosure(doc)) {
    const text = stripComments(readText(f) || '');
    for (const m of text.matchAll(/\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))
      for (let n of m[1].split(',')) {
        n = n.trim();
        if (!n) continue;
        if (!/\.bib$/i.test(n)) n += '.bib';
        out.push(path.resolve(dir, n));
      }
    for (const m of text.matchAll(/\\bibliographystyle\s*\{([^}]+)\}/g)) out.push(path.resolve(dir, m[1].trim().replace(/\.bst$/i, '') + '.bst'));
  }
  for (const rc of ['latexmkrc', '.latexmkrc']) out.push(path.join(dir, rc));
  return [...new Set(out)].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
}

// The ZIP's name becomes the project's name on Overleaf: the project folder,
// or its parent when the folder has a generic name (latex/, paper/).
export function zipName(root, doc) {
  let name = path.basename(path.resolve(root));
  if (GENERIC.test(name)) name = path.basename(path.dirname(path.resolve(root))) || name;
  if (!name || GENERIC.test(name)) name = path.basename(doc, '.tex');
  return name.replace(/[^\w.-]+/g, '-') + '.zip';
}

export async function overleafZip(root, doc, { to = '', check = true } = {}) {
  root = path.resolve(root);
  const dir = path.dirname(doc);
  const bibs = bibInputs(doc);
  const ownBbl = outputs(doc).bbl;
  // The compiled bibliography stays out when the .bib goes in: Overleaf
  // runs BibTeX itself, and a stale .bbl could win over it.
  const files = [...new Set([...sourceFiles(doc).filter((f) => !(bibs.some((b) => b.endsWith('.bib')) && f === ownBbl)), ...bibs])].sort();
  const { map, outside, target } = zipLayout(doc, files);
  const closure = new Set(includeClosure(doc));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-overleaf-'));
  const texts = {};
  const zipPaths = {};
  try {
    for (const [src, rel] of map) {
      const dst = path.join(stage, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      let text = null;
      if (outside.length && REWRITABLE.test(src)) {
        text = rewritePaths(readText(src) || '', dir, target).text;
        fs.writeFileSync(dst, text);
      } else fs.copyFileSync(src, dst);
      if (closure.has(src)) {
        const r = path.relative(dir, src).split(path.sep).join('/');
        texts[r] = text ?? readText(src) ?? '';
        const z = rel.split(path.sep).join('/');
        if (z !== r) zipPaths[r] = z;
      }
    }
    const names = [...map.values()].sort();
    const outDir = path.join(dir, '.texugo', 'overleaf');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, zipName(root, doc));
    fs.rmSync(out, { force: true });
    const r = await run(...zipCommand(out, names), { cwd: stage, timeout: 120000 });
    if (r.code !== 0) throw new Error(L('Não deu para montar o ZIP: ', 'Could not build the ZIP: ') + (r.stderr || r.stdout));
    const mark = await sent.mark(root, doc, { to, note: 'Overleaf', texts, zipPaths });
    const result = { zip: out, files: names, moved: outside.map((f) => ({ from: f, to: map.get(f) })), size: fs.statSync(out).size, tooMany: names.length > OVERLEAF_MAX_FILES, mark };
    if (check) result.check = await checkZip(out, path.relative(dir, doc), docInfo(doc).engine, outputs(doc).log, { latexmk: true });
    return result;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// The newest ZIP and .tex files in Downloads, where a ZIP from Overleaf (or
// from an e-mail) lands. Names, sizes and dates only. TEXUGO_DOWNLOADS
// points elsewhere, for tests.
export function recentDownloads({ dir = process.env.TEXUGO_DOWNLOADS || path.join(os.homedir(), 'Downloads'), limit = 6 } = {}) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.(zip|tex)$/i.test(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    try {
      const st = fs.statSync(p);
      out.push({ path: p, name: e.name, size: st.size, mtime: st.mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}
