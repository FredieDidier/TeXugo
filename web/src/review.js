// "Revisar como parecerista": a referee report on the whole paper by the
// user's own Claude Code. Runs in the background; the points show in the
// "Parecer" tab of the bottom panel, each tied to its line in the source.
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal } from './dom.js';
import { claudeChoice, CLAUDE_MODELS, CLAUDE_EFFORTS } from './agent.js';
import { getLang } from './i18n.js';

const REC = { reject: 'rejeitar', 'major revision': 'revisão maior', 'minor revision': 'revisão menor', accept: 'aceitar' };
const KIND = { major: { label: 'Principal', cls: 'err' }, minor: { label: 'Menor', cls: 'warn' }, typo: { label: 'Redação', cls: 'muted' } };

export function reviewDialog(app, S) {
  const t = app.activeTab();
  const doc = t && t.root;
  if (!doc) return toast('Abra um arquivo que pertença a um documento.', 'warn');
  if (S.review && S.review.status === 'running') return app.bottom.show('parecer');
  const journal = h('input', { value: S.settings.reviewJournal || '', placeholder: 'Ex.: AEJ: Applied Economics, Journal of Development Economics' });
  const focus = h('textarea', { rows: 3, placeholder: 'Opcional. Ex.: a estratégia de identificação e a inferência; se a introdução vende demais o resultado', style: { width: '100%' } });
  const choice = claudeChoice(S);
  const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id;
  const m = modal({
    title: [icon('review'), ` Revisar ${basename(doc)} como parecerista`],
    wide: true,
    body: h(
      'div',
      {},
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'O seu Claude Code lê o paper inteiro (com os \\input) e escreve um parecer: resumo, recomendação e cada comentário ligado à linha do texto. Ele só lê; nada é alterado.'),
      h('div', { class: 'field' }, h('label', {}, 'Periódico (o padrão de exigência)'), journal),
      h('div', { class: 'field' }, h('label', {}, 'Foco'), focus),
      h('p', { class: 'faint', style: { fontSize: '12px' } }, `Modelo ${label(CLAUDE_MODELS, choice.model)}, esforço ${label(CLAUDE_EFFORTS, choice.effort).toLowerCase()} (troque no painel Claude). Um paper longo leva alguns minutos; você pode continuar trabalhando.`),
    ),
    footer: [
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            S.settings.reviewJournal = journal.value.trim();
            app.saveSettingsSoon();
            m.close();
            run(app, S, doc, { journal: journal.value.trim(), focus: focus.value.trim() });
          },
        },
        icon('play'),
        'Gerar parecer',
      ),
    ],
  });
}

async function run(app, S, doc, { journal, focus }) {
  if (app.saveAll) await app.saveAll();
  S.review = { status: 'running', doc, start: Date.now() };
  app.bottom.show('parecer');
  app.refreshRevisao && app.refreshRevisao();
  const tick = setInterval(() => S.review && S.review.status === 'running' && app.bottom.view === 'parecer' && app.bottom.render(), 1000);
  try {
    const report = await call('reviewRun', { root: S.project.root, doc, journal, focus, lang: getLang() === 'en' ? 'en' : 'pt', ...claudeChoice(S) });
    S.review = { status: 'done', doc, report };
    toast(`Parecer pronto: ${report.points.length} pontos.`, 'ok');
  } catch (err) {
    S.review = { status: 'error', doc, error: err.message };
  } finally {
    clearInterval(tick);
    app.bottom.show('parecer', { soft: true });
    app.refreshRevisao && app.refreshRevisao();
  }
}

// Loads the last saved report of the active document (after a restart).
export async function loadLastReview(app, S) {
  const t = app.activeTab();
  if (!t || !t.root || (S.review && S.review.doc === t.root)) return;
  try {
    const report = await call('reviewLast', { doc: t.root });
    if (report) S.review = { status: 'done', doc: t.root, report };
  } catch {}
}

export function renderReviewPanel(app, S, body) {
  const r = S.review;
  if (!r) {
    return clear(body, h('div', { class: 'pad muted' }, 'Nenhum parecer ainda. ', h('a', { href: '#', onclick: (e) => (e.preventDefault(), reviewDialog(app, S)) }, 'Revisar como parecerista'), ' (aba Revisão, na barra da esquerda).'));
  }
  if (r.status === 'running') {
    const s = Math.round((Date.now() - r.start) / 1000);
    return clear(
      body,
      h('div', { class: 'pad' }, h('span', { class: 'status-dot building' }), ` O Claude está lendo ${basename(r.doc)} e escrevendo o parecer… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}  `, h('button', { class: 'btn sm', onclick: () => call('aiCancel', { root: S.project && S.project.root }) }, 'Cancelar')),
    );
  }
  if (r.status === 'error') return clear(body, h('div', { class: 'pad' }, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, r.error)), h('button', { class: 'btn sm', onclick: () => reviewDialog(app, S) }, 'Tentar de novo')));
  const rep = r.report;
  const open = rep.points.filter((p) => !p.done).length;
  const ask = (p) => {
    app.sidebar.show('claude');
    const a = app.agent;
    if (!a) return;
    a.input.value = `Um parecerista apontou, em ${relPath(S.project.root, p.file)}:${p.line}:\n“${p.comment}”${p.suggestion ? `\nSugestão: ${p.suggestion}` : ''}\n\nComo você resolveria? Proponha a mudança no texto.`;
    a.input.focus();
  };
  clear(
    body,
    h(
      'div',
      { class: 'review-panel' },
      h(
        'div',
        { class: 'review-head' },
        h('b', {}, `Parecer de ${basename(rep.doc)}`),
        h('span', { class: 'chip' }, REC[String(rep.recommendation).toLowerCase()] || rep.recommendation || '—'),
        h('span', { class: 'faint' }, `${open} de ${rep.points.length} em aberto · ${new Date(rep.date).toLocaleString('pt-BR').slice(0, 16)}${rep.journal ? ' · ' + rep.journal : ''}`),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn sm', onclick: async () => toast('Salvo: ' + relPath(S.project.root, await call('reviewSaveMd', { root: S.project.root, doc: rep.doc })), 'ok') }, 'Salvar .md'),
        h('button', { class: 'btn sm', onclick: () => reviewDialog(app, S) }, 'Novo parecer'),
      ),
      rep.summary ? h('p', { class: 'review-summary', title: 'Clique para ver o resumo inteiro', onclick: (e) => e.currentTarget.classList.toggle('open') }, rep.summary) : null,
      rep.points.map((p) =>
        h(
          'div',
          { class: 'review-pt' + (p.done ? ' done' : ''), onclick: () => app.openFile(p.file, { line: p.line }) },
          h('input', {
            type: 'checkbox',
            checked: !!p.done,
            title: 'Resolvido',
            onclick: (e) => e.stopPropagation(),
            onchange: async (e) => {
              p.done = e.target.checked;
              await call('reviewMark', { doc: rep.doc, id: p.id, done: p.done }).catch(() => {});
              app.bottom.render();
              app.refreshRevisao && app.refreshRevisao();
            },
          }),
          h('span', { class: 'kind ' + KIND[p.kind].cls }, KIND[p.kind].label),
          h('div', { class: 'txt' }, h('b', {}, p.title), ' ', p.comment, p.suggestion ? h('div', { class: 'sug' }, 'Sugestão: ', p.suggestion) : null),
          h('span', { class: 'where', title: p.exact ? 'Trecho achado no texto' : 'Linha informada pelo Claude (trecho não achado)' }, `${relPath(S.project.root, p.file)}:${p.line}${p.exact ? '' : ' ~'}`),
          h('button', { class: 'btn sm ghost', title: 'Levar este ponto ao painel Claude', onclick: (e) => (e.stopPropagation(), ask(p)) }, icon('claude')),
        ),
      ),
    ),
  );
}
