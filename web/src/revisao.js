// Sidebar view "Revisão": everything about revising a paper in one place,
// in the order a revision happens. Coauthors (PDF annotations, a version
// they sent, their commits), referees (the referee-style report, the
// response letter) and the checks before sending. Each block says where
// things stand ("3 notes open") and opens the tool; the long lists stay in
// the bottom panel.
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast } from './dom.js';
import { viciosOf } from './vicios/cm.js';
import { reviewDialog, loadLastReview } from './review.js';
import { responseDialog } from './rr.js';
import { annotationsDialog } from './annotations.js';
import { compareDialog } from './compare.js';

const REC = { reject: 'rejeitar', 'major revision': 'revisão maior', 'minor revision': 'revisão menor', accept: 'aceitar' };
let fetchedAt = null;

const exists = async (p) => {
  try {
    const st = await call('stat', { paths: [p] });
    return st[0] && st[0].mtime != null ? st[0].mtime : null;
  } catch {
    return null;
  }
};
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `há ${hrs} h`;
  return new Date(ms).toLocaleDateString('pt-BR');
};

// One tool: a title, a line saying where it stands, and its actions.
function row(ic, title, status, actions, { cls = '' } = {}) {
  return h(
    'div',
    { class: 'rev-row ' + cls },
    h('div', { class: 'rev-ico' }, icon(ic)),
    h('div', { class: 'rev-main' }, h('div', { class: 'rev-title' }, title), status ? h('div', { class: 'rev-status' }, status) : null, actions.length ? h('div', { class: 'rev-actions' }, actions) : null),
  );
}
const btn = (label, onclick, primary) => h('button', { class: 'btn sm' + (primary ? ' primary' : ''), onclick }, label);

export async function renderRevisao(app, S, el) {
  const t = app.activeTab();
  const doc = t && t.root;
  const head = h('div', { class: 'sidebar-head' }, h('span', { class: 'title' }, 'Revisão'), h('button', { class: 'icon-btn', title: 'Atualizar', onclick: () => renderRevisao(app, S, el) }, icon('refresh')));
  if (!doc) {
    return clear(el, head, h('div', { class: 'pad muted' }, 'Abra um arquivo do paper para ver a revisão dele.'));
  }
  await loadLastReview(app, S);
  const stem = doc.replace(/\.tex$/, '');
  const docDir = doc.replace(/[^/]*$/, '');
  const [diffPdf, response] = await Promise.all([exists(`${docDir}.texugo/diff/${basename(stem)}-mudancas.pdf`), exists(`${docDir}response.tex`)]);
  const g = S.git;

  // ---------------------------------------------------------- coauthors
  const an = S.annots && S.annots.doc === doc ? S.annots : null;
  const anOpen = an && an.items ? an.items.filter((a) => !a.done).length : 0;
  const coauthors = [
    row(
      'edit',
      'Anotações do PDF',
      an && an.items ? (an.items.length ? `${anOpen} de ${an.items.length} em aberto · ${an.label}` : `Nenhuma anotação em ${an.label}`) : 'Destaques e notas do Preview ou do Acrobat, seus ou de um coautor, ligados às linhas.',
      [an && an.items && an.items.length ? btn('Ver', () => app.bottom.show('anotacoes'), true) : null, btn(an ? 'Ler outro PDF…' : 'Ler anotações…', () => annotationsDialog(app, S), !an)].filter(Boolean),
      { cls: anOpen ? 'open' : '' },
    ),
    row(
      'columns',
      'Comparar com outra versão',
      diffPdf ? `Último PDF com mudanças: ${ago(diffPdf)}` : 'PDF com as mudanças marcadas: versão do coautor, ZIP do Overleaf ou commit.',
      [btn('Comparar…', () => compareDialog(app, S), !diffPdf), diffPdf ? btn('Abrir o último', () => app.openPdf(`${docDir}.texugo/diff/${basename(stem)}-mudancas.pdf`, { activate: true })) : null].filter(Boolean),
    ),
  ];
  if (g && g.repo && g.remote) {
    const behind = g.behind || 0;
    coauthors.push(
      row(
        'git',
        'Commits dos coautores',
        behind ? `${behind} commit${behind > 1 ? 's' : ''} novo${behind > 1 ? 's' : ''} no remoto, ainda não baixado${behind > 1 ? 's' : ''}.` : fetchedAt ? `Nada novo no remoto (visto ${ago(fetchedAt)}).` : 'Veja se alguém mandou commits.',
        [
          behind
            ? btn('Baixar (pull)', async () => {
                const r = await call('gitPull', { root: S.project.root });
                if (r.code === 0) toast('Pull: ok.', 'ok');
                else toast((r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' '), 'error', 9000);
                await app.refreshGit();
                renderRevisao(app, S, el);
              }, true)
            : btn('Ver novidades', async (e) => {
                e.target.disabled = true;
                const r = await call('gitFetch', { root: S.project.root });
                if (r.code !== 0) toast((r.stderr || '').trim().split('\n').slice(-2).join(' ') || 'Não deu para falar com o remoto.', 'error', 9000);
                fetchedAt = Date.now();
                await app.refreshGit();
                renderRevisao(app, S, el);
              }),
          btn('Abrir o Git', () => app.sidebar.show('git')),
        ],
        { cls: behind ? 'open' : '' },
      ),
    );
  }

  // ---------------------------------------------------------- referees
  const rv = S.review && S.review.doc === doc ? S.review : null;
  let reviewStatus = 'O seu Claude Code lê o paper inteiro e escreve um parecer, cada ponto ligado à linha.';
  let reviewOpen = 0;
  if (rv && rv.status === 'running') reviewStatus = 'Escrevendo o parecer…';
  else if (rv && rv.status === 'error') reviewStatus = 'O último parecer falhou: ' + rv.error;
  else if (rv && rv.report) {
    const pts = rv.report.points;
    reviewOpen = pts.filter((p) => !p.done).length;
    const major = pts.filter((p) => !p.done && p.kind === 'major').length;
    reviewStatus = `${REC[String(rv.report.recommendation).toLowerCase()] || rv.report.recommendation} · ${reviewOpen} de ${pts.length} em aberto${major ? ` (${major} principa${major > 1 ? 'is' : 'l'})` : ''} · ${ago(new Date(rv.report.date).getTime())}`;
  }
  const referees = [
    row(
      'review',
      'Parecer do Claude',
      reviewStatus,
      [rv && (rv.report || rv.status === 'running') ? btn('Ver', () => app.bottom.show('parecer'), true) : null, rv && rv.status === 'running' ? null : btn(rv && rv.report ? 'Novo parecer…' : 'Revisar como parecerista…', () => reviewDialog(app, S), !(rv && rv.report))].filter(Boolean),
      { cls: reviewOpen ? 'open' : '' },
    ),
    row(
      'letter',
      'Resposta aos pareceristas',
      response ? `response.tex ${ago(response)}` : 'Cole os pareceres: o Claude escreve o response.tex, cada comentário ligado ao que mudou.',
      [response ? btn('Abrir response.tex', () => app.openFile(`${docDir}response.tex`), true) : null, btn(response ? 'Nova resposta…' : 'Escrever a resposta…', () => responseDialog(app, S), !response)].filter(Boolean),
    ),
  ];

  // ---------------------------------------------------------- before sending
  const n = t && !t.binary && app.view ? viciosOf(app.view.state).length : 0;
  const before = [
    row('edit', 'Vícios de escrita', n ? `${n} no arquivo aberto (${basename(t.path)}).` : `Nada no arquivo aberto (${basename(t.path)}).`, [btn('Relatório do documento', () => app.tools.viciosReport(app, S), !!n)], { cls: n ? 'open' : '' }),
    row('book', 'Referências', 'Ano, periódico, páginas e DOI conferidos no Crossref.', [btn('Verificar', () => app.sidebar.show('refs'))]),
    row('eye', 'Checar antes de submeter', 'Anonimato (double-blind), caminhos com o seu usuário e fontes Type 3 no PDF.', [btn('Checar', () => app.tools.blindCheck(app, S))]),
    row('down', 'ZIP para submissão', 'Com o .bbl, os arquivos de fora trazidos para dentro, e testado numa pasta vazia.', [btn('Exportar', () => app.tools.exportZip(app, S))]),
    row('check', 'Estilo e tamanho', null, [btn('Revisar estilo (ChkTeX)', () => app.tools.chktex(app, S)), btn('Contar palavras', () => app.tools.wordCount(app, S))]),
  ];

  clear(
    el,
    head,
    h(
      'div',
      { class: 'sidebar-body rev' },
      h('div', { class: 'rev-doc faint' }, relPath(S.project.root, doc)),
      h('div', { class: 'section-label' }, 'Coautores'),
      coauthors,
      h('div', { class: 'section-label' }, 'Pareceristas'),
      referees,
      h('div', { class: 'section-label' }, 'Antes de enviar'),
      before,
    ),
  );
}
