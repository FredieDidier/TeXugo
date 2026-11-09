import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGrid, gridToLatex, insideTabular, escapeCell } from '../web/src/table.js';

test('spreadsheet grid becomes a booktabs table', () => {
  const rows = parseGrid('Variable\tMean\tSD\nIncome (R$)\t1,234.5\t-0.12***\nAge_years\t35\t(2.1)\n');
  assert.equal(rows.length, 3);
  const t = gridToLatex(rows);
  assert.match(t, /\\begin\{tabular\}\{lcc\}/);
  assert.match(t, /\\toprule\n\s+Variable & Mean & SD \\\\\n\s+\\midrule/);
  assert.match(t, /Income \(R\\\$\) & 1,234\.5 & \$-\$0\.12\$\^\{\*\*\*\}\$ \\\\/);
  assert.match(t, /Age\\_years & 35 & \(2\.1\) \\\\/);
});

test('plain text is not a grid; CSV with quotes is', () => {
  assert.equal(parseGrid('just a sentence'), null);
  assert.equal(parseGrid('one line\nanother line'), null);
  assert.deepEqual(parseGrid('a,"b, c"\n1,2', ','), [['a', 'b, c'], ['1', '2']]);
});

test('inside a tabular only rows go in', () => {
  assert.equal(insideTabular('\\begin{tabular}{ll}\n\\toprule\n'), true);
  assert.equal(insideTabular('\\begin{tabular}{ll}\\end{tabular}\n'), false);
  assert.equal(gridToLatex([['a', 'b'], ['1', '2']], { rowsOnly: true }), 'a & b \\\\\n1 & 2 \\\\');
  assert.equal(escapeCell('50% & #1'), '50\\% \\& \\#1');
});
