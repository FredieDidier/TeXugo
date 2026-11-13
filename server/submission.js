// Submission helpers: a ZIP that compiles on its own (arXiv, journals) and a
// double-blind check that looks for author traces in sources and PDF.
import { outputs } from './outdirs.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { includeClosure, docInfo } from './project.js';
import { parseLog } from './logparse.js';
import { execFileSync } from 'node:child_process';
import { readText, run, stripComments, toolEnv, findOnPath } from './util.js';
import { zipCommand, unzipCommand } from './platform.js';

const stem = (d) => d.replace(/\.tex$/, '');

// A file belongs to the TeX installation when it lies inside one of its
// roots, as kpsewhich reports them. By name alone, a project in ~/tex/ or
// ~/Documents/textos/ looked like part of the system and lost files.
let texRoots = null;
export function systemTexRoots() {
  if (texRoots) return texRoots;
  texRoots = [];
  const kpse = findOnPath('kpsewhich');
  if (kpse) {
    // TEXMFMAIN: on Debian and Ubuntu texmf.cnf lives in /usr/share/texmf,
    // outside TEXMFROOT (/usr/share/texlive).
    for (const v of ['TEXMFROOT', 'TEXMFMAIN', 'TEXMFDIST', 'TEXMFLOCAL', 'TEXMFSYSVAR', 'TEXMFSYSCONFIG', 'TEXMFVAR', 'TEXMFCONFIG', 'TEXMFHOME']) {
      try {
        const out = execFileSync(kpse, ['-var-value', v], { env: toolEnv(), encoding: 'utf8', timeout: 5000 }).trim();
        for (const r of out.split(/[;:](?![\\/])/).map((x) => x.replace(/^!!/, '').trim()).filter((x) => path.isAbsolute(x)))
          for (const x of [path.resolve(r), (() => { try { return fs.realpathSync(r); } catch { return null; } })()])
            if (x && !texRoots.includes(x)) texRoots.push(x);
      } catch {}
    }
  }
  return texRoots;
}
// Without kpsewhich: only whole folder names the installations use.
const SYSTEM_TEX_NAME = /[\\/](texmf[\w-]*|texlive|TeX|MiKTeX[^\\/]*)[\\/]/;
export function isSystemTex(p) {
  const roots = systemTexRoots();
  if (roots.length) return roots.some((r) => isInDir(r, p));
  return SYSTEM_TEX_NAME.test(p);
}
const GENERATED = /\.(aux|out|toc|lof|lot|nav|snm|vrb|fls|log|synctex\.gz|bcf|run\.xml|fdb_latexmk|blg)$/;
// Staged text files whose paths may point outside the document folder.
const REWRITABLE = /\.(tex|ltx|sty|cls|cfg|def|tikz|pgf)$/i;

// Files the document needs: what it actually read, from latexmk's .fls
// (-recorder), plus the include closure and figures for documents compiled
// without -recorder. Includes project files outside the document folder
// (../analysis/fig.pdf); system TeX files are left out.
export function sourceFiles(doc) {
  const dir = path.dirname(doc);
  const files = new Set();
  const fls = readText(outputs(doc).fls);
  if (fls) {
    let pwd = dir;
    for (const line of fls.split('\n')) {
      const m = line.match(/^PWD (.+)$/);
      if (m) pwd = m[1];
      const i = line.match(/^INPUT (.+)$/);
      if (!i) continue;
      const p = path.resolve(pwd, i[1]);
      if (GENERATED.test(p) || isSystemTex(p) || isDevice(i[1])) continue;
      files.add(p);
    }
  }
  for (const f of includeClosure(doc)) {
    files.add(f);
    const body = stripComments(readText(f) || '');
    const re = /\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(body))) {
      const base = path.resolve(dir, m[2].trim());
      const hit = ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps'].map((e) => base + e).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (hit) files.add(hit);
    }
  }
  files.add(doc);
  // The bibliography as compiled (.bbl) instead of the .bib: arXiv does not
  // run BibTeX, and the .bbl guarantees the references come out the same.
  for (const [src] of buildCopies(doc)) files.add(src);
  return [...files].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile()).sort();
}

// By path.relative, not by prefix: works with either separator and with the
// mixed / and \ that TeX writes into .fls on Windows.
const isInDir = (dir, f) => {
  const r = path.relative(path.resolve(dir), path.resolve(f));
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};
// Device files (/dev/null, /dev/tty) and Windows' nul never go into a ZIP.
const isDevice = (raw) => raw.startsWith('/dev/') || /^nul(\.|$)/i.test(raw);

// Build files the ZIP carries: the compiled bibliography (.bbl; arXiv does
// not run BibTeX) and the labels of external documents (.aux, so
// \externaldocument resolves). A latexmkrc may keep them in $aux_dir; in the
// ZIP they go next to their .tex, where TeX looks for them.
export function buildCopies(doc) {
  const out = [];
  const o = outputs(doc);
  if (fs.existsSync(o.bbl)) out.push([o.bbl, path.join(o.dir, path.basename(o.bbl))]);
  for (const ext of docInfo(doc).externals) {
    const e = outputs(ext);
    if (fs.existsSync(e.aux)) out.push([e.aux, path.join(e.dir, path.basename(e.aux))]);
  }
  return out;
}
const stripUp = (rel) => {
  const parts = rel.split(/[\\/]/);
  while (parts[0] === '..') parts.shift();
  return parts.join('/');
};

// Where each file goes inside the ZIP. Files in the document folder keep
// their path; files outside lose the leading ../ (../analysis/fig.pdf ->
// analysis/fig.pdf), or go under externos/ when that would clash with a
// file already there.
export function zipLayout(doc, files) {
  const dir = path.dirname(doc);
  const inside = files.filter((f) => isInDir(dir, f));
  const outside = files.filter((f) => !isInDir(dir, f));
  const taken = new Set(inside.map((f) => path.relative(dir, f)));
  let prefix = '';
  const plain = outside.map((f) => stripUp(path.relative(dir, f)));
  const clash = plain.some((p, k) => taken.has(p) || fs.existsSync(path.join(dir, p)) || plain.indexOf(p) !== k);
  if (clash) prefix = 'externos/';
  const map = new Map(inside.map((f) => [f, path.relative(dir, f)]));
  outside.forEach((f, k) => map.set(f, prefix + plain[k]));
  // Build files kept in an $aux_dir go where TeX looks for them.
  for (const [src, place] of buildCopies(doc)) {
    if (!map.has(src) || src === place) continue;
    map.set(src, isInDir(dir, place) || place.startsWith(dir + path.sep) ? path.relative(dir, place) : prefix + stripUp(path.relative(dir, place)));
  }
  // Maps an absolute path (a moved file, one of its folders, or a file
  // given without extension) to its place in the ZIP, or null.
  const target = (abs) => {
    if (map.has(abs) && !isInDir(dir, abs)) return map.get(abs);
    const related = outside.some((f) => f.startsWith(abs + path.sep) || f.startsWith(abs + '.'));
    if (!related || isInDir(dir, abs) || abs === dir) return null;
    return prefix + stripUp(path.relative(dir, abs)) || '.';
  };
  return { map, outside, prefix, target };
}

// Rewrites, in one staged file, every path that points to a moved file or
// folder: relative ones starting with ../ and absolute ones.
export function rewritePaths(text, dir, target) {
  let changed = 0;
  const re = /(^|[^\w./-])((?:\.\.\/)+[^\s{}\[\],%"]*|\/(?:[^\s{}\[\],%"/]+\/)*[^\s{}\[\],%"]+)/gm;
  const out = text.replace(re, (all, lead, p) => {
    const slash = p.endsWith('/');
    const t = target(path.resolve(dir, p.replace(/\/+$/, '')));
    if (t == null) return all;
    changed++;
    return lead + t + (slash && !t.endsWith('/') ? '/' : '');
  });
  return { text: out, changed };
}

// Builds the ZIP in a temporary folder: copies, moves the outside files in,
// fixes their paths in the copies (the originals stay as they are).
export async function exportZip(doc, { check = true } = {}) {
  const dir = path.dirname(doc);
  const files = sourceFiles(doc);
  const { map, outside, target } = zipLayout(doc, files);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-zip-'));
  const rewritten = [];
  try {
    for (const [src, rel] of map) {
      const dst = path.join(stage, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (outside.length && REWRITABLE.test(src)) {
        const { text, changed } = rewritePaths(readText(src) || '', dir, target);
        fs.writeFileSync(dst, text);
        if (changed) rewritten.push({ file: rel, changed });
      } else fs.copyFileSync(src, dst);
    }
    const names = [...map.values()].sort();
    const outName = `${path.basename(stem(doc))}-submissao.zip`;
    const out = path.join(dir, outName);
    fs.rmSync(out, { force: true });
    const r = await run(...zipCommand(out, names), { cwd: stage, timeout: 120000 });
    if (r.code !== 0) throw new Error('zip falhou: ' + (r.stderr || r.stdout));
    const moved = outside.map((f) => ({ from: f, to: map.get(f) }));
    const result = { zip: out, files: names, moved, rewritten, size: fs.statSync(out).size };
    if (check) result.check = await checkZip(out, path.relative(dir, doc), docInfo(doc).engine, outputs(doc).log);
    return result;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

// Proof that the ZIP compiles alone: extract it into an empty folder and run
// the engine directly, as arXiv does (no BibTeX, no latexmk), until labels
// settle. Then look for errors, ??, missing files, and any file read from
// outside the extracted folder (an absolute path left in the sources).
export async function checkZip(zip, mainRel, engine = 'pdflatex', origLog = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-check-'));
  try {
    const u = await run(...unzipCommand(zip, tmp), { timeout: 120000 });
    if (u.code !== 0) return { ok: false, fatal: 'unzip falhou: ' + (u.stderr || u.stdout) };
    const main = path.join(tmp, mainRel);
    const cwd = path.dirname(main);
    let parsed = null;
    let runs = 0;
    for (; runs < 4; ) {
      runs++;
      await run(engine, ['-interaction=nonstopmode', '-file-line-error', '-recorder', path.basename(main)], { cwd, timeout: 300000 });
      const log = readText(stem(main) + '.log');
      if (!log) return { ok: false, fatal: `${engine} não gerou log.`, runs };
      parsed = parseLog(log, cwd);
      if (!parsed.rerun || parsed.errors.length) break;
    }
    const leaks = [];
    for (const line of (readText(stem(main) + '.fls') || '').split('\n')) {
      const i = line.match(/^INPUT (.+)$/);
      if (!i) continue;
      const p = path.resolve(cwd, i[1]);
      if (isInDir(tmp, p) || isSystemTex(p) || isDevice(i[1]) || leaks.includes(p)) continue;
      leaks.push(p);
    }
    const rel = (f) => (f && isInDir(tmp, f) ? path.relative(tmp, f) : f);
    const orig = origLog && readText(origLog);
    const origPages = orig ? parseLog(orig, path.dirname(origLog)).pages : null;
    const out = {
      runs,
      pages: parsed.pages,
      origPages,
      errors: parsed.errors.slice(0, 20).map((e) => ({ ...e, file: rel(e.file) })),
      undefinedRefs: parsed.undefinedRefs.map((r) => r.key),
      undefinedCites: parsed.undefinedCites.map((c) => c.key),
      missingFiles: [...new Set(parsed.missingFiles)],
      leaks,
      pdf: fs.existsSync(stem(main) + '.pdf'),
    };
    out.ok = out.pdf && !out.errors.length && !out.undefinedRefs.length && !out.undefinedCites.length && !out.missingFiles.length && !leaks.length;
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Double-blind check. Returns findings with file and line where possible.
export async function blindCheck(doc, { names = [] } = {}) {
  const findings = [];
  const add = (kind, message, file, line) => findings.push({ kind, message, file, line });
  const nameRes = names
    .map((n) => n.trim())
    .filter((n) => n.length >= 3)
    .map((n) => ({ n, re: new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }));
  for (const f of includeClosure(doc)) {
    const lines = (readText(f) || '').split('\n');
    lines.forEach((raw, i) => {
      const line = stripComments(raw);
      const ln = i + 1;
      const author = line.match(/\\author\s*\{([^}]*)\}/);
      if (author && author[1].trim()) add('author', `\\author{} não está vazio: "${author[1].trim().slice(0, 60)}"`, f, ln);
      if (/\\thanks\s*\{/.test(line)) add('thanks', '\\thanks{} costuma trazer nome, afiliação ou agradecimentos.', f, ln);
      if (/acknowledg|agradec/i.test(line)) add('ack', 'Agradecimentos no texto.', f, ln);
      const email = line.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (email) add('email', `E-mail no texto: ${email[0]}`, f, ln);
      const home = line.match(/\/(?:Users|home)\/([\w.-]+)\//);
      if (home) add('path', `Caminho absoluto com o nome de usuário "${home[1]}" (aparece nos .tex e às vezes no PDF).`, f, ln);
      if (/github\.com\/[\w-]+|osf\.io\/\w+|dropbox\.com/i.test(line)) add('link', 'Link que pode identificar os autores (GitHub, OSF, Dropbox).', f, ln);
      for (const { n, re } of nameRes) if (re.test(line)) add('name', `Aparece "${n}".`, f, ln);
      if (/\b(our|my) (previous|earlier|companion) (paper|work)\b|\bin our (paper|work)\b|\bnosso (trabalho|artigo) anterior\b/i.test(line)) add('self', 'Autocitação na primeira pessoa ("our previous paper").', f, ln);
    });
    // Comments are stripped from the PDF but stay in the sources sent to
    // arXiv or a journal system.
    lines.forEach((raw, i) => {
      const c = raw.match(/(^|[^\\])%(.*)$/);
      if (c) for (const { n, re } of nameRes) if (re.test(c[2])) add('comment', `Nome "${n}" num comentário (vai junto se mandar os .tex).`, f, i + 1);
    });
  }
  const pdf = outputs(doc).pdf;
  if (fs.existsSync(pdf)) {
    const r = await run('pdfinfo', [pdf], { timeout: 15000 });
    if (r.code === 0) {
      const author = (r.stdout.match(/^Author:[ \t]*(\S.*)$/m) || [])[1];
      const creator = (r.stdout.match(/^Creator:[ \t]*(\S.*)$/m) || [])[1];
      if (author) add('meta', `O PDF tem metadado Author: "${author}". Use \\hypersetup{pdfauthor={}}.`, doc, null);
      for (const { n, re } of nameRes) if (creator && re.test(creator)) add('meta', `Metadado Creator do PDF cita "${n}".`, doc, null);
    }
    // Journal systems and arXiv reject Type 3 (bitmap) and non-embedded
    // fonts; they usually come from old figures or a missing cm-super.
    const pf = await run('pdffonts', [pdf], { timeout: 15000 });
    if (pf.code === 0) {
      const { type3, unembedded } = parsePdffonts(pf.stdout);
      if (type3.length) add('font', `Fontes Type 3 (bitmap) no PDF: ${type3.slice(0, 6).join(', ')}. Muitas revistas recusam; costuma vir de figuras antigas ou de faltar o pacote cm-super (\\usepackage[T1]{fontenc} com lmodern resolve no texto).`, doc, null);
      if (unembedded.length) add('font', `Fontes não embutidas no PDF: ${unembedded.slice(0, 6).join(', ')}. Geralmente vêm de figuras; exporte-as de novo com as fontes embutidas.`, doc, null);
    }
  }
  return findings;
}

// Type 3 and non-embedded font names from pdffonts output.
export function parsePdffonts(out) {
  const rows = out.split('\n').slice(2).filter((l) => l.trim());
  const type3 = new Set();
  const unembedded = new Set();
  for (const l of rows) {
    const m = l.match(/^(.*?)\s+(Type 3|Type 1C?|TrueType(?: \(CID\))?|CID Type 0C?|CID TrueType|Type 1C)\s+(\S+)\s+(yes|no)\s+(yes|no)\s+(yes|no)/);
    if (!m) continue;
    const name = m[1].trim().replace(/^[A-Z]{6}\+/, '') || '[sem nome]';
    if (m[2] === 'Type 3') type3.add(name);
    if (m[4] === 'no') unembedded.add(name);
  }
  return { type3: [...type3], unembedded: [...unembedded] };
}
