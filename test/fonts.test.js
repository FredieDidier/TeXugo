import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePdffonts } from '../server/submission.js';

test('pdffonts: Type 3 and non-embedded fonts', () => {
  const out = `name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
AWOQJZ+CMR10                         Type 1            Builtin          yes yes yes      4  0
[none]                               Type 3            Custom           yes no  no      12  0
ArialMT                              TrueType          WinAnsi          no  no  no      20  0
ABCDEF+SFRM1000                      Type 3            Custom           yes yes no      30  0
`;
  assert.deepEqual(parsePdffonts(out), { type3: ['[none]', 'SFRM1000'], unembedded: ['ArialMT'] });
});
