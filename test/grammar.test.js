// Grammar checker: LaTeX -> plain text with a map back to the source, the
// filters that drop what is not the user's mistake, the Portuguese
// verbal-agreement rule of TeXugo, and (when LanguageTool is installed) two
// fixture documents checked for real: a clean one full of LaTeX traps must
// give zero flags, one with planted mistakes must give exactly those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grammarParagraphs, mapMatch, DUMMY } from '../web/src/grammar/text.js';
import { ptAgreement, pluralVerb, localMatches } from '../web/src/grammar/local.js';
import { Grammar, offRules } from '../server/grammar.js';
import { which } from '../server/util.js';
import { hitsFor, isCode, dropped } from '../web/src/grammar/hits.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

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

test('LaTeX traps never reach the checker as words', () => {
  const src = [
    '\\begin{document}',
    '\\author[uni]{Ana Silva}',
    '\\addcontentsline{toc}{section}{Introduction}',
    '\\begin{figure}[tbp]\\centering',
    '\\includegraphics[width=0.8\\textwidth]{figures/a.pdf}',
    '\\caption{Visitors per day.}',
    '\\end{figure}',
    '',
    '\\begin{itemize}[leftmargin=*]',
    '\\item The garden of S\\~ao Paulo, the Funda\\c{c}\\~ao das Flores and the Instituto de Estat\\\'{\\i}stica open early\\ldots\\\\[4pt]',
    '\\end{itemize}',
    '',
    'In the \\springperiod{} the counts in \\satab{tab:visits_by_month} rise; see \\href{https://example.org}{the garden.data package}.',
    '\\end{document}',
  ].join('\n');
  const all = grammarParagraphs(src, 'a.tex').map((p) => p.text).join(' | ');
  const words = new Set(all.match(/[\p{L}\d_]+/gu));
  for (const junk of ['tbp', 'leftmargin', 'uni', 'toc', 'width', 'textwidth', 'tab', 'visits_by_month', 'https', '4pt', 'oes', 'stica']) {
    assert.ok(!words.has(junk), `${junk} leaked: ${all}`);
  }
  assert.match(all, /São Paulo, the Fundação das Flores and the Instituto de Estatística open early…/);
  assert.match(all, /In the Dummy the counts in Dummy rise; see the garden\.data package\./);
  assert.match(all, /Ana Silva/);
  assert.match(all, /Visitors per day\./);
});

test('acronyms, codes, names, foreign words and panel letters are not mistakes', () => {
  for (const w of ['DNIT', 'IPCA', 'BR-DWGD', 'CO2', 'PM2.5', 'var_name', 'data.table']) assert.ok(isCode(w), w);
  for (const w of ['Garden', 'tbp', 'house']) assert.ok(!isCode(w), w);
  const para = (text) => ({ text, lang: 'en', dummies: [], start: [...text].map((_, i) => i), end: [...text].map((_, i) => i + 1), italic: [] });
  const spell = (text, word) => ({ type: 'misspelling', offset: text.indexOf(word), length: word.length, rule: 'MORFOLOGIK_RULE_EN_US', message: 'Possible spelling mistake found.' });
  const t1 = 'Prices from the IPCA and the BR-DWGD grid, collected by Mariana in Itabuna.';
  for (const w of ['IPCA', 'BR-DWGD', 'Mariana', 'Itabuna']) assert.ok(dropped(spell(t1, w), w, para(t1)), w);
  const t2 = 'The Sistema de Informações sobre Jardins counts visitors.';
  assert.ok(dropped(spell(t2, 'sobre'), 'sobre', para(t2)));
  const t3 = 'In Panel A the morning hours are shown.';
  assert.ok(dropped({ type: 'grammar', rule: 'DT_DT', offset: 9, length: 5, message: 'Two determiners in a row.' }, 'A the', para(t3)));
  const t4 = 'The research is nice and teh garden too.';
  assert.ok(!dropped(spell(t4, 'teh'), 'teh', para(t4)), 'a real typo stays');
  // Messages about our placeholder are not about the user's text.
  assert.ok(dropped({ type: 'grammar', rule: 'X', offset: 0, length: 3, message: '“Dummy” is a singular noun.' }, 'are', para('are')));
});

test('Portuguese agreement: a plural after a preposition is not the subject', () => {
  assert.deepEqual(ptAgreement('O debate sobre os livros permanece aberto.'), []);
  assert.equal(ptAgreement('A carta que os vizinhos escreve.')[0].replacements[0], 'escrevem');
  assert.equal(ptAgreement('Como os gatos dorme muito, compramos almofadas.')[0].replacements[0], 'dormem');
});

test('fixture documents, checked by LanguageTool in strict mode', { timeout: 180000 }, async (t) => {
  const g = new Grammar();
  if (!(await g.status()).installed) return t.skip('LanguageTool não instalado');
  const flags = async (file) => {
    const src = fs.readFileSync(path.join(FIX, file), 'utf8');
    const paras = grammarParagraphs(src, file);
    const res = await g.check(paras.map((p) => ({ text: p.text, lang: p.lang === 'pt' ? 'pt-BR' : p.variant })), { level: 'picky' });
    const byPara = new Map(paras.map((p, i) => [p, res[i]]));
    return hitsFor(paras, (p) => byPara.get(p)).map((h) => src.slice(h.from, h.to));
  };
  try {
    assert.deepEqual(await flags('grammar-clean.tex'), [], 'a clean document full of LaTeX traps gives no flags');
    const got = await flags('grammar-errors.tex');
    for (const want of ['walk', 'recieve', 'is', 'brinca', 'dorme', 'fez', 'doce', 'vamos']) {
      assert.ok(got.some((g) => g.includes(want)), `missed "${want}": ${JSON.stringify(got)}`);
    }
    assert.ok(got.some((g) => /This|are/.test(g)), 'This are');
    assert.ok(!got.some((g) => /Sundays|shows|Table|Results|Resultados/.test(g)), `false flag: ${JSON.stringify(got)}`);
  } finally {
    g.stop();
  }
});
