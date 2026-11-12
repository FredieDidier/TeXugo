// "Revisar como parecerista": the whole paper (every \input file, with line
// numbers) goes to the user's own Claude Code, read-only, which writes a
// referee report as JSON. Each point quotes the passage it is about; the
// quote, not the line Claude reports, places the point in the source, so a
// click lands on the right line. Saved in .texugo/review for later.
import { L, locale } from './lang.js';
import fs from 'node:fs';
import path from 'node:path';
import { readText } from './util.js';
import { includeClosure } from './project.js';
import { runClaude } from './ai.js';

const MAX = 600000; // characters of source sent

function sources(doc) {
  const docDir = path.dirname(doc);
  const files = [...includeClosure(doc)].filter((f) => /\.(tex|ltx)$/i.test(f));
  let total = 0;
  const parts = [];
  for (const f of files) {
    const text = readText(f) || '';
    const rel = path.relative(docDir, f);
    const numbered = text.split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');
    if (total + numbered.length > MAX) {
      parts.push(`<file path="${rel}">(omitted: the paper is too long to send whole)</file>`);
      continue;
    }
    total += numbered.length;
    parts.push(`<file path="${rel}">\n${numbered}\n</file>`);
  }
  return { files, text: parts.join('\n\n') };
}

export function buildReviewPrompt({ doc, journal, focus, lang, text }) {
  return [
    `You are a referee for ${journal ? journal : 'a high-impact field journal'}. Review the paper whose LaTeX source follows (main file ${path.basename(doc)} and every file it inputs, each line prefixed with its number).`,
    `If a skill for this kind of paper is available to you (for example applied-micro-paper-writing, manuscript-audit or a field skill), load it and use its standards. You may Read other files of the project (tables, figures' code, notes) if a point needs them; do not edit anything.`,
    `Write the report a demanding but fair referee would write: what the paper does and claims, the main concerns (identification, data, inference, interpretation, contribution), then minor points, then typos and wording. Every point must be specific to this paper and actionable. No praise padding, no generic advice.`,
    focus ? `The author asks you to pay special attention to: ${focus}` : '',
    `Write the comments in ${lang === 'en' ? 'English' : 'Portuguese (Brazil)'}.`,
    `Reply with JSON only, between <texugo> and </texugo>, with this shape:
{"summary": "3-5 sentences: what the paper does and finds",
 "recommendation": "reject | major revision | minor revision | accept",
 "points": [{"kind": "major" | "minor" | "typo",
             "title": "a few words",
             "comment": "the point, as the referee would write it",
             "suggestion": "what to do about it (may be empty)",
             "file": "path of the file as given above",
             "line": number,
             "quote": "an exact, contiguous excerpt (5 to 15 words) of that line, copied character by character from the source"}]}
Points about the whole paper still need the file and line where the issue shows most clearly. Order: major, minor, typo.`,
    text,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Where a quote really is: the line in that file (or any file) holding it.
export function anchor(point, files, docDir) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const q = norm(point.quote);
  const target = point.file ? path.resolve(docDir, point.file) : null;
  const order = target ? [target, ...files.filter((f) => f !== target)] : files;
  if (q.length >= 8) {
    for (const f of order) {
      const lines = (readText(f) || '').split('\n');
      // Quotes may span a line break: search a sliding pair of lines.
      for (let i = 0; i < lines.length; i++) {
        const two = norm(lines[i] + ' ' + (lines[i + 1] || ''));
        const at = two.indexOf(q);
        if (at >= 0) return { file: f, line: at <= norm(lines[i]).length ? i + 1 : i + 2, exact: true };
      }
    }
  }
  if (target && fs.existsSync(target)) return { file: target, line: Math.max(1, Number(point.line) || 1), exact: false };
  return { file: files[0], line: Math.max(1, Number(point.line) || 1), exact: false };
}

export function parseReport(result) {
  const m = result.match(/<texugo>\s*([\s\S]*?)\s*<\/texugo>/);
  const raw = (m ? m[1] : result).replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('O parecer veio sem o formato esperado. Tente de novo.');
  const data = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(data.points)) throw new Error('O parecer veio sem a lista de pontos.');
  return data;
}

export async function review({ root, doc, journal, focus, lang, model, effort }) {
  const docDir = path.dirname(doc);
  const src = sources(doc);
  const prompt = buildReviewPrompt({ doc, journal, focus, lang, text: src.text });
  const t0 = Date.now();
  const result = await runClaude(prompt, { root, model, effort, timeout: 30 * 60000 });
  const data = parseReport(result);
  const order = { major: 0, minor: 1, typo: 2 };
  const points = data.points
    .map((p, i) => ({ id: i + 1, kind: ['major', 'minor', 'typo'].includes(p.kind) ? p.kind : 'minor', title: String(p.title || ''), comment: String(p.comment || ''), suggestion: String(p.suggestion || ''), quote: String(p.quote || ''), ...anchor(p, [...src.files], docDir) }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.id - b.id);
  const report = { doc, journal: journal || '', focus: focus || '', model: model || '', effort: effort || '', date: new Date().toISOString(), ms: Date.now() - t0, summary: String(data.summary || ''), recommendation: String(data.recommendation || ''), points };
  const dir = path.join(docDir, '.texugo', 'review');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${path.basename(doc, '.tex')}.json`), JSON.stringify(report, null, 2));
  return report;
}

export function lastReview(doc) {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(doc), '.texugo', 'review', `${path.basename(doc, '.tex')}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// The report as Markdown, to keep or send.
export function toMarkdown(r, root) {
  const rel = (f) => path.relative(root, f);
  // In the UI language: the file is kept or sent as it is.
  const kinds = { major: L('Comentários principais', 'Major comments'), minor: L('Comentários menores', 'Minor comments'), typo: L('Erros de digitação e redação', 'Typos and wording') };
  const recs = L({ reject: 'rejeitar', 'major revision': 'revisão maior', 'minor revision': 'revisão menor', accept: 'aceitar' }, { reject: 'reject', 'major revision': 'major revision', 'minor revision': 'minor revision', accept: 'accept' });
  const out = [`# ${L('Parecer', 'Referee report')}: ${path.basename(r.doc)}`, '', `${new Date(r.date).toLocaleString(locale())}${r.journal ? ` · ${r.journal}` : ''} · ${L('recomendação', 'recommendation')}: **${recs[String(r.recommendation).toLowerCase()] || r.recommendation}**`, '', `## ${L('Resumo', 'Summary')}`, '', r.summary, ''];
  for (const k of ['major', 'minor', 'typo']) {
    const ps = r.points.filter((p) => p.kind === k);
    if (!ps.length) continue;
    out.push(`## ${kinds[k]}`, '');
    ps.forEach((p, i) => {
      out.push(`${i + 1}. **${p.title}** (${rel(p.file)}:${p.line}) ${p.comment}${p.suggestion ? `\n   *${L('Sugestão', 'Suggestion')}:* ${p.suggestion}` : ''}`);
    });
    out.push('');
  }
  return out.join('\n');
}
