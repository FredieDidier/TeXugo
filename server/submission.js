// Submission helpers: a ZIP that compiles on its own (arXiv, journals) and a
// double-blind check that looks for author traces in sources and PDF.
import fs from 'node:fs';
import path from 'node:path';
import { includeClosure, docInfo } from './project.js';
import { readText, run, stripComments } from './util.js';

const stem = (d) => d.replace(/\.tex$/, '');

// Files the document actually read, from latexmk's .fls (-recorder), limited
// to the document folder and its subfolders. Falls back to the include
// closure when there is no .fls yet.
export function sourceFiles(doc, outside = []) {
  const dir = path.dirname(doc);
  const files = new Set();
  const fls = readText(stem(doc) + '.fls');
  if (fls) {
    let pwd = dir;
    for (const line of fls.split('\n')) {
      const m = line.match(/^PWD (.+)$/);
      if (m) pwd = m[1];
      const i = line.match(/^INPUT (.+)$/);
      if (!i) continue;
      const p = path.resolve(pwd, i[1]);
      if (!p.startsWith(dir + path.sep)) {
        // Project files outside the document folder (../analysis/fig.pdf)
        // break a standalone ZIP; system TeX files are fine.
        if (!/\/(texmf|texlive|TeX)[^/]*\//i.test(p) && !p.startsWith('/dev/') && !outside.includes(p)) outside.push(p);
        continue;
      }
      if (/\.(aux|out|toc|lof|lot|nav|snm|vrb|fls|log|synctex\.gz|bcf|run\.xml)$/.test(p)) continue;
      files.add(p);
    }
  }
  for (const f of includeClosure(doc)) {
    files.add(f);
    // Figures, for documents compiled without -recorder (no .fls).
    const body = stripComments(readText(f) || '');
    const re = /\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(body))) {
      const base = path.resolve(dir, m[2].trim());
      const hit = ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps'].map((e) => base + e).find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!hit) continue;
      if (hit.startsWith(dir + path.sep)) files.add(hit);
      else if (!outside.includes(hit)) outside.push(hit);
    }
  }
  files.add(doc);
  // The bibliography as compiled (.bbl) instead of the .bib: arXiv does not
  // run BibTeX, and the .bbl guarantees the references come out the same.
  if (fs.existsSync(stem(doc) + '.bbl')) files.add(stem(doc) + '.bbl');
  // Labels of external documents, so \externaldocument still resolves.
  for (const ext of docInfo(doc).externals) if (fs.existsSync(stem(ext) + '.aux')) files.add(stem(ext) + '.aux');
  return [...files].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile()).sort();
}

export async function exportZip(doc) {
  const dir = path.dirname(doc);
  const outside = [];
  const files = sourceFiles(doc, outside).map((f) => path.relative(dir, f));
  const outName = `${path.basename(stem(doc))}-submissao.zip`;
  const out = path.join(dir, outName);
  fs.rmSync(out, { force: true });
  const r = await run('zip', ['-X', '-q', out, ...files], { cwd: dir, timeout: 120000 });
  if (r.code !== 0) throw new Error('zip falhou: ' + (r.stderr || r.stdout));
  return { zip: out, files, outside, size: fs.statSync(out).size };
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
  const pdf = stem(doc) + '.pdf';
  if (fs.existsSync(pdf)) {
    const r = await run('pdfinfo', [pdf], { timeout: 15000 });
    if (r.code === 0) {
      const author = (r.stdout.match(/^Author:[ \t]*(\S.*)$/m) || [])[1];
      const creator = (r.stdout.match(/^Creator:[ \t]*(\S.*)$/m) || [])[1];
      if (author) add('meta', `O PDF tem metadado Author: "${author}". Use \\hypersetup{pdfauthor={}}.`, doc, null);
      for (const { n, re } of nameRes) if (creator && re.test(creator)) add('meta', `Metadado Creator do PDF cita "${n}".`, doc, null);
    }
  }
  return findings;
}
