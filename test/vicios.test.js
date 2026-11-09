// Writing-tic detector: what it flags, what it must leave alone (LaTeX that
// is not prose, technical uses), languages, offsets and speed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../web/src/vicios/core.js';

const ids = (r) => r.hits.map((h) => h.id);
const texts = (src, r, id) => r.hits.filter((h) => h.id === id).map((h) => src.slice(h.from, h.to));

test('English: vocabulary, em dash, parallelism, announcements, calques', () => {
  const src = String.raw`This paper delves into the intricate interplay of heat and crime --- a topic that plays a crucial role in policy, highlighting its importance. It is worth noting that the effect is large. Not only does heat raise crime, but it also lowers learning. The present study uses data since 2010 until 2020. In summary, heat is costly.`;
  const r = detect(src, { kind: 'tex' });
  assert.equal(r.stats.lang, 'en');
  for (const id of ['vocab-en', 'travessao', 'enfase-en', 'gerundio-en', 'anuncio-en', 'paralelismo-en', 'decalque-en', 'fecho-en']) assert.ok(ids(r).includes(id), `${id} missing: ${ids(r)}`);
  assert.deepEqual(texts(src, r, 'vocab-en'), ['delves', 'intricate', 'interplay']);
  // "crucial" inside "plays a crucial role" is reported once, as the phrase.
  assert.deepEqual(texts(src, r, 'enfase-en'), ['plays a crucial role']);
  assert.deepEqual(texts(src, r, 'gerundio-en'), ['highlighting']);
});

test('Portuguese: ênfase, gerúndio, anúncio, vírgula antes do e, Title Case', () => {
  const src = String.raw`\section{Os Efeitos Do Calor Sobre A Saúde}
Este trabalho desempenha um papel crucial no debate, evidenciando a relevância do tema. Vale ressaltar que os dados vêm do SIM, do SIH, e do SINASC. Além disso, o calor não apenas mata, mas também adoece. Os autores endereçam essa lacuna. Em suma, o calor custa caro.`;
  const r = detect(src, { kind: 'tex' });
  assert.equal(r.stats.lang, 'pt');
  for (const id of ['titulo', 'enfase-pt', 'gerundio-pt', 'anuncio-pt', 'virgula-e', 'conector-pt', 'paralelismo-pt', 'decalque-pt', 'fecho-pt']) assert.ok(ids(r).includes(id), `${id} missing: ${ids(r)}`);
  assert.deepEqual(texts(src, r, 'virgula-e'), [', e']);
  // English rules never fire on Portuguese text.
  assert.ok(!r.hits.some((h) => h.id.endsWith('-en')));
});

test('LaTeX that is not prose is ignored', () => {
  const src = String.raw`\documentclass{article}
\usepackage{delve}
\newcommand{\crucial}{x}
\begin{document}
\affiliation[a]{organization={Instituto de Pesquisa, Ensino e Desenvolvimento}, city={Brasília}}
We cluster robust standard errors by municipality \citep{delve2020,pivotal2019} and report them in Table~\ref{tab:tapestry}. % this delves --- into a comment
The estimate is $\beta = 0.3$ and $$x --- y$$ and \(a --- b\).
\begin{verbatim}
it delves --- into the tapestry
\end{verbatim}
\begin{equation} y = x \label{eq:crucial} \end{equation}
See \url{https://delve.example.com/a---b} and \href{https://x.org}{the data}.
\end{document}
Not only after the end, but also delve.`;
  const r = detect(src, { kind: 'tex' });
  assert.deepEqual(ids(r), [], JSON.stringify(r.hits.map((h) => src.slice(h.from, h.to))));
});

test('offsets point at the matched text in the source', () => {
  const src = 'Intro.\n\nThe model \\emph{showcases} a \\textbf{pivotal} shift---quietly.';
  const r = detect(src, { kind: 'tex' });
  assert.deepEqual(
    r.hits.map((h) => src.slice(h.from, h.to)),
    ['showcases', 'pivotal', '---', 'quietly'],
  );
});

test('each paragraph is checked in its own language', () => {
  const src = 'O calor desempenha um papel crucial na saúde dos idosos e das crianças.\n\nHeat plays a crucial role in the health of the elderly and of children.';
  const r = detect(src, { kind: 'tex' });
  assert.deepEqual(r.hits.map((h) => h.id), ['enfase-pt', 'enfase-en']);
});

test('density rules fire only above their rate', () => {
  const filler = 'The estimates are stable across samples and specifications in every table. '.repeat(40);
  const once = detect(filler + 'We use levels rather than logs.', { kind: 'txt' });
  assert.ok(!ids(once).includes('rather-en'));
  const many = detect('We use levels rather than logs. We cluster by state rather than city. We weight by births rather than deaths. ' + 'The estimates are stable. '.repeat(10), { kind: 'txt' });
  assert.equal(ids(many).filter((i) => i === 'rather-en').length, 3);
});

test('rhythm: long chained sentence, pseudo-cleft, repeated opener', () => {
  const long = 'Admissions fall by about a tenth on match days, so whoever still arrives at the hospital is a selected patient, and the table puts a number on how selected the cohort is, which dies more often in the following month; the gap survives the stepdown, and it is larger among the oldest patients who arrive by ambulance.';
  const r = detect(`${long} What the register establishes is a fall in supply. Hospitals reschedule elective care. Hospitals keep emergencies open.`, { kind: 'txt' });
  assert.ok(ids(r).includes('longa'));
  assert.ok(ids(r).includes('clivada'));
  assert.ok(ids(r).includes('mesma'));
  // A paper's roadmap is not a repeated opener.
  const road = detect('Section 2 describes the data. Section 3 presents the design. Section 4 reports the results.', { kind: 'txt' });
  assert.ok(!ids(road).includes('mesma'));
});

test('Markdown: code is not prose; Markdown in LaTeX is flagged', () => {
  const md = '# Notes\n\nPlain text here.\n\n```\nwe delve --- into code\n```\n\nInline `delve` code.';
  assert.deepEqual(ids(detect(md, { kind: 'md' })), []);
  const tex = 'Results.\n\n**Key finding:** heat kills.\n';
  assert.ok(ids(detect(tex, { kind: 'tex' })).includes('markdown'));
});

test('fast enough to run while typing on a long paper', () => {
  const para = 'Heat raises mortality among the elderly, and the effect is concentrated in the hottest days of the summer, which we document with daily data. ';
  const src = (para.repeat(20) + '\n\n').repeat(40); // ~20k words
  const t0 = performance.now();
  detect(src, { kind: 'tex' });
  const ms = performance.now() - t0;
  assert.ok(ms < 400, `took ${ms.toFixed(0)} ms`);
});
