// Plain text for the grammar checker, with a map back to the source.
//
// LanguageTool reads plain prose. From a .tex (or .md) file we take the
// "words" layer of the vícios detector (same length as the source, with
// markup blanked), blank some more LaTeX it leaves (options in brackets,
// key-like arguments of the user's own reference macros) and turn it into
// one plain paragraph at a time:
//   - formatting markup (\emph{, }, \section{, \begin{figure}[tbp]) and
//     labels disappear;
//   - markup that stood for something (math, \cite, \ref, \satab{tab:x}, a
//     macro of the user's that prints a word, a table) becomes the
//     placeholder word "Dummy", so "the effect of $x$ on" still reads as a
//     sentence; matches touching a placeholder are dropped later;
//   - accents written as commands (\c{c}\~oes, \'{U}) become the letters;
//   - ties, line breaks and runs of spaces become one space;
//   - ``quotes'', -- and --- become the characters they print.
// Every plain character keeps the source range it came from, so a match at
// plain offset o, length n maps to source [start[o], end[o+n-1]).
import { layersFor } from '../vicios/prose.js';
import { paragraphs, kindOf, guessLang } from '../vicios/core.js';

export const DUMMY = 'Dummy';
const ESCAPED = { '\\%': '%', '\\&': '&', '\\$': '$', '\\#': '#', '\\_': '_' };
const NOISE = /\\[a-zA-Z@]+\*?|[{}[\]~\s]/g;
// Markup that prints nothing a sentence would read: labels, spacing, the
// bounds of an environment, comments.
const INVISIBLE = /(?<!\\)%[^\n]*|\\href\{[^{}]*\}|\\\\\*?(?:\[[^\]]*\])?|\\(?:label|index|vspace\*?|hspace\*?|phantomsection|noindent|medskip|bigskip|smallskip|centering|newpage|clearpage|item|maketitle|tableofcontents|appendix)\b(?:\[[^\]]*\])?(?:\{[^}]*\})?|\\(?:begin|end)\{[^}]*\}(?:\[[^\]]*\])?/g;
const HEADING = /\\(?:part|chapter|section|subsection|subsubsection|paragraph|caption|title|subtitle|author|date)\*?\s*(?:\[[^\]]*\])?\{/g;
// Commands without arguments that print no word (spacing, fonts, rules).
// Any other bare command is a macro of the user's that prints something
// (\periodpre, \IntensityLabel{}), read as a placeholder word.
const SILENT = new Set(`centering noindent par newline linebreak pagebreak nolinebreak smallskip medskip bigskip vfill hfill hfil quad qquad
enspace thinspace negthinspace bfseries itshape mdseries normalfont rmfamily sffamily ttfamily upshape scshape slshape em bf it rm sf tt sc
tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge raggedright raggedleft hline toprule midrule bottomrule
clearpage cleardoublepage newpage maketitle tableofcontents listoffigures listoftables appendix item protect relax selectfont ignorespaces
unskip xspace and textwidth linewidth columnwidth paperwidth hsize baselineskip parindent onehalfspacing doublespacing singlespacing frontmatter mainmatter backmatter label null nobreak allowbreak
leavevmode strut displaystyle textstyle hfuzz vfuzz nopagebreak footnotemark sloppy fussy justifying`.split(/\s+/));
const PRINTS = { ldots: '…', dots: '…', textellipsis: '…', textendash: '–', textemdash: '—', S: '§', textregistered: '®', copyright: '©', LaTeX: 'LaTeX', TeX: 'TeX' };
// Accents written as commands: \'e \'{e} \~o \c{c} \^{\i}.
const ACCENT = /\\(['`^"~=.]|[cvuHr](?=[\s{]))\s*(?:\{\s*(\\i|[A-Za-z])\s*\}|(\\i|[A-Za-z]))/y;
const COMBINING = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', u: '̆', H: '̋', r: '̊' };

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

function blankRange(w, a, b) {
  for (let k = a; k < b; k++) if (w[k] !== '\n') w[k] = ' ';
}

// LaTeX the words layer still shows as words.
function extraBlanks(src, words) {
  const w = words.split('');
  // Options and arguments right after \begin{env}: [tbp], [leftmargin=*],
  // {0.5\textwidth}.
  for (const m of src.matchAll(/\\begin\{[^}]*\}((?:\s*(?:\[[^\]]*\]|\{[^{}]*\}))+)/g)) blankRange(w, m.index, m.index + m[0].length);
  // \\[4pt]
  for (const m of src.matchAll(/\\\\\*?\s*\[[^\]\n]*\]/g)) blankRange(w, m.index, m.index + m[0].length);
  // Key=value options anywhere: [width=.8\textwidth], [label=(\alph*)].
  for (const m of src.matchAll(/\[[^\]\n]*=[^\]\n]*\]/g)) blankRange(w, m.index, m.index + m[0].length);
  // A command whose argument is a key, not words: \satab{tab:x},
  // \resulttable{tab_outcome}, \Cref{fig:a,fig:b}.
  for (const m of src.matchAll(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?\{([^{}\s]*[:_][^{}\s]*)\}/g)) blankRange(w, m.index, m.index + m[0].length);
  // Short keys in brackets after a command: \author[ufpe], \begin{x}[t],
  // \cite[p.~3] stays (it has a space or tilde).
  for (const m of src.matchAll(/\\(?!item\b)[a-zA-Z@]+\*?(\[[^\]\s~]{1,40}\])/g)) blankRange(w, m.index + m[0].length - m[1].length, m.index + m[0].length);
  // Table-of-contents and running-head copies of headings.
  for (const m of src.matchAll(/\\(?:addcontentsline\{[^}]*\}\{[^}]*\}\{[^{}]*\}|markboth\{[^{}]*\}\{[^{}]*\}|markright\{[^{}]*\})/g)) blankRange(w, m.index, m.index + m[0].length);
  return w.join('');
}

// English spelling of a document: British when it says so (babel) or when
// British forms clearly outnumber American ones.
export function englishVariant(src) {
  if (/\\usepackage\[[^\]]*\b(british|UKenglish|english-gb)\b/.test(src)) return 'en-GB';
  if (/\\usepackage\[[^\]]*\b(american|USenglish)\b/.test(src)) return 'en-US';
  const gb = (src.match(/\b\w+(?:isation|isations|ised|ising|ises|yse[sd]?)\b|\b(?:colour|labour|behaviour|favour|honour|neighbour|programme|centre|defence|analogue|catalogue|grey|artefact|modelling|travelled|licence)s?\b/gi) || []).length;
  const us = (src.match(/\b\w+(?:ization|izations|ized|izing|izes|yze[sd]?)\b|\b(?:color|labor|behavior|favor|honor|neighbor|program|center|defense|analog|catalog|gray|artifact|modeling|traveled|license)s?\b/gi) || []).length;
  return gb >= 3 && gb > us * 1.5 ? 'en-GB' : 'en-US';
}

export function grammarParagraphs(src, path = 'x.tex', { lang = 'auto' } = {}) {
  const kind = kindOf(path) || 'txt';
  let { words } = layersFor(src, kind);
  if (kind === 'tex') words = extraBlanks(src, words);
  const { paras } = paragraphs(words, lang === 'pt' || lang === 'en' ? lang : null);
  const variant = englishVariant(src);
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
  // Italics: by convention foreign words and titles; spelling skips them.
  const italic = [];
  for (const m of src.matchAll(/\\(?:emph|textit|textsl|foreign)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    italic.push([open + 1, closeBrace(src, open) - 1]);
  }
  const accents = new Map();
  for (let k = src.indexOf('\\'); k >= 0; k = src.indexOf('\\', k + 1)) {
    ACCENT.lastIndex = k;
    const m = ACCENT.exec(src);
    if (!m) continue;
    const raw = m[2] || m[3];
    const base = raw === '\\i' ? 'i' : raw;
    // Only where the letter itself is prose (not in a comment or math).
    // (\i is itself a command, so look at the letters around it instead.)
    if (raw === '\\i' ? /\s/.test(words[k - 1] || ' ') && /\s/.test(words[k + m[0].length] || ' ') : /\s/.test(words[k + m[0].lastIndexOf(raw)])) continue;
    accents.set(k, { len: m[0].length, ch: (base + COMBINING[m[1]]).normalize('NFC') });
  }
  const ctx = { notes, headEnds, accents };
  // The language is guessed again on the clean text (accents composed,
  // markup gone); short paragraphs keep the guess made on the layer.
  const forced = lang === 'pt' || lang === 'en' ? lang : null;
  const langOf = (para, fallback) => forced || guessLang(para.text.split(DUMMY).join(' ')) || fallback;
  const out = [];
  for (const p of paras) {
    const para = plainOf(src, words, p.from, p.to, ctx);
    if (para) out.push({ ...para, lang: langOf(para, p.lang), variant, italic: italic.filter(([a, b]) => b > p.from && a < p.to) });
    for (const n of notes) {
      if (n.from < p.from || n.from >= p.to) continue;
      const fn = plainOf(src, words, n.inner, n.to - 1, { ...ctx, notes: notes.filter((x) => x !== n && x.from > n.from && x.to <= n.to) });
      if (fn) out.push({ ...fn, lang: langOf(fn, p.lang), variant, italic: italic.filter(([a, b]) => b > n.from && a < n.to) });
    }
  }
  return out;
}

function plainOf(src, words, from, to, { notes = [], headEnds = new Set(), accents = new Map() } = {}) {
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
  const dummy = (a, b) => {
    // Never glued to a word: "Dummy" + "Visitors" would read as one word.
    if (/[\p{L}\d]$/u.test(text)) put(' ', a, a);
    const at = text.length;
    put(DUMMY, a, b);
    dummies.push([at, text.length]);
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
    const acc = accents.get(i);
    if (acc && i + acc.len <= to) {
      put(acc.ch, i, i + acc.len);
      i += acc.len;
      continue;
    }
    const w = words[i];
    if (w !== ' ' && w !== '\n' && w !== '\t') {
      // Prose character (kept by the words layer).
      if (src.startsWith('---', i) && words.startsWith('---', i)) (put('—', i, i + 3), (i += 3));
      else if (src.startsWith('--', i) && words.startsWith('--', i)) (put('–', i, i + 2), (i += 2));
      else if (src.startsWith('``', i)) (put('“', i, i + 2), (i += 2));
      else if (src.startsWith("''", i)) (put('”', i, i + 2), (i += 2));
      else {
        if (dummies.length && dummies[dummies.length - 1][1] === text.length && /[\p{L}\d]/u.test(src[i])) put(' ', i, i);
        put(src[i], i, i + 1);
        i++;
      }
      continue;
    }
    // A blank stretch: real whitespace and/or blanked markup, up to the next
    // prose character, footnote, heading end or accent.
    let j = i;
    while (j < to && (words[j] === ' ' || words[j] === '\n' || words[j] === '\t') && !notes.some((n) => n.from === j) && !(headEnds.has(j) && j > i) && !(accents.has(j) && j > i)) j++;
    const orig = src.slice(i, j);
    const markup = orig.replace(INVISIBLE, ' ').trim();
    const lead = /^[{}]*[\s~]/.test(orig) || /^\\(?:footnote|par|item)\b/.test(markup);
    const trail = /[\s~][{}]*$/.test(orig);
    const bare = markup.match(/^\\([a-zA-Z@]+)\*?(?:\{\})?$/);
    if (!markup) {
      space(i, j);
    } else if (ESCAPED[markup]) {
      if (/^\s/.test(orig)) space(i, i + 1);
      put(ESCAPED[markup], i + orig.indexOf(markup), i + orig.indexOf(markup) + markup.length);
      if (/\s$/.test(orig)) space(j - 1, j);
    } else if (bare && PRINTS[bare[1]]) {
      if (lead) space(i, i + 1);
      const s0 = i + orig.indexOf(markup);
      put(PRINTS[bare[1]], s0, s0 + markup.length);
      if (trail) space(j - 1, j);
    } else if (bare && !SILENT.has(bare[1])) {
      // A macro of the user's that prints a word (\periodpre).
      if (lead) space(i, i + 1);
      const s0 = i + orig.indexOf(markup);
      dummy(s0, s0 + markup.length);
      if (trail) space(j - 1, j);
    } else {
      // A macro of the user's somewhere in the stretch ("} \IntensityLabel,"):
      // a command not followed by an argument, that is not silent.
      const bareCmds = [...markup.replace(/\[[^\]]*\]/g, '').matchAll(/\\([a-zA-Z@]+)\*?(?:\{\})?(?![a-zA-Z@]|\s*[{[])/g)];
      const prints = bareCmds.some((c) => !SILENT.has(c[1]));
      // Options in brackets inside markup are settings, never words.
      const meaningful = prints || (markup.replace(/\[[^\]]*\]/g, '').replace(NOISE, '').length > 0 && !/^\\(?:begin|end)\{[^}]*\}$/.test(markup));
      if (meaningful) {
        if (lead) space(i, i + 1);
        const s0 = i + orig.indexOf(markup);
        dummy(s0, s0 + markup.length);
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
// Punctuation right next to a placeholder counts as touching it.
export function mapMatch(para, offset, length) {
  const a = offset;
  const b = offset + Math.max(1, length);
  if (a < 0 || b > para.text.length) return null;
  const punct = /^[\s\p{P}]*$/u.test(para.text.slice(a, b));
  for (const [x, y] of para.dummies) if (punct ? a <= y && b >= x : a < y && b > x) return null;
  return { from: para.start[a], to: para.end[b - 1] };
}

// LanguageTool language code for our guess.
export const ltLang = (lang, variant = 'en-US') => (lang === 'pt' ? 'pt-BR' : variant === 'en-GB' ? 'en-GB' : 'en-US');
