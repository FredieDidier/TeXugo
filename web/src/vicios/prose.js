// Prose layers of a source file. Each layer is a string of the same length
// as the source, with non-prose characters replaced by spaces (newlines are
// kept), so a match at offset i in a layer is at offset i in the file.
//
//   punct: comments, preamble, math, verbatim-like environments and the
//          arguments of non-prose commands blanked; command names kept, so
//          \textemdash and --- can still be seen.
//   words: punct with every remaining command name, brace and tilde blanked:
//          what a reader sees as running text.

const blank = (s) => s.replace(/[^\n]/g, ' ');

// Environments whose body is not prose.
const SKIP_ENVS = [
  'verbatim', 'Verbatim', 'lstlisting', 'minted', 'comment', 'tikzpicture', 'pgfpicture',
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
  'eqnarray', 'eqnarray*', 'displaymath', 'math', 'flalign', 'flalign*', 'split',
  'tabular', 'tabular*', 'tabularx', 'longtable', 'tabu', 'array', 'thebibliography', 'filecontents', 'filecontents*',
];

// Commands whose arguments are keys, paths or code, not prose.
const SKIP_ARGS = new Set([
  'label', 'ref', 'eqref', 'cref', 'Cref', 'autoref', 'pageref', 'nameref', 'vref', 'labelcref',
  'cite', 'citet', 'citep', 'citealt', 'citealp', 'citeauthor', 'citeyear', 'citeyearpar', 'parencite', 'textcite', 'autocite', 'footcite', 'nocite', 'Citet', 'Citep',
  'input', 'include', 'includegraphics', 'includepdf', 'usepackage', 'RequirePackage', 'documentclass', 'begin', 'end',
  'url', 'href', 'hyperref', 'bibliography', 'bibliographystyle', 'addbibresource', 'externaldocument', 'graphicspath',
  'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment', 'DeclareMathOperator', 'def', 'let',
  'setlength', 'addtolength', 'setcounter', 'addtocounter', 'vspace', 'hspace', 'color', 'textcolor', 'colorbox', 'definecolor',
  'pagestyle', 'thispagestyle', 'pagenumbering', 'numberwithin', 'hypersetup', 'geometry', 'todo', 'texttt', 'verb', 'path',
  'affiliation', 'address', 'ead', 'email', 'orcid', 'keywords', 'JEL', 'jel', 'date', 'pdfbookmark',
  'multicolumn', 'multirow', 'resizebox', 'scalebox', 'rule', 'cline', 'cmidrule', 'arraystretch', 'renewrobustcmd', 'linespread',
]);

// Index just past a balanced {...} or [...] group starting at i, or i.
function group(s, i, open, close) {
  if (s[i] !== open) return i;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j + 1;
  }
  return s.length;
}
const skipSpace = (s, i) => {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  return i;
};

function maskRange(arr, from, to) {
  for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
}

export function texLayers(src) {
  const a = src.split('');
  // Preamble: everything before \begin{document}, when the file has one.
  const bd = src.indexOf('\\begin{document}');
  if (bd >= 0) maskRange(a, 0, bd + '\\begin{document}'.length);
  const ed = src.indexOf('\\end{document}');
  if (ed >= 0) maskRange(a, ed, src.length);
  // Comments: % not escaped, to the end of the line.
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '%') continue;
    let bs = 0;
    for (let j = i - 1; j >= 0 && src[j] === '\\'; j--) bs++;
    if (bs % 2) continue;
    const eol = src.indexOf('\n', i);
    maskRange(a, i, eol < 0 ? src.length : eol);
    i = eol < 0 ? src.length : eol;
  }
  let s = a.join('');
  // Non-prose environments.
  for (const env of SKIP_ENVS) {
    const open = `\\begin{${env}}`;
    const close = `\\end{${env}}`;
    let i = 0;
    while ((i = s.indexOf(open, i)) >= 0) {
      const j = s.indexOf(close, i);
      const end = j < 0 ? s.length : j + close.length;
      maskRange(a, i, end);
      i = end;
    }
    s = a.join('');
  }
  // Math: $$..$$, $..$, \[..\], \(..\).
  const mathRe = /\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;
  for (const m of s.matchAll(mathRe)) maskRange(a, m.index, m.index + m[0].length);
  s = a.join('');
  // Arguments of non-prose commands (and the command itself).
  const cmdRe = /\\([a-zA-Z@]+)\*?/g;
  let m;
  while ((m = cmdRe.exec(s))) {
    if (!SKIP_ARGS.has(m[1])) continue;
    let k = m.index + m[0].length;
    // Optional and mandatory arguments; \href keeps its second (text) arg.
    let groups = m[1] === 'href' ? 1 : m[1] === 'multicolumn' || m[1] === 'multirow' ? 2 : 9;
    for (;;) {
      const k2 = skipSpace(s, k);
      if (s[k2] === '[') k = group(s, k2, '[', ']');
      else if (s[k2] === '{' && groups > 0) {
        k = group(s, k2, '{', '}');
        groups--;
        if (m[1] === 'begin' || m[1] === 'end' || m[1] === 'label' || /^(ref|cite|url|input|include)/.test(m[1])) break;
      } else break;
    }
    maskRange(a, m.index, k);
    cmdRe.lastIndex = k;
  }
  // Key=value groups ({organization={...}, city=...}) are settings, not prose.
  s = a.join('');
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    if (!/^\{\s*[a-zA-Z]+\s*=/.test(s.slice(i, i + 40))) continue;
    const j = group(s, i, '{', '}');
    maskRange(a, i, j);
    i = j - 1;
  }
  const punct = a.join('');
  // Words layer: drop remaining command names, braces, ties.
  const w = punct.split('');
  for (const c of punct.matchAll(/\\(?:[a-zA-Z@]+\*?|.)/g)) {
    // Keep accents written as commands from glueing words: \'e stays blank.
    maskRange(w, c.index, c.index + c[0].length);
  }
  for (let i = 0; i < w.length; i++) if (w[i] === '{' || w[i] === '}' || w[i] === '~' || w[i] === '&') w[i] = ' ';
  return { punct, words: w.join('') };
}

export function mdLayers(src) {
  const a = src.split('');
  for (const m of src.matchAll(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm)) maskRange(a, m.index, m.index + m[0].length);
  let s = a.join('');
  for (const m of s.matchAll(/`[^`\n]*`|<!--[\s\S]*?-->|\]\([^)]*\)|https?:\/\/\S+|\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+\$/g)) maskRange(a, m.index, m.index + m[0].length);
  s = a.join('');
  return { punct: s, words: s.replace(/[*_#>|]/g, ' ') };
}

export function layersFor(src, kind) {
  if (kind === 'tex') return texLayers(src);
  if (kind === 'md') return mdLayers(src);
  return { punct: src, words: src };
}

export { blank };
