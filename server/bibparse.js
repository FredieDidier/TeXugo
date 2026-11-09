// A small BibTeX reader: entries with their fields, brace- and quote-aware,
// so a field that spans lines (author = {A and\n B}) never runs into the next
// entry. Used for completion and the citation card.

// LaTeX accents and escapes to Unicode, for display only.
const ACCENTS = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊' };
const LETTERS = { ss: 'ß', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', i: 'ı', j: 'ȷ' };
export function texToText(s) {
  return String(s || '')
    .replace(/\\([a-zA-Z]{1,2})\{\}/g, (m, l) => LETTERS[l] || m)
    .replace(/\\(['`^"~=.]|[uvHckr](?=[\s{]))\s*\{?\\?([a-zA-Z])\}?/g, (m, a, ch) => (ACCENTS[a] ? (ch === 'i' ? 'i' : ch) + ACCENTS[a] : m).normalize('NFC'))
    .replace(/\{\\(ss|o|O|l|L|ae|AE|oe|OE|aa|AA)\}|\\(ss|o|O|l|L|ae|AE|oe|OE|aa|AA)\b\s?/g, (m, a, b) => LETTERS[a || b] || m)
    .replace(/\\&/g, '&')
    .replace(/\\([%$#_])/g, '$1')
    .replace(/~/g, ' ')
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/\\(?:emph|textit|textbf|textsc|mbox)\s*/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Reads a balanced {...} or "..." value starting at i; returns [value, end].
function readValue(text, i) {
  if (text[i] === '{') {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      if (text[j] === '\\') {
        j++;
        continue;
      }
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) return [text.slice(i + 1, j), j + 1];
    }
    return [text.slice(i + 1), text.length];
  }
  if (text[i] === '"') {
    let depth = 0;
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') {
        j++;
        continue;
      }
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      else if (text[j] === '"' && depth === 0) return [text.slice(i + 1, j), j + 1];
    }
    return [text.slice(i + 1), text.length];
  }
  const m = /^[^,}\s#]+/.exec(text.slice(i));
  return [m ? m[0] : '', i + (m ? m[0].length : 0)];
}

export function parseBib(text) {
  const entries = [];
  const strings = {};
  const re = /@\s*(\w+)\s*([{(])/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'preamble') continue;
    let i = m.index + m[0].length;
    const close = m[2] === '{' ? '}' : ')';
    const skipWs = () => {
      while (i < text.length && /\s/.test(text[i])) i++;
    };
    let key = null;
    if (type !== 'string') {
      const k = /^\s*([^,\s{}()]+)\s*,/.exec(text.slice(i));
      if (!k) continue;
      key = k[1];
      i += k[0].length;
    }
    const fields = {};
    while (i < text.length) {
      skipWs();
      if (text[i] === close) {
        i++;
        break;
      }
      if (text[i] === '@') break; // unterminated entry: stop at the next one
      const f = /^([\w:.+-]+)\s*=\s*/.exec(text.slice(i));
      if (!f) {
        i++;
        continue;
      }
      i += f[0].length;
      // value # value # ...
      let value = '';
      for (;;) {
        skipWs();
        const [v, end] = readValue(text, i);
        const bare = text[i] !== '{' && text[i] !== '"';
        value += bare ? (strings[v.toLowerCase()] ?? v) : v;
        i = end;
        skipWs();
        if (text[i] === '#') {
          i++;
          continue;
        }
        break;
      }
      fields[f[1].toLowerCase()] = value;
      skipWs();
      if (text[i] === ',') i++;
    }
    re.lastIndex = i;
    if (type === 'string') Object.assign(strings, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v])));
    else entries.push({ key, type, fields, line: text.slice(0, m.index).split('\n').length });
  }
  return entries;
}

// What completion and the citation card show.
export function bibSummary(e, file) {
  const f = e.fields;
  const doi = (f.doi || '').replace(/^\s*(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '').trim();
  return {
    key: e.key,
    type: e.type,
    title: f.title ? texToText(f.title) : undefined,
    author: f.author ? texToText(f.author) : f.editor ? texToText(f.editor) : undefined,
    year: (f.year || f.date || '').match(/\d{4}/)?.[0],
    venue: texToText(f.journal || f.journaltitle || f.booktitle || f.institution || f.school || f.publisher || '') || undefined,
    doi: doi || undefined,
    url: f.url ? f.url.trim() : undefined,
    eprint: f.eprint ? f.eprint.trim() : undefined,
    file,
    line: e.line,
  };
}
