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
  'We estimates the effect of $x$ on~$y$ in Section~\\ref{s:body}, as \\citet{card} shows.',
  "Results are \\emph{very} robust\\footnote{See the appendix.} and ``clean'' --- mostly. About 10\\% of firms.",
  '',
  '\\begin{equation}',
  'y = \\beta x',
  '\\end{equation}',
  '',
  'Os resultados mostra que a política teve efeito, como em \\cite{a}.',
  '% comment here',
  '\\end{document}',
].join('\n');

test('LaTeX becomes readable plain text, mapped back to the source', () => {
  const ps = grammarParagraphs(SRC, 'p.tex');
  assert.equal(ps.length, 3); // body, footnote, Portuguese paragraph (the equation alone is skipped)
  const [en, fn, pt] = ps;
  assert.equal(en.lang, 'en');
  assert.equal(pt.lang, 'pt');
  assert.ok(en.text.startsWith('Introduction\n\nWe estimates the effect of Dummy on Dummy in Section Dummy, as Dummy shows.'), en.text);
  assert.match(en.text, /very robust and “clean” — mostly\. About 10% of firms\.$/);
  assert.equal(fn.text, 'See the appendix.');
  for (const w of ['estimates', 'very', 'clean']) {
    const o = en.text.indexOf(w);
    const m = mapMatch(en, o, w.length);
    assert.equal(SRC.slice(m.from, m.to), w);
  }
  // A match on a placeholder is dropped.
  assert.equal(mapMatch(en, en.text.indexOf(DUMMY), DUMMY.length), null);
});

test('Portuguese verbal agreement: plural subject, singular verb', () => {
  const bad = {
    'Os resultados mostra que a política teve efeito.': 'mostram',
    'Os principais resultados obtidos indica queda.': 'indicam',
    'Os autores mostrou que não.': 'mostraram',
    'Estes dados também revela algo.': 'revelam',
    'Todos os coeficientes é positivo.': 'são',
    'Os pesquisadores concluiu.': 'concluíram',
    'As taxas diminui.': 'diminuem',
  };
  for (const [t, fix] of Object.entries(bad)) {
    const m = ptAgreement(t);
    assert.equal(m.length, 1, t);
    assert.equal(m[0].replacements[0], fix, t);
  }
  const good = [
    'Os resultados mostram que a política teve efeito.', 'Os resultados da tabela indicam queda.', 'Os efeitos de longo prazo são grandes.',
    'Os dados e as variáveis foram limpos.', 'Os dados desta pesquisa vêm do SIM.', 'Os resultados, porém, mostram queda.',
    'As políticas que reduz a pobreza.', 'Os resultados apresentados na Tabela 2.', 'Os gastos em saúde cresceram.', 'Os países ricos.',
  ];
  for (const t of good) assert.deepEqual(ptAgreement(t), [], t);
  assert.equal(pluralVerb('da'), null);
  // Not repeated where LanguageTool already flagged agreement.
  const para = { lang: 'pt', text: 'Os resultados mostra algo.' };
  assert.equal(localMatches(para, [{ offset: 0, length: 20, rule: 'GENERAL_VERB_AGREEMENT_ERRORS' }]).length, 0);
  assert.equal(localMatches(para, [{ offset: 14, length: 6, rule: 'EVIDENCIAR_COMPROVAR_DEMONSTRAR' }]).length, 1);
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
      { text: 'Os dados indica que houve queda. Nós fez a análise.', lang: 'pt-BR' },
    ]);
    assert.ok(en.some((m) => m.type === 'misspelling' && m.replacements.includes('receive')));
    assert.ok(en.some((m) => m.type !== 'misspelling'));
    assert.ok(pt.filter((m) => m.rule === 'GENERAL_VERB_AGREEMENT_ERRORS').length >= 2, JSON.stringify(pt.map((m) => m.rule)));
  } finally {
    g.stop();
  }
});
