// Pasting cells from Excel, Numbers, Google Sheets or a CSV turns them into
// a booktabs table. Pure functions first (shared with the tests), then the
// CodeMirror paste handler.

// Cells copied from a spreadsheet arrive as tab-separated lines. Returns
// rows, or null when the text does not look like a grid.
export function parseGrid(text, sep = '\t') {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2 && !lines[0].includes(sep)) return null;
  const rows = sep === ',' ? lines.map(splitCsv) : lines.map((l) => l.split(sep));
  const n = Math.max(...rows.map((r) => r.length));
  if (n < 2) return null;
  // Every line must have cells (spreadsheets pad short rows with tabs).
  if (rows.filter((r) => r.length === n).length < Math.ceil(rows.length * 0.8)) return null;
  return rows.map((r) => [...r, ...Array(n - r.length).fill('')].map((c) => c.trim()));
}

function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') out.push(cur), (cur = '');
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const NUM = /^[-−–+]?\(?[$€R£]*\s?[\d.,]+\)?%?\**$|^\[[-\d.,\s]+\]$|^$/;
export const escapeCell = (c) =>
  c
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/^[-−–](?=[\d.])/, '$-$')
    .replace(/(\d)(\*{1,3})$/, (m, d, s) => `${d}$^{${s}}$`);

// rowsOnly: the cursor is already inside a tabular, so only rows go in.
export function gridToLatex(rows, { rowsOnly = false, indent = '' } = {}) {
  const body = rows.map((r) => r.map(escapeCell).join(' & ') + ' \\\\');
  if (rowsOnly) return body.join('\n' + indent);
  const n = rows[0].length;
  // Numeric columns (ignoring the header row) are centred; text columns left.
  const cols = Array.from({ length: n }, (_, j) => (j > 0 && rows.slice(1).every((r) => NUM.test(r[j].replace(/\s/g, ''))) ? 'c' : 'l')).join('');
  const i2 = indent + '  ';
  const i4 = indent + '    ';
  return [
    `\\begin{table}[htbp]`,
    `${i2}\\centering`,
    `${i2}\\caption{}`,
    `${i2}\\label{tab:}`,
    `${i2}\\begin{tabular}{${cols}}`,
    `${i4}\\toprule`,
    `${i4}${body[0]}`,
    `${i4}\\midrule`,
    ...body.slice(1).map((b) => i4 + b),
    `${i4}\\bottomrule`,
    `${i2}\\end{tabular}`,
    `${indent}\\end{table}`,
  ].join('\n');
}

// True when pos sits inside an open tabular-like environment.
export function insideTabular(textBefore) {
  const re = /\\(begin|end)\{(tabular\*?|tabularx|longtable|threeparttable|tblr|array)\}/g;
  let depth = 0;
  let m;
  while ((m = re.exec(textBefore))) depth += m[1] === 'begin' ? 1 : -1;
  return depth > 0;
}

// Inserts a grid at the selection of a CodeMirror view. Returns false when
// the text is not a grid.
export function insertGrid(view, text, sep = '\t') {
  const rows = parseGrid(text, sep);
  if (!rows) return false;
  const sel = view.state.selection.main;
  const before = view.state.doc.sliceString(Math.max(0, sel.from - 20000), sel.from);
  const line = view.state.doc.lineAt(sel.from);
  const indent = (line.text.match(/^\s*/) || [''])[0];
  const rowsOnly = insideTabular(before);
  const after = view.state.doc.sliceString(sel.to, sel.to + 1);
  const insert = gridToLatex(rows, { rowsOnly, indent }) + (after && after !== '\n' ? '\n' + indent : '');
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.paste', scrollIntoView: true });
  return { rows: rows.length, cols: rows[0].length, rowsOnly: insideTabular(before), needsBooktabs: !insideTabular(before) && !/\\usepackage(\[[^\]]*\])?\{[^}]*booktabs/.test(view.state.doc.sliceString(0, 30000)) };
}
