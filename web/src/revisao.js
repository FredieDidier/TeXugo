// Sidebar view "Revisão": everything about revising a paper in one place,
// in the order a revision happens. Coauthors (PDF annotations, a version
// they sent, their commits), referees (the referee-style report, the
// response letter) and the checks before sending. Each block says where
// things stand ("3 notes open") and opens the tool; the long lists stay in
// the bottom panel.
import { locale, getLang } from './i18n.js';
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast, dirname, sepOf } from './dom.js';
import { viciosOf } from './vicios/cm.js';
import { reviewDialog, loadLastReview } from './review.js';
import { responseDialog } from './rr.js';
import { agentChoice, agentInfo } from './agent.js';
import { annotationsDialog } from './annotations.js';
import { compareDialog } from './compare.js';
import { summary } from './news.js';
import { authorColor } from './blame.js';
import { replicationItems } from './replication.js';
import { loadSent, sentCount, markDialog, feedbackDialog } from './sent.js';
import { overleafSendDialog, overleafSent } from './overleaf.js';

const L = (pt, en) => (getLang() === 'en' ? en : pt);
const REC = { reject: 'rejeitar', 'major revision': 'revisão maior', 'minor revision': 'revisão menor', accept: 'aceitar' };

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
  return new Date(ms).toLocaleDateString(locale());
};

// One tool: a title, a line saying where it stands, and its actions. A
// filled button means "something here waits for you" (open notes, new
// commits, pending items); a tool not used yet gets a plain one, so the
// panel does not open as a wall of calls to action.
function row(ic, title, status, actions, { cls = '' } = {}) {
  return h(
    'div',
    { class: 'rev-row ' + cls },
    h('div', { class: 'rev-ico' }, icon(ic)),
    h('div', { class: 'rev-main' }, h('div', { class: 'rev-title' }, title), status ? h('div', { class: 'rev-status' }, status) : null, actions.length ? h('div', { class: 'rev-actions' }, actions) : null),
  );
}
const btn = (label, onclick, primary) => h('button', { class: 'btn sm' + (primary ? ' primary' : ''), onclick }, label);

// The latest message of a thread (the comment or its last reply).
const lastMsg = (c) => (c.replies && c.replies.length ? c.replies[c.replies.length - 1] : c);
const lastDate = (c) => lastMsg(c).date;
const lastBy = (c) => lastMsg(c).author.split(' ')[0];

export async function renderRevisao(app, S, el) {
  const t = app.activeTab();
  const doc = t && t.root;
  const head = h('div', { class: 'sidebar-head' }, h('span', { class: 'title' }, 'Revisão'), h('button', { class: 'icon-btn', title: 'Atualizar', onclick: () => renderRevisao(app, S, el) }, icon('refresh')));
  if (!doc) {
    return clear(el, head, h('div', { class: 'pad muted' }, 'Abra um arquivo do paper para ver a revisão dele.'));
  }
  await loadLastReview(app, S);
  const stem = doc.replace(/\.tex$/, '');
  const docDir = dirname(doc) + sepOf(doc);
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
      [an && an.items && an.items.length ? btn('Ver', () => app.bottom.show('anotacoes'), !!anOpen) : null, btn(an ? 'Ler outro PDF…' : 'Ler anotações…', () => annotationsDialog(app, S))].filter(Boolean),
      { cls: anOpen ? 'open' : '' },
    ),
    row(
      'columns',
      'Comparar com outra versão',
      diffPdf ? `Último PDF com mudanças: ${ago(diffPdf)}` : 'PDF com as mudanças marcadas: versão do coautor, ZIP do Overleaf ou commit.',
      [btn('Comparar…', () => compareDialog(app, S)), diffPdf ? btn('Abrir o último', () => app.openPdf(`${docDir}.texugo/diff/${basename(stem)}-mudancas.pdf`, { activate: true })) : null].filter(Boolean),
    ),
  ];
  {
    if (!S.sent || S.sent.root !== S.project.root) await loadSent(app, S);
    const open = sentCount(S);
    const marks = (S.sent.marks || []).filter((x) => x.doc === relPath(S.project.root, doc));
    const lastFb = (S.sent.feedback || []).find((f) => f.counts && f.counts.open);
    const dm = (iso) => new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
    coauthors.push(
      row(
        'papers',
        'Versões enviadas',
        open
          ? `${open} sugest${open > 1 ? 'ões' : 'ão'} em aberto · de ${lastFb.from || lastFb.source}`
          : marks.length
            ? marks[0].to
              ? `Última: enviada a ${marks[0].to} em ${dm(marks[0].date)}`
              : `Última: enviada em ${dm(marks[0].date)}`
            : 'Marque a versão quando mandar o paper: o retorno é lido contra ela, mesmo que o texto já tenha mudado.',
        [open ? btn('Ver sugestões', () => app.bottom.show('sugestoes'), true) : null, btn('Marcar o envio…', () => markDialog(app, S)), btn('Recebi o retorno…', () => feedbackDialog(app, S, { markId: marks[0] && marks[0].id }))].filter(Boolean),
        { cls: open ? 'open' : '' },
      ),
    );
    // A coauthor on Overleaf: by Git when the project is linked (paid
    // plans), else by ZIP, read against the version sent.
    const ol = marks.find((x) => x.note === 'Overleaf');
    coauthors.push(
      row(
        'external',
        L('Coautor no Overleaf', 'Coauthor on Overleaf'),
        g && g.overleaf
          ? L('Ligado pelo Git: Sincronizar, no painel Git, manda e recebe as mudanças.', 'Linked by Git: Sync, in the Git panel, sends and receives the changes.')
          : ol
            ? overleafSent(ol, dm(ol.date))
            : L('Sem Git nem plano pago: um ZIP pronto para virar projeto no Overleaf, e o ZIP que voltar é lido contra ele.', 'No Git or paid plan needed: a ZIP ready to become an Overleaf project, and the ZIP that comes back is read against it.'),
        g && g.overleaf ? [] : [btn(L('Mandar ZIP…', 'Send ZIP…'), () => overleafSendDialog(app, S)), ol ? btn(L('Recebi do Overleaf…', 'Back from Overleaf…'), () => feedbackDialog(app, S, { markId: ol.id })) : null].filter(Boolean),
      ),
    );
  }
  {
    const cm = app.comments;
    const open = cm.open();
    const last = open.length ? open.reduce((a, b) => (lastDate(a) > lastDate(b) ? a : b)) : null;
    coauthors.push(
      row(
        'comment',
        'Comentários no texto',
        open.length
          ? `${open.length} em aberto · último: ${lastBy(last)} ${ago(new Date(lastDate(last)).getTime())}`
          : cm.items.length
            ? 'Todos resolvidos.'
            : 'Selecione um trecho e comente (⌥⌘M): os coautores respondem e resolvem, e tudo vai junto no commit.',
        [cm.items.length ? btn('Ver', () => app.bottom.show('comentarios'), !!open.length) : null, btn('Comentar trecho', () => cm.add(app.view, t))].filter(Boolean),
        { cls: open.length ? 'open' : '' },
      ),
    );
  }
  if (g && g.repo) {
    const n = S.news && S.news.root === S.project.root ? S.news : null;
    const d = n && n.data;
    const cnt = d ? (d.count || 0) + (d.remoteCount || 0) : 0;
    const st = !d
      ? 'O que cada coautor mudou desde a última vez que você olhou, seção por seção.'
      : d.count
        ? summary(n)
        : d.remoteCount
          ? `${d.remoteCount} commit${d.remoteCount > 1 ? 's' : ''} no remoto, ainda não baixado${d.remoteCount > 1 ? 's' : ''}.`
          : d.firstVisit
            ? 'Primeira visita: a partir de agora o TeXugo anota o que muda entre uma visita e outra.'
            : 'Nada novo dos coautores desde a sua última visita.';
    coauthors.push(
      row('users', 'Novidades desde a sua última visita', st, [btn(cnt ? 'Ver o que mudou' : 'Abrir', () => app.bottom.show('novidades'), !!cnt), btn('Abrir o Git', () => app.sidebar.show('git'))], { cls: cnt ? 'open' : '' }),
    );
    const sh = app.blame.on ? app.blame.stats(t) : [];
    coauthors.push(
      row(
        'users',
        'Quem escreveu cada trecho',
        app.blame.on
          ? sh.length
            ? h('span', { class: 'rev-shares' }, sh.slice(0, 4).map((x) => h('span', { class: 'rev-share' }, h('i', { style: { background: authorColor(x.c) } }), `${x.name} ${x.pct}%`)))
            : 'Lendo a autoria…'
          : 'Iniciais na margem de quem mudou cada linha por último, pelo Git; clique para ver o commit.',
        [btn(app.blame.on ? 'Esconder' : 'Mostrar na margem', () => app.blame.toggle())],
      ),
    );
  }

  // ---------------------------------------------------------- referees
  const rv = S.review && S.review.doc === doc ? S.review : null;
  let reviewStatus = `O seu ${agentInfo(agentChoice(S).agent).product} lê o paper inteiro e escreve um parecer, cada ponto ligado à linha.`;
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
      'Parecer do agente',
      reviewStatus,
      [rv && (rv.report || rv.status === 'running') ? btn('Ver', () => app.bottom.show('parecer'), !!reviewOpen || rv.status === 'running') : null, rv && rv.status === 'running' ? null : btn(rv && rv.report ? 'Novo parecer…' : 'Revisar como parecerista…', () => reviewDialog(app, S))].filter(Boolean),
      { cls: reviewOpen ? 'open' : '' },
    ),
    row(
      'letter',
      'Resposta aos pareceristas',
      response ? `response.tex ${ago(response)}` : 'Cole os pareceres: o agente escreve o response.tex, cada comentário ligado ao que mudou.',
      [response ? btn('Abrir response.tex', () => app.openFile(`${docDir}response.tex`)) : null, btn(response ? 'Nova resposta…' : 'Escrever a resposta…', () => responseDialog(app, S))].filter(Boolean),
    ),
  ];

  // ---------------------------------------------------------- before sending
  const n = t && !t.binary && app.view ? viciosOf(app.view.state).length : 0;
  const before = [
    row('edit', 'Vícios de escrita', n ? `${n} no arquivo aberto (${basename(t.path)}).` : `Nada no arquivo aberto (${basename(t.path)}).`, [btn('Relatório do documento', () => app.tools.viciosReport(app, S), !!n)], { cls: n ? 'open' : '' }),
    row('book', 'Referências', 'Ano, periódico, páginas e DOI conferidos no Crossref.', [btn('Verificar', () => app.sidebar.show('refs'))]),
    row('eye', 'Checar antes de submeter', 'Anonimato (double-blind), caminhos com o seu usuário e fontes Type 3 no PDF.', [btn('Checar', () => app.tools.blindCheck(app, S))]),
    (() => {
      const it = S.repl && S.repl.root === S.project.root ? replicationItems(S) : null;
      return row(
        'papers',
        'Pacote de replicação',
        it ? (it.pending ? `${it.pending} pendência${it.pending > 1 ? 's' : ''} · ${it.j.name}` : `Tudo certo pelo que dá para conferir · ${it.j.name}`) : 'README, código, seeds, caminhos e dados conferidos contra o padrão das revistas (DCAS), com o que cada uma pede.',
        [btn(it ? 'Ver checklist' : 'Conferir', () => app.bottom.show('replicacao'), !!(it && it.pending))],
        { cls: it && it.pending ? 'open' : '' },
      );
    })(),
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
      section('coautores', 'Coautores', coauthors),
      section('pareceristas', 'Pareceristas', referees),
      section('enviar', 'Antes de enviar', before),
    ),
  );
}

// A section of the tab that folds; the fold is remembered per section. The
// header counts the rows that ask for attention, so a folded section still
// says whether something is waiting.
const FOLD_KEY = 'texugo-revisao-folded';
function folded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function section(id, label, rows) {
  const list = [rows].flat(Infinity).filter(Boolean);
  const open = list.filter((r) => r.classList && r.classList.contains('open')).length;
  const d = h('details', { class: 'rev-sec', open: !folded().has(id) }, h('summary', { class: 'section-label' }, label, open ? h('span', { class: 'badge' }, String(open)) : null), ...list);
  d.addEventListener('toggle', () => {
    const f = folded();
    if (d.open) f.delete(id);
    else f.add(id);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify([...f]));
    } catch {}
  });
  return d;
}
