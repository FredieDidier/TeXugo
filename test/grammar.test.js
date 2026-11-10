// Grammar checker: LaTeX -> plain text with a map back to the source, the
// Portuguese verbal-agreement rule of TeXugo, and (when LanguageTool is
// installed) one real check end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grammarParagraphs, mapMatch, DUMMY } from '../web/src/grammar/text.js';
import { ptAgreement, pluralVerb, localMatches } from '../web/src/grammar/local.js';
import { Grammar, offRules } from '../server/grammar.js';
import { which } from '../server/util.js';

const SRC = [
  '\\documentclass{article}',
  '\\usepackage{amsmath}',
  '\\begin{document}',
  '\\section{Introduction}\\label{s:intro}',
  'She walk to the park with $n$ dogs every~$t$ days, as Section~\\ref{s:body} and \\citet{smith} explain.',
  "The garden is \\emph{very} green\\footnote{See the photos.} and ``quiet'' --- mostly. About 10\\% of the roses bloom.",
  '',
  '\\begin{equation}',
  'a^2 + b^2 = c^2',
  '\\end{equation}',
  '',
  'As crianças brinca no quintal depois da escola, como em \\cite{b}.',
  '% comment here',
  '\\end{document}',
].join('\n');

test('LaTeX becomes readable plain text, mapped back to the source', () => {
  const ps = grammarParagraphs(SRC, 'p.tex');
  assert.equal(ps.length, 3); // body, footnote, Portuguese paragraph (the equation alone is skipped)
  const [en, fn, pt] = ps;
  assert.equal(en.lang, 'en');
  assert.equal(pt.lang, 'pt');
  assert.ok(en.text.startsWith('Introduction\n\nShe walk to the park with Dummy dogs every Dummy days, as Section Dummy and Dummy explain.'), en.text);
  assert.match(en.text, /very green and “quiet” — mostly\. About 10% of the roses bloom\.$/);
  assert.equal(fn.text, 'See the photos.');
  for (const w of ['walk', 'very', 'quiet']) {
    const o = en.text.indexOf(w);
    const m = mapMatch(en, o, w.length);
    assert.equal(SRC.slice(m.from, m.to), w);
  }
  // A match on a placeholder is dropped.
  assert.equal(mapMatch(en, en.text.indexOf(DUMMY), DUMMY.length), null);
});

test('Portuguese verbal agreement: plural subject, singular verb', () => {
  const bad = {
    'As crianças brinca no quintal.': 'brincam',
    'As meninas toca violão.': 'tocam',
    'Os novos vizinhos simpáticos reclama do barulho.': 'reclamam',
    'Os turistas chegou cedo.': 'chegaram',
    'Estes gatos também dorme no sofá.': 'dormem',
    'Todos os pães é de ontem.': 'são',
    'Os cachorros fugiu.': 'fugiram',
    'As folhas caiu.': 'caíram',
    'As lojas inclui o sábado.': 'incluem',
  };
  for (const [t, fix] of Object.entries(bad)) {
    const m = ptAgreement(t);
    assert.equal(m.length, 1, t);
    assert.equal(m[0].replacements[0], fix, t);
  }
  const good = [
    'As crianças brincam no quintal.', 'Os livros da estante ficaram velhos.', 'Os dias de chuva são longos.',
    'Os copos e as xícaras foram lavados.', 'Os doces desta padaria vêm de longe.', 'As crianças, porém, brincam à tarde.',
    'As árvores que dá frutos.', 'Os barcos ancorados na baía.', 'Os preços em dezembro subiram.', 'Os jardins floridos.',
  ];
  for (const t of good) assert.deepEqual(ptAgreement(t), [], t);
  assert.equal(pluralVerb('da'), null);
  // Not repeated where LanguageTool already flagged agreement.
  const para = { lang: 'pt', text: 'As meninas toca violão.' };
  assert.equal(localMatches(para, [{ offset: 0, length: 16, rule: 'GENERAL_VERB_AGREEMENT_ERRORS' }]).length, 0);
  assert.equal(localMatches(para, [{ offset: 12, length: 4, rule: 'SOME_STYLE_RULE' }]).length, 1);
});

test('LanguageTool, strict mode, end to end', { timeout: 120000 }, async (t) => {
  const g = new Grammar();
  if (!(await g.status()).installed) return t.skip('LanguageTool não instalado');
  try {
    const off = offRules(await which('languagetool-server') || '/opt/homebrew/opt/languagetool/bin/languagetool-server', 'pt');
    assert.ok(off.length > 10, 'switched-off Portuguese rules found');
    assert.ok(!off.some((id) => /E_PRIME|PASSIVE/.test(id)));
    const [en, pt] = await g.check([
      { text: 'This are a test with recieve.', lang: 'en-US' },
      { text: 'Os gatos dorme no sofá. Nós fez um bolo.', lang: 'pt-BR' },
    ]);
    assert.ok(en.some((m) => m.type === 'misspelling' && m.replacements.includes('receive')));
    assert.ok(en.some((m) => m.type !== 'misspelling'));
    assert.ok(pt.filter((m) => m.rule === 'GENERAL_VERB_AGREEMENT_ERRORS').length >= 2, JSON.stringify(pt.map((m) => m.rule)));
  } finally {
    g.stop();
  }
});
