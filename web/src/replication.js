// "Pacote de replicação": the checklist a journal's Data Editor will run,
// before they run it. One list, on the Data and Code Availability Standard
// (DCAS) that AEA, Econometric Society, ReStud, EJ, JEEA, JPE and others
// follow; the journal picked changes where the package goes, when, and a few
// details (README in PDF, open copies of .dta files). What the folder can
// show is checked by the server (server/replication.js); what only the
// authors know is a box they tick. Lives in the "Replicação" tab of the
// bottom panel; the Revisão view shows how many items are pending.
import { call } from './api.js';
import { h, clear, icon, toast, modal, basename } from './dom.js';
import { getLang } from './i18n.js';
import { JOURNALS, journalById, DCAS_URL, README_URL } from '../../server/replication-journals.js';

const L = (pt, en) => (getLang() === 'en' ? en : pt);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const size = (b) => (b < 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024))} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(1)} GB`);
const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

// What only the authors know, with the DCAS rule each one answers.
const MANUAL = [
  ['rights', 'DCAS 1–2', () => L('Vocês têm permissão para usar os dados e, para os que vão no pacote, para redistribuí-los', 'You have permission to use the data and, for the data in the package, to redistribute it')],
  ['access', 'DCAS 1, 16', () => L('Dados que não podem ir no pacote: o README diz como obtê-los (onde, custo, cadastro) e vocês guardam uma cópia', 'Data that cannot go in the package: the README says how to get it (where, cost, registration) and you keep a copy')],
  ['cleanrun', 'README', () => L('Rodou do zero numa pasta limpa ou em outro computador, e as saídas bateram com o paper', 'Ran from scratch in a clean folder or on another computer, and the outputs matched the paper')],
  ['numbers', 'README', () => L('Os números citados no texto saem do código, não foram digitados à mão', 'Numbers quoted in the text come from the code, not typed by hand')],
  ['runtime', 'DCAS 13', () => L('Tempo de execução medido e escrito no README, com a máquina usada', 'Run time measured and written in the README, with the machine used')],
  ['codebook', 'DCAS 5', () => L('Descrição das variáveis (codebook) para os dados do pacote', 'Variable descriptions (codebook) for the data in the package')],
  ['instruments', 'DCAS 10', () => L('Pesquisa ou experimento próprios: questionário, instruções e seleção dos participantes no pacote', 'Own survey or experiment: questionnaire, instructions and subject selection in the package')],
  ['ethics', 'DCAS 11', () => L('Aprovação do comitê de ética citada', 'Ethics approval cited')],
  ['prereg', 'DCAS 12', () => L('Pré-registro citado', 'Pre-registration cited')],
];

const SECTION_NAMES = {
  availability: () => L('disponibilidade e origem dos dados', 'data availability and provenance'),
  requirements: () => L('requisitos computacionais', 'computational requirements'),
  runtime: () => L('tempo de execução', 'run time'),
  instructions: () => L('instruções para quem vai replicar', 'instructions to replicators'),
  exhibits: () => L('lista de tabelas e figuras com o programa de cada uma', 'list of tables and figures with their programs'),
  references: () => L('referências com a citação dos dados', 'references citing the data'),
};

// The automatic checks, from the scan. status: ok | warn | info.
function autoItems(d, j, hasDoc) {
  const out = [];
  const add = (group, status, rule, title, detail, locs = [], action = null) => out.push({ group, status, rule, title, detail, locs, action });
  const doc = L('Documentação', 'Documentation');
  const code = L('Código', 'Code');
  const data = L('Dados', 'Data');
  const exh = L('Tabelas e figuras do paper', 'Tables and figures of the paper');

  // README
  const r = d.readme;
  if (!r) add(doc, 'warn', 'DCAS 13', L('README na raiz do pacote', 'README at the package root'), L('Não há README. O rascunho do TeXugo já vem no modelo dos Data Editors, preenchido com o que dá para ler da pasta.', 'There is no README. TeXugo’s draft follows the Data Editors’ template, filled in with what the folder shows.'), [], 'readme');
  else {
    const pdfMissing = j.readmePdf && !r.pdf;
    const parts = [`${r.all.join(', ')} · ${plural(r.words, L('palavra', 'word'), L('palavras', 'words'))}`];
    if (r.todos) parts.push(L(`Ainda tem ${r.todos} TODO por preencher`, `It still has ${r.todos} TODO${r.todos > 1 ? 's' : ''} to fill in`));
    if (pdfMissing) parts.push(L('Esta revista pede o README em PDF', 'This journal asks for the README as a PDF'));
    add(doc, pdfMissing || r.todos ? 'warn' : 'ok', 'DCAS 13', L('README na raiz do pacote', 'README at the package root'), parts.join('. ') + (parts.length > 1 ? '.' : ''), [{ rel: r.rel, abs: `${d.root}/${r.rel}` }]);
    const missing = Object.keys(SECTION_NAMES).filter((k) => !r.sections[k]);
    add(
      doc,
      missing.length ? 'warn' : 'ok',
      'README',
      L('Seções do modelo dos Data Editors', 'Sections of the Data Editors’ template'),
      missing.length ? L('Não achei: ', 'Not found: ') + missing.map((k) => SECTION_NAMES[k]()).join('; ') + '.' : L('Todas as seções principais estão lá.', 'All the main sections are there.'),
      [],
      missing.length ? 'readme' : null,
    );
  }
  add(doc, d.license ? 'ok' : 'warn', 'DCAS 15', L('Licença de uso (LICENSE)', 'Terms of use (LICENSE)'), d.license || L('Sem arquivo LICENSE: diga em que termos outros podem reusar código e dados (por exemplo, MIT para o código e CC-BY 4.0 para dados de vocês).', 'No LICENSE file: say how others may reuse code and data (for example MIT for code and CC-BY 4.0 for your own data).'));

  // Code
  const langs = Object.entries(d.byLang).sort((a, b) => b[1] - a[1]);
  add(code, langs.length ? 'ok' : 'warn', 'DCAS 7–9', L('Código de preparação e de análise', 'Data preparation and analysis code'), langs.length ? langs.map(([l, n]) => `${n} ${L('em', 'in')} ${l}`).join(', ') : L('Nenhum script encontrado na pasta do projeto.', 'No scripts found in the project folder.'));
  add(
    code,
    d.masters.length ? 'ok' : 'warn',
    'README',
    L('Um script que roda tudo na ordem', 'One script that runs everything in order'),
    d.masters.length ? d.masters.join(', ') : L('Não achei um main/master/run_all (nem Makefile). O Data Editor precisa saber a ordem; o melhor é um script que chame os outros.', 'No main/master/run_all script (or Makefile). The Data Editor needs the order; best is one script that calls the others.'),
    d.masters.map((m) => ({ rel: m, abs: `${d.root}/${m}` })),
  );
  add(
    code,
    d.absCount ? 'warn' : 'ok',
    'README',
    L('Caminhos relativos, sem pastas do seu computador', 'Relative paths, no folders from your computer'),
    d.absCount ? L(`${plural(d.absCount, 'caminho absoluto', 'caminhos absolutos')} no código: caminhos assim não existem no computador do Data Editor. Defina a raiz uma vez e use caminhos a partir dela.`, `${plural(d.absCount, 'absolute path', 'absolute paths')} in the code: such paths do not exist on the Data Editor’s computer. Set the root once and build paths from it.`) : L('Nenhum caminho absoluto no código.', 'No absolute paths in the code.'),
    d.absPaths,
  );
  {
    const g = d.rng;
    if (!g.count) add(code, 'ok', 'README', L('Aleatoriedade controlada (seed)', 'Controlled randomness (seed)'), g.seeds.length ? L(`Seed em ${g.seeds[0].rel}:${g.seeds[0].line}.`, `Seed in ${g.seeds[0].rel}:${g.seeds[0].line}.`) : L('O código não sorteia números.', 'The code draws no random numbers.'), g.seeds);
    else if (!g.seeds.length) add(code, 'warn', 'README', L('Aleatoriedade controlada (seed)', 'Controlled randomness (seed)'), L(`O código sorteia números (${plural(g.count, 'lugar', 'lugares')}) e não define seed: os resultados mudam a cada rodada.`, `The code draws random numbers (${plural(g.count, 'place', 'places')}) and sets no seed: results change on every run.`), g.uses);
    else if (g.unseeded.length)
      add(
        code,
        'info',
        'README',
        L('Aleatoriedade controlada (seed)', 'Controlled randomness (seed)'),
        L(`Seed em ${g.seeds[0].rel}:${g.seeds[0].line}. ${plural(g.unseeded.length, 'arquivo sorteia', 'arquivos sorteiam')} sem seed própria: confira que rodam depois dela, na mesma sessão.`, `Seed in ${g.seeds[0].rel}:${g.seeds[0].line}. ${plural(g.unseeded.length, 'file draws', 'files draw')} without a seed of their own: check they run after it, in the same session.`),
        g.uses.filter((u) => g.unseeded.includes(u.rel)),
      );
    else add(code, 'ok', 'README', L('Aleatoriedade controlada (seed)', 'Controlled randomness (seed)'), L(`Cada arquivo que sorteia define a sua seed (${g.seeds[0].rel}:${g.seeds[0].line}…).`, `Every file that draws random numbers sets its seed (${g.seeds[0].rel}:${g.seeds[0].line}…).`), g.seeds);
  }
  {
    const pk = Object.entries(d.packages).map(([l, list]) => `${list.length} ${L('em', 'in')} ${l}`);
    const has = d.deps.length || d.adoDirs.length;
    add(
      code,
      has ? 'ok' : pk.length ? 'warn' : 'ok',
      'DCAS 13',
      L('Versões dos pacotes registradas', 'Package versions recorded'),
      has ? [...d.deps, ...d.adoDirs].join(', ') : pk.length ? L(`O código usa pacotes (${pk.join(', ')}) e nada registra as versões: use renv (R), requirements.txt ou environment.yml (Python), ou uma pasta ado/ (Stata).`, `The code uses packages (${pk.join(', ')}) and nothing records their versions: use renv (R), requirements.txt or environment.yml (Python), or an ado/ folder (Stata).`) : L('O código não usa pacotes externos.', 'The code uses no external packages.'),
    );
  }

  // Data
  add(
    data,
    d.data.count ? 'ok' : 'info',
    'DCAS 2–3',
    L('Dados no pacote', 'Data in the package'),
    d.data.count ? L(`${plural(d.data.count, 'arquivo', 'arquivos')} de dados, ${size(d.data.bytes)}.`, `${plural(d.data.count, 'data file', 'data files')}, ${size(d.data.bytes)}.`) : L('Nenhum arquivo de dados na pasta. Se os dados não podem ir no pacote, o README precisa dizer como obtê-los.', 'No data files in the folder. If the data cannot go in the package, the README must say how to get it.'),
  );
  if (d.data.closedCount)
    add(
      data,
      j.openFormats ? 'warn' : 'info',
      'DCAS 4',
      L('Formatos abertos', 'Open formats'),
      L(`${plural(d.data.closedCount, 'arquivo', 'arquivos')} em formato de um programa comercial (.dta, .xlsx, .sav…). ${j.openFormats ? 'Esta revista pede uma cópia em formato aberto (CSV, Parquet).' : 'Uma cópia em CSV ou Parquet ajuda quem não tem o programa.'}`, `${plural(d.data.closedCount, 'file', 'files')} in a commercial program’s format (.dta, .xlsx, .sav…). ${j.openFormats ? 'This journal asks for a copy in an open format (CSV, Parquet).' : 'A CSV or Parquet copy helps those without the program.'}`),
      d.data.closed.map((rel) => ({ rel, abs: `${d.root}/${rel}` })),
    );
  add(
    data,
    d.dataCites.length ? 'ok' : d.data.count ? 'warn' : 'info',
    'DCAS 6',
    L('Dados citados nas referências', 'Data cited in the references'),
    d.dataCites.length ? d.dataCites.map((c) => c.key).join(', ') : L('Não achei nenhuma base de dados no .bib (@dataset, ou @misc com "data"/"dados" no título). Cada base usada precisa de uma referência, como um artigo.', 'No dataset found in the .bib (@dataset, or @misc with "data" in the title). Every dataset used needs a reference, like a paper.'),
  );
  add(
    data,
    d.big.length || d.comments ? 'warn' : 'info',
    'README',
    L('Tamanho do pacote', 'Package size'),
    L(`A pasta tem ${size(d.total)} (faixa do README: ${d.bucket}), ${plural(d.fileCount, 'arquivo', 'arquivos')}${d.truncated ? ', parei de contar' : ''}.${d.big.length ? ` ${plural(d.big.length, 'arquivo passa', 'arquivos passam')} de 2 GB.` : ''}${d.junk.length ? ` Tire do ZIP ${plural(d.junk.length, 'arquivo', 'arquivos')} de sistema (.DS_Store, .Rhistory…).` : ''}${d.comments ? ' Tire do pacote a pasta .texugo-comments (os comentários entre os autores).' : ''}`, `The folder holds ${size(d.total)} (README range: ${d.bucket}), ${plural(d.fileCount, 'file', 'files')}${d.truncated ? ', stopped counting' : ''}.${d.big.length ? ` ${plural(d.big.length, 'file is', 'files are')} over 2 GB.` : ''}${d.junk.length ? ` Leave out of the ZIP ${plural(d.junk.length, 'system file', 'system files')} (.DS_Store, .Rhistory…).` : ''}${d.comments ? ' Leave the .texugo-comments folder (the authors’ comments) out of the package.' : ''}`),
    [...d.big, ...d.junk.map((rel) => ({ rel }))].map((x) => ({ rel: x.rel, abs: `${d.root}/${x.rel}` })),
  );

  // Tables and figures
  if (!hasDoc) add(exh, 'info', 'DCAS 8', L('Cada tabela e figura sai de um script', 'Every table and figure comes from a script'), L('Abra o .tex do paper para conferir.', 'Open the paper’s .tex to check.'));
  else if (!d.exhibits.length) add(exh, 'info', 'DCAS 8', L('Cada tabela e figura sai de um script', 'Every table and figure comes from a script'), L('O paper não inclui tabelas nem figuras de arquivos (\\input, \\includegraphics).', 'The paper includes no tables or figures from files (\\input, \\includegraphics).'));
  else {
    const loose = d.exhibits.filter((x) => !x.by.length);
    add(
      exh,
      loose.length ? 'warn' : 'ok',
      'DCAS 8',
      L('Cada tabela e figura sai de um script', 'Every table and figure comes from a script'),
      loose.length
        ? L(`${plural(loose.length, 'arquivo', 'arquivos')} de ${d.exhibits.length} que o paper usa não aparece${loose.length > 1 ? 'm' : ''} pelo nome em nenhum script. Pode ser nome montado no código; se foi feito à mão, o Data Editor vai perguntar.`, `${loose.length} of ${d.exhibits.length} files the paper uses ${loose.length > 1 ? 'are' : 'is'} not named in any script. It may be a name built in code; if it was made by hand, the Data Editor will ask.`)
        : L(`As ${d.exhibits.length} tabelas e figuras do paper aparecem em algum script.`, `All ${d.exhibits.length} tables and figures of the paper are named in some script.`),
      (loose.length ? loose : d.exhibits).map((x) => ({ rel: x.rel, abs: x.abs, text: x.by.length ? `← ${x.by.join(', ')}` : '' })),
    );
  }
  return out;
}

export function replicationItems(S) {
  const R = S.repl;
  if (!R || !R.data) return null;
  const j = journalById(R.data.state.journal);
  const auto = autoItems(R.data, j, !!R.doc);
  const manual = MANUAL.map(([id, rule, title]) => ({ id, rule, title: title(), group: L('Só vocês sabem', 'Only you know'), status: R.data.state.manual[id] ? 'done' : 'todo', mark: R.data.state.manual[id] || null }));
  const pending = auto.filter((x) => x.status === 'warn').length + manual.filter((x) => x.status === 'todo').length;
  return { j, auto, manual, pending };
}

export function replicationCount(S) {
  const it = replicationItems(S);
  return it ? it.pending : 0;
}

export async function loadReplication(app, S) {
  const root = S.project && S.project.root;
  if (!root) return null;
  const t = app.activeTab();
  const doc = (t && t.root) || null;
  try {
    const data = await call('replicationScan', { root, doc });
    S.repl = { root, doc, data };
  } catch (err) {
    S.repl = { root, doc, error: err.message };
  }
  return S.repl;
}

async function saveState(S) {
  const st = S.repl.data.state;
  try {
    S.repl.data.state = await call('replicationState', { root: S.repl.root, state: st });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// The README draft in a dialog: edit, then save next to the package.
export async function readmeDialog(app, S) {
  const R = S.repl;
  if (!R || !R.data) return;
  const area = h('textarea', { class: 'repl-readme', spellcheck: false });
  area.value = L('Montando o rascunho…', 'Building the draft…');
  const m = modal({
    title: L('Rascunho do README', 'README draft'),
    wide: true,
    body: [
      h('p', { class: 'faint', style: { margin: '0 0 8px' } }, L('No formato do modelo dos Data Editors, em inglês (o que as revistas leem). Os TODO são o que só vocês sabem.', 'In the shape of the Data Editors’ template. The TODOs are what only you know.'), ' ', link(README_URL, L('Ver o modelo', 'See the template'))),
      area,
    ],
    footer: [
      h('button', { class: 'btn', onclick: () => (navigator.clipboard.writeText(area.value), toast(L('Copiado.', 'Copied.'), 'ok')) }, L('Copiar', 'Copy')),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            try {
              const file = await call('replicationSaveReadme', { root: R.root, text: area.value });
              m.close();
              toast(L(`Salvo em ${basename(file)}.`, `Saved as ${basename(file)}.`), 'ok');
              await app.openFile(file);
              await loadReplication(app, S);
              app.bottom.render();
              app.refreshRevisao && app.refreshRevisao();
            } catch (err) {
              toast(err.message, 'error', 8000);
            }
          },
        },
        R.data.readme && R.data.readme.all.some((f) => /^readme\.md$/i.test(f)) ? L('Salvar como README-rascunho.md', 'Save as README-rascunho.md') : L('Salvar como README.md', 'Save as README.md'),
      ),
    ],
  });
  try {
    area.value = await call('replicationReadme', { root: R.root, doc: R.doc, journal: R.data.state.journal });
  } catch (err) {
    area.value = err.message;
  }
}

const STATUS_ICON = { ok: 'check', warn: 'warn', info: 'info', done: 'check', todo: 'clock' };

export async function renderReplicationPanel(app, S, el) {
  const rerender = () => (app.bottom.view === 'replicacao' ? app.bottom.render() : renderReplicationPanel(app, S, el));
  const root = S.project && S.project.root;
  if (!root) return clear(el, h('div', { class: 'pad faint' }, L('Abra um projeto.', 'Open a project.')));
  const t = app.activeTab();
  const doc = (t && t.root) || null;
  if (!S.repl || S.repl.root !== root || (doc && S.repl.doc !== doc)) {
    clear(el, h('div', { class: 'pad faint' }, h('span', { class: 'status-dot building' }), ' ', L('Lendo a pasta do projeto…', 'Reading the project folder…')));
    await loadReplication(app, S);
    app.refreshRevisao && app.refreshRevisao();
    // Again through the panel, so the tab shows the new count.
    if (app.bottom.view === 'replicacao') return app.bottom.render();
  }
  const R = S.repl;
  if (R.error) return clear(el, h('div', { class: 'pad' }, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, R.error))));
  const it = replicationItems(S);
  const j = it.j;

  const sel = h(
    'select',
    {
      class: 'sm',
      title: L('A revista muda onde o pacote vai, quando e alguns detalhes', 'The journal changes where the package goes, when, and a few details'),
      onchange: async (e) => {
        R.data.state.journal = e.target.value;
        await saveState(S);
        rerender();
        app.refreshRevisao && app.refreshRevisao();
      },
    },
    JOURNALS.map((x) => h('option', { value: x.id, selected: x.id === j.id }, x.name)),
  );
  const refresh = h(
    'button',
    {
      class: 'btn sm',
      onclick: async () => {
        await loadReplication(app, S);
        rerender();
        app.refreshRevisao && app.refreshRevisao();
      },
    },
    icon('refresh'),
    L('Conferir de novo', 'Check again'),
  );
  const readmeBtn = h('button', { class: 'btn sm', onclick: () => readmeDialog(app, S) }, icon('file'), L('Rascunho do README…', 'README draft…'));
  const head = h(
    'div',
    { class: 'repl-head' },
    sel,
    refresh,
    readmeBtn,
    h('span', { class: 'faint repl-score' }, it.pending ? L(`${plural(it.pending, 'pendência', 'pendências')}`, `${it.pending} pending`) : L('Tudo certo pelo que dá para conferir daqui.', 'All clear, as far as can be checked from here.')),
  );

  const card = h(
    'div',
    { class: 'repl-journal' },
    h('div', {}, h('b', {}, L('Onde: ', 'Where: ')), link(j.repoUrl, j.repo), ' · ', link(j.guide, L('instruções da revista', 'journal instructions'))),
    h('div', {}, h('b', {}, L('Quando: ', 'When: ')), j.when),
    j.notes.length ? h('ul', {}, j.notes.map((n) => h('li', {}, n))) : null,
    h('div', { class: 'faint' }, L('Base comum: ', 'Common ground: '), link(DCAS_URL, 'Data and Code Availability Standard'), ' · ', link(README_URL, L('modelo de README dos Data Editors', 'Data Editors’ README template'))),
    R.data.gitTop ? h('div', { class: 'qq-banner', style: { marginTop: '6px' } }, icon('info'), h('div', {}, L(`O Git deste projeto começa em ${R.data.gitTop}. Se o código e os dados estão lá, abra essa pasta como projeto para conferir o pacote inteiro.`, `This project’s Git starts at ${R.data.gitTop}. If the code and data live there, open that folder as the project to check the whole package.`))) : null,
  );

  const locList = (locs) =>
    h(
      'div',
      { class: 'repl-locs hidden' },
      locs.slice(0, 40).map((l) =>
        h(
          'div',
          { class: 'repl-loc' + (l.abs ? ' click' : ''), title: l.abs ? L('Abrir', 'Open') : '', onclick: l.abs ? () => app.openFile(l.abs, l.line ? { line: l.line } : {}) : null },
          h('span', { class: 'k' }, l.rel + (l.line ? `:${l.line}` : '')),
          l.text ? h('span', { class: 'faint' }, l.path ? l.path : l.text) : null,
        ),
      ),
      locs.length > 40 ? h('div', { class: 'faint' }, L(`… e mais ${locs.length - 40}`, `… and ${locs.length - 40} more`)) : null,
    );

  const autoRow = (x) => {
    const locs = x.locs && x.locs.length ? locList(x.locs) : null;
    return h(
      'div',
      { class: `repl-item ${x.status}` },
      h('span', { class: 'repl-ico' }, icon(STATUS_ICON[x.status])),
      h(
        'div',
        { class: 'repl-main' },
        h('div', { class: 'repl-title' }, x.title, h('span', { class: 'repl-rule' }, x.rule)),
        h('div', { class: 'repl-detail' }, x.detail),
        locs,
      ),
      h(
        'div',
        { class: 'repl-actions' },
        x.action === 'readme' ? h('button', { class: 'btn sm', onclick: () => readmeDialog(app, S) }, L('Rascunho do README', 'README draft')) : null,
        locs ? h('button', { class: 'btn sm ghost', onclick: (e) => (locs.classList.toggle('hidden'), (e.currentTarget.textContent = locs.classList.contains('hidden') ? L('Ver onde', 'Show where') : L('Esconder', 'Hide'))) }, L('Ver onde', 'Show where')) : null,
      ),
    );
  };
  const manualRow = (x) => {
    const set = async (v) => {
      const st = R.data.state.manual;
      if (st[x.id] === v) delete st[x.id];
      else st[x.id] = v;
      await saveState(S);
      rerender();
      app.refreshRevisao && app.refreshRevisao();
    };
    return h(
      'div',
      { class: `repl-item ${x.status}` + (x.mark === 'na' ? ' na' : '') },
      h('span', { class: 'repl-ico' }, icon(STATUS_ICON[x.status])),
      h('div', { class: 'repl-main' }, h('div', { class: 'repl-title' }, x.title, h('span', { class: 'repl-rule' }, x.rule))),
      h(
        'div',
        { class: 'repl-actions' },
        h('button', { class: 'btn sm' + (x.mark === 'ok' ? ' primary' : ''), onclick: () => set('ok') }, L('Feito', 'Done')),
        h('button', { class: 'btn sm' + (x.mark === 'na' ? ' primary' : ' ghost'), onclick: () => set('na') }, L('Não se aplica', 'Not applicable')),
      ),
    );
  };

  const groups = [];
  let last = null;
  for (const x of it.auto) {
    if (x.group !== last) groups.push(h('div', { class: 'section-label' }, x.group));
    last = x.group;
    groups.push(autoRow(x));
  }
  groups.push(h('div', { class: 'section-label' }, it.manual[0].group));
  for (const x of it.manual) groups.push(manualRow(x));

  clear(el, h('div', { class: 'repl' }, head, card, groups));
}
