// SyncTeX without the map: for a PDF built outside TeXugo with no
// .synctex.gz, find the source line from the words around the click (and
// the PDF spot from the words of a source line). Approximate, but needs no
// build.
import { readText } from './util.js';
import { includeClosure } from './project.js';

// Words of a LaTeX line as they would print: commands and comments dropped,
// arguments of text commands kept.
export function plainWords(line) {
  return String(line)
    .replace(/(^|[^\\])%.*$/, '$1')
    .replace(/\\(?:cite[a-z]*|ref|cref|Cref|eqref|label|input|include|includegraphics|bibliography\w*|usepackage|documentclass|begin|end)\*?(?:\[[^\]]*\])*\{[^}]*\}/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/[{}\\~]/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);
}

// The clicked PDF line's words -> the best file and line of the document.
export function findInSource(doc, text) {
  const want = plainWords(text);
  if (want.length < 3) return { ok: false };
  const files = [...includeClosure(doc)].filter((f) => /\.(tex|ltx)$/i.test(f));
  let best = null;
  for (const f of files) {
    const lines = (readText(f) || '').split('\n');
    // Flatten the file into one word stream with each word's line.
    const words = [];
    const lineOf = [];
    lines.forEach((l, i) => {
      for (const w of plainWords(l)) {
        words.push(w);
        lineOf.push(i + 1);
      }
    });
    // Longest run of the wanted words found in order, starting anywhere.
    for (let k = Math.min(8, want.length); k >= 3; k--) {
      for (let s = 0; s + k <= want.length; s++) {
        const needle = want.slice(s, s + k).join(' ');
        const hay = ' ' + words.join(' ') + ' ';
        const at = hay.indexOf(' ' + needle + ' ');
        if (at < 0) continue;
        const idx = hay.slice(0, at + 1).split(' ').filter(Boolean).length;
        const score = k + (f === doc ? 0.1 : 0);
        if (!best || score > best.score) best = { score, file: f, line: lineOf[idx] || 1 };
        break;
      }
      if (best && best.score >= k) break;
    }
  }
  return best ? { ok: true, file: best.file, line: best.line, approx: true } : { ok: false };
}

export function sourceLineWords(file, line) {
  const lines = (readText(file) || '').split('\n');
  // The line itself, or the nearest non-empty text line after it.
  for (let i = line - 1; i < Math.min(lines.length, line + 5); i++) {
    const w = plainWords(lines[i] || '');
    if (w.length >= 3) return w;
  }
  return plainWords(lines[line - 1] || '');
}
