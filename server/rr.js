// "Resposta aos pareceristas": from the reports the user pastes and the
// changes made since the submitted version (a Git commit or the files that
// were sent), the user's agent (Claude Code or another) splits the reports into comments,
// drafts a reply to each and says where the paper changed. TeXugo writes a
// response.tex in the format of its "Resposta aos pareceristas" template,
// each change tied to the current source line and, when the PDF has
// SyncTeX, to its page.
import { outputs } from './outdirs.js';
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './util.js';
import { includeClosure, linkedDocuments, paperFiles } from './project.js';
import { runAgent } from './ai.js';
import { agentById } from './agents/adapter.js';
import { wordDiff } from './compare.js';
import { anchor } from './review.js';
import * as sync from './synctex.js';

function numberedSources(doc, max = 400000) {
  const docDir = path.dirname(doc);
  const files = paperFiles(doc).filter((f) => /\.(tex|ltx)$/i.test(f));
  let total = 0;
  const parts = [];
  for (const f of files) {
    const numbered = (readText(f) || '').split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');
    if (total + numbered.length > max) continue;
    total += numbered.length;
    parts.push(`<file path="${path.relative(docDir, f)}">\n${numbered}\n</file>`);
  }
  return { files, text: parts.join('\n\n') };
}

// The word diff of the paper and of the documents linked to it (the online
// appendix), with paths relative to the paper's folder. A linked document
// comes from a Git version only: a .tex, ZIP or folder that was sent may not
// bring it, and the mirror would then compare it with another document.
async function paperDiff(doc, source) {
  const docDir = path.dirname(doc);
  const main = await wordDiff(doc, source);
  const diff = { label: main.label, changedFiles: [...main.changedFiles], text: main.text };
  if (source.kind !== 'git') return diff;
  for (const other of linkedDocuments(doc).slice(1)) {
    let d;
    try {
      d = await wordDiff(other, source);
    } catch {
      continue; // not in that version
    }
    const rel = (f) => path.relative(docDir, path.resolve(path.dirname(other), f));
    for (const m of d.text.matchAll(/<diff file="([^"]+)">\n[\s\S]*?\n<\/diff>/g)) {
      const f = rel(m[1]);
      if (diff.changedFiles.includes(f)) continue; // a shared preamble, already there
      diff.changedFiles.push(f);
      diff.text += (diff.text ? '\n\n' : '') + m[0].replace(`<diff file="${m[1]}">`, `<diff file="${f}">`);
    }
  }
  return diff;
}

// What a reader calls a linked document in the letter.
const docLabel = (f) => (/append|ap[eê]ndice|supplement|online/i.test(path.basename(f)) ? 'Online Appendix' : path.basename(f));

export function buildPrompt({ doc, reports, diff, sources, lang }) {
  return [
    `The author of the paper ${path.basename(doc)} received the referee reports below and is preparing the revision. Help write the response letter.`,
    `If a writing skill is available to you (for example applied-micro-paper-writing), load it and follow it. Read-only: do not edit any file.`,
    `1. Split the reports into the individual comments of the editor and of each referee, in order, copying each comment verbatim (a long comment with several requests may be split into its parts).`,
    diff
      ? `2. For each comment, look at the changes made since the submitted version (the word diff below: [-removed-] {+added+}) and at the current text, and decide whether it was addressed. If it was, draft a reply that says what was done and point to where the paper changed: give the file, the current line and an exact 5-15 word quote of the current text there. If it was not addressed, say so with status "todo" and write in the reply what the author still needs to do. If the author would reasonably disagree, use status "disagree" and draft a respectful argument.`
      : `2. The author has not revised yet. For each comment, draft the reply the author could give and, with status "todo", what must change in the paper and where (file, line and an exact quote of the current text).`,
    `Replies are polite, specific and short; no flattery beyond one "We thank the referee" per report. Write the replies in ${lang === 'pt' ? 'Portuguese' : 'English'} as LaTeX-ready text (escape %, &, $, # and _; \\citet and \\citep are fine).`,
    `Reply with JSON only, between <texugo> and </texugo>:
{"intro": "one short paragraph thanking the editor and summarising the revision",
 "main_changes": ["the 2-5 most important changes, one sentence each"],
 "sections": [{"who": "Editor" | "Referee 1" | ...,
               "comments": [{"comment": "verbatim text of the comment",
                             "status": "addressed" | "todo" | "disagree",
                             "reply": "the reply",
                             "changes": [{"what": "short description of the change", "file": "path", "line": number, "quote": "exact quote of the current text"}]}]}]}`,
    `<reports>\n${reports}\n</reports>`,
    diff ? `<changes since="${diff.label}">\n${diff.text || '(no changes)'}\n</changes>` : '',
    `<current-text>\n${sources}\n</current-text>`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function parseJson(result) {
  const m = result.match(/<texugo>\s*([\s\S]*?)\s*<\/texugo>/);
  const raw = (m ? m[1] : result).replace(/^```(?:json)?\s*|\s*```$/g, '');
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('A resposta veio sem o formato esperado. Tente de novo.');
  const data = JSON.parse(raw.slice(a, b + 1));
  if (!Array.isArray(data.sections)) throw new Error('A resposta veio sem os comentários.');
  return data;
}

// Plain text from a report into LaTeX.
export const escapeTex = (s) =>
  String(s || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\n{2,}/g, '\\par ')
    .replace(/\n/g, ' ');

// The section heading the line sits under, for "Section “Data”".
function sectionAt(file, line) {
  const lines = (readText(file) || '').split('\n');
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(/\\(?:sub)*section\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/);
    if (m) return m[1].trim();
  }
  return null;
}

const PREAMBLE = (by) => `% !TEX program = pdflatex
% Response to the editor and referees, drafted by TeXugo with ${by} from
% the reports and the changes since the submitted version. Each change
% carries a comment with its source line (⌘-click it to open the line).
\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}
\\usepackage{microtype}
\\usepackage[margin=1in]{geometry}
\\usepackage{xcolor}
\\usepackage[most]{tcolorbox}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage[authoryear,round]{natbib}

\\definecolor{refbg}{RGB}{243,240,232}
\\newcounter{comment}[section]
\\renewcommand{\\thecomment}{\\thesection.\\arabic{comment}}
\\newcommand{\\referee}[1]{\\refstepcounter{comment}\\par\\medskip
  \\begin{tcolorbox}[colback=refbg,colframe=refbg,arc=2pt,left=6pt,right=6pt,top=4pt,bottom=4pt]
  \\textbf{Comment \\thecomment.} \\itshape #1
  \\end{tcolorbox}}
\\newcommand{\\change}[1]{\\par\\smallskip\\noindent\\textcolor{teal!70!black}{\\textbf{Change in the paper:} #1}\\par}
\\newcommand{\\todo}[1]{\\par\\smallskip\\noindent\\textcolor{red!70!black}{\\textbf{To do:} #1}\\par}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.5em}
`;

// Text from the model goes inside a one-line macro argument: a bare % would
// comment out the closing brace and break the build. LaTeX it writes on
// purpose (\cite, \% already escaped) passes through.
export const pct = (t) => String(t ?? '').replace(/(?<!\\)%/g, '\\%').replace(/\r?\n+/g, ' ');

export function toLatex(data, { title, by = 'Claude' }) {
  const out = [PREAMBLE(by), '\\begin{document}', '\\begin{center}', '{\\Large\\bfseries Response to the Editor and Referees}\\\\[4pt]', '``' + escapeTex(title) + "''\\\\[2pt]", '\\today', '\\end{center}', '', 'Dear Editor,', '', data.intro || '', ''];
  if (data.main_changes && data.main_changes.length) {
    out.push('The main changes are:', '\\begin{enumerate}[nosep]', ...data.main_changes.map((c) => `  \\item ${pct(c)}`), '\\end{enumerate}', '');
  }
  for (const sec of data.sections) {
    out.push(`\\section{${escapeTex(sec.who || 'Referee')}}`);
    for (const c of sec.comments || []) {
      out.push(`\\referee{${escapeTex(c.comment)}}`);
      out.push(c.reply || '');
      for (const ch of c.changes || []) {
        if (c.status === 'todo') out.push(`\\todo{${pct(ch.what)}${ch.where ? ` (${pct(ch.where)})` : ''}}${ch.loc ? ` % ${ch.loc}` : ''}`);
        else out.push(`\\change{${pct(ch.what)}${ch.where ? ` (${pct(ch.where)})` : ''}}${ch.loc ? ` % ${ch.loc}` : ''}`);
      }
      if (c.status === 'todo' && !(c.changes || []).length) out.push('\\todo{Revise the paper to address this comment.}');
      out.push('');
    }
  }
  out.push('\\end{document}', '');
  return out.join('\n');
}

export async function respond({ root, doc, reports, source, lang, agent, model, effort }) {
  const docDir = path.dirname(doc);
  const diff = source ? await paperDiff(doc, source) : null;
  const src = numberedSources(doc);
  const prompt = buildPrompt({ doc, reports, diff, sources: src.text, lang });
  const result = await runAgent(prompt, { root, agent, model, effort, timeout: 30 * 60000 });
  const data = parseJson(result);
  // Tie each change to its line, section and, with SyncTeX, the page of
  // the PDF it is in (the paper's, or the appendix's own).
  const linked = linkedDocuments(doc).map((d) => ({ doc: d, files: includeClosure(d), built: outputs(d) }));
  const hasSync = fs.existsSync(linked[0].built.synctex) && fs.existsSync(linked[0].built.pdf);
  let n = 0;
  let todo = 0;
  for (const sec of data.sections) {
    for (const c of sec.comments || []) {
      n++;
      if (c.status === 'todo') todo++;
      for (const ch of c.changes || []) {
        if (!ch.file && !ch.quote) continue;
        const a = anchor(ch, src.files, docDir);
        ch.loc = `${path.relative(docDir, a.file)}:${a.line}`;
        const where = [];
        const owner = linked.find((l) => l.files.has(a.file)) || linked[0];
        if (owner !== linked[0]) where.push(escapeTex(docLabel(owner.doc)));
        const s = sectionAt(a.file, a.line);
        if (s) where.push('Section ``' + escapeTex(s) + "''");
        if (fs.existsSync(owner.built.synctex) && fs.existsSync(owner.built.pdf)) {
          try {
            const r = await sync.forward({ file: a.file, line: a.line, pdf: owner.built.pdf });
            if (r.ok) where.push(`p.~${r.hits[0].page}`);
          } catch {}
        }
        ch.where = where.join(', ');
      }
    }
  }
  const title = ((readText(doc) || '').match(/\\title\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/) || [])[1] || path.basename(doc, '.tex');
  let target = path.join(docDir, 'response.tex');
  for (let i = 2; fs.existsSync(target); i++) target = path.join(docDir, `response-${i}.tex`);
  fs.writeFileSync(target, toLatex(data, { title: title.replace(/\\\\|\\thanks\{.*$/g, ' ').trim(), by: agentById(agent).name }));
  return { file: target, comments: n, todo, changedFiles: diff ? diff.changedFiles : [], since: diff ? diff.label : null, pages: hasSync };
}
