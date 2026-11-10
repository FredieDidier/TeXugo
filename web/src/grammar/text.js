// Plain text for the grammar checker, with a map back to the source.
//
// LanguageTool reads plain prose. From a .tex (or .md) file we take the
// "words" layer of the vícios detector (same length as the source, with
// markup blanked) and turn it into one plain paragraph at a time:
//   - formatting markup (\emph{, }, \section{) disappears;
//   - markup that stood for something (math, \cite, \ref, a table) becomes
//     the placeholder word "Dummy", so "the effect of $x$ on" still reads as
//     a sentence; any match touching a placeholder is dropped later;
//   - ties, line breaks and runs of spaces become one space;
//   - ``quotes'', -- and --- become the characters they print.
// Every plain character keeps the source range it came from, so a match at
// plain offset o, length n maps to source [start[o], end[o+n-1]).
import { layersFor } from '../vicios/prose.js';
import { paragraphs, kindOf } from '../vicios/core.js';

export const DUMMY = 'Dummy';
const ESCAPED = { '\\%': '%', '\\&': '&', '\\$': '$', '\\#': '#', '\\_': '_' };
const NOISE = /\\[a-zA-Z@]+\*?|[{}[\]~\s]/g;
// Markup that prints nothing a sentence would read: labels, spacing, the
// bounds of an environment, comments.
const INVISIBLE = /(?<!\\)%[^\n]*|\\(?:label|index|vspace\*?|hspace\*?|phantomsection|noindent|medskip|bigskip|smallskip|centering|newpage|clearpage|item|maketitle|tableofcontents|appendix)\b(?:\[[^\]]*\])?(?:\{[^}]*\})?|\\(?:begin|end)\{[^}]*\}(?:\[[^\]]*\])?/g;
const HEADING = /\\(?:part|chapter|section|subsection|subsubsection|paragraph|caption|title)\*?\s*(?:\[[^\]]*\])?\{/g;

// Index just past the {...} group opening at i.
function closeBrace(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '\\') {
      j++;
      continue;
    }
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return j + 1;
  }
  return src.length;
}

export function grammarParagraphs(src, path = 'x.tex', { lang = 'auto' } = {}) {
  const kind = kindOf(path) || 'txt';
  const { words } = layersFor(src, kind);
  const { paras } = paragraphs(words, lang === 'pt' || lang === 'en' ? lang : null);
  // Footnotes are checked as paragraphs of their own, so the sentence around
  // them still reads as one sentence. Heading arguments end their own
  // paragraph (a heading has no final period).
  const notes = [];
  for (const m of src.matchAll(/\\footnote\s*(?:\[[^\]]*\])?\{/g)) {
    const open = m.index + m[0].length - 1;
    notes.push({ from: m.index, inner: open + 1, to: closeBrace(src, open) });
  }
  const headEnds = new Set();
  for (const m of src.matchAll(HEADING)) headEnds.add(closeBrace(src, m.index + m[0].length - 1) - 1);
  const ctx = { notes, headEnds };
  const out = [];
  for (const p of paras) {
    const para = plainOf(src, words, p.from, p.to, ctx);
    if (para) out.push({ ...para, lang: p.lang });
    for (const n of notes) {
      if (n.from < p.from || n.from >= p.to) continue;
      const fn = plainOf(src, words, n.inner, n.to - 1, { notes: notes.filter((x) => x !== n && x.from > n.from && x.to <= n.to), headEnds });
      if (fn) out.push({ ...fn, lang: p.lang });
    }
  }
  return out;
}

function plainOf(src, words, from, to, { notes = [], headEnds = new Set() } = {}) {
  let text = '';
  const start = [];
  const end = [];
  const dummies = []; // [from, to) in plain offsets
  const put = (s, a, b) => {
    for (const ch of s) {
      text += ch;
      start.push(a);
      end.push(b);
    }
  };
  const space = (a, b) => {
    if (!text || /\s$/.test(text)) return;
    put(' ', a, b);
  };
  let i = from;
  while (i < to) {
    const note = notes.find((n) => n.from === i);
    if (note) {
      i = note.to;
      continue;
    }
    if (headEnds.has(i) && text) {
      while (text.endsWith(' ')) (text = text.slice(0, -1), start.pop(), end.pop());
      put('\n\n', i, i + 1);
      i++;
      continue;
    }
    const w = words[i];
    if (w !== ' ' && w !== '\n' && w !== '\t') {
      // Prose character (kept by the words layer).
      if (src.startsWith('---', i) && words.startsWith('---', i)) (put('—', i, i + 3), (i += 3));
      else if (src.startsWith('--', i) && words.startsWith('--', i)) (put('–', i, i + 2), (i += 2));
      else if (src.startsWith('``', i)) (put('“', i, i + 2), (i += 2));
      else if (src.startsWith("''", i)) (put('”', i, i + 2), (i += 2));
      else (put(src[i], i, i + 1), i++);
      continue;
    }
    // A blank stretch: real whitespace and/or blanked markup, up to the next
    // prose character.
    let j = i;
    while (j < to && (words[j] === ' ' || words[j] === '\n' || words[j] === '\t') && !notes.some((n) => n.from === j) && !(headEnds.has(j) && j > i)) j++;
    const orig = src.slice(i, j);
    const markup = orig.replace(INVISIBLE, ' ').trim();
    if (!markup) {
      space(i, j);
    } else if (ESCAPED[markup]) {
      if (/^\s/.test(orig)) space(i, i + 1);
      put(ESCAPED[markup], i + orig.indexOf(markup), i + orig.indexOf(markup) + markup.length);
      if (/\s$/.test(orig)) space(j - 1, j);
    } else {
      const meaningful = markup.replace(NOISE, '').length > 0 && !/^\\(?:begin|end)\{[^}]*\}$/.test(markup);
      const lead = /^[\s~]/.test(orig) || /^\\(?:footnote|par|item)\b/.test(markup);
      const trail = /[\s~]$/.test(orig);
      if (meaningful) {
        if (lead) space(i, i + 1);
        const a = text.length;
        const s0 = i + orig.indexOf(markup);
        put(DUMMY, s0, s0 + markup.length);
        dummies.push([a, text.length]);
        if (trail) space(j - 1, j);
      } else if (lead || trail || /\s/.test(markup)) space(i, j);
    }
    i = j;
  }
  // Trim the trailing space.
  while (/\s$/.test(text)) {
    text = text.slice(0, -1);
    start.pop();
    end.pop();
  }
  const prose = text.split(DUMMY).join('').replace(/[\s\p{P}]/gu, '');
  if (!prose) return null;
  return { text, start, end, dummies, from, to };
}

// Source range of a LanguageTool match, or null when it touches a
// placeholder (the "error" is in our stand-in, not in the user's text).
export function mapMatch(para, offset, length) {
  const a = offset;
  const b = offset + Math.max(1, length);
  if (a < 0 || b > para.text.length) return null;
  for (const [x, y] of para.dummies) if (a < y && b > x) return null;
  return { from: para.start[a], to: para.end[b - 1] };
}

// LanguageTool language code for our guess.
export const ltLang = (lang) => (lang === 'pt' ? 'pt-BR' : 'en-US');
