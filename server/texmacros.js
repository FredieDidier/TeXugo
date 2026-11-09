// Macro definitions in LaTeX source, for the equation preview (KaTeX).
// Pure and dependency-free: used by the server (project scan) and the web
// UI (tests and the current file).

// Comments blanked out (same length), so positions stay valid.
export function blankComments(s) {
  return s.replace(/(^|[^\\])(%.*)$/gm, (m, a, c) => a + ' '.repeat(c.length));
}

// \newcommand, \renewcommand, \providecommand, \def and
// \DeclareMathOperator from LaTeX source, as KaTeX macros. Pure (tested).
export function macrosFrom(src) {
  const out = {};
  const s = blankComments(src);
  const arg = (i) => {
    // Balanced {...} starting at i (after spaces); returns [content, end].
    while (/\s/.test(s[i])) i++;
    if (s[i] !== '{') return [null, i];
    let d = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '\\') {
        j++;
        continue;
      }
      if (s[j] === '{') d++;
      else if (s[j] === '}' && --d === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [null, s.length];
  };
  const re = /\\(?:(re|provide)?newcommand\*?|DeclareMathOperator(\*?)|def)\s*(\{\s*\\[a-zA-Z]+\s*\}|\\[a-zA-Z]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[3].replace(/[{}\s]/g, '');
    let i = m.index + m[0].length;
    if (m[0].startsWith('\\DeclareMathOperator')) {
      const [body] = arg(i);
      if (body != null) out[name] = m[2] ? `\\operatorname*{${body}}` : `\\operatorname{${body}}`;
      continue;
    }
    if (m[0].startsWith('\\def')) {
      // \def\x#1#2{...}: KaTeX takes the same body.
      const params = /^(#\d)*/.exec(s.slice(i))[0];
      const [body] = arg(i + params.length);
      if (body != null) out[name] = body;
      continue;
    }
    let n = /^\s*\[(\d)\]/.exec(s.slice(i));
    if (n) i += n[0].length;
    // An optional default for #1 is not supported by KaTeX macros; skip it.
    const opt = /^\s*\[[^\]]*\]/.exec(s.slice(i));
    if (opt) i += opt[0].length;
    const [body] = arg(i);
    if (body != null && !(m[1] === 'provide' && out[name])) out[name] = body;
  }
  return out;
}

