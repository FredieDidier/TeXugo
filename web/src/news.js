// "Novidades desde a sua última visita": what each coauthor committed since
// you last looked, down to the sections of the paper they touched, plus what
// is on the remote and not yet pulled. Lives in the "Novidades" tab of the
// bottom panel; the Revisão view shows the summary, and opening the project
// says so in a toast when there is something new.
//
// Looking is what moves the mark: the panel pins the baseline it showed
// (so refreshing it keeps the same news) and tells the server it was seen.
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast } from './dom.js';
import { authorColor, initials, diffModal } from './blame.js';

const dateBR = (iso, withTime) => {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return withTime ? `${day} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : day;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sectionName = (s) => s || 'início do arquivo';

// The paper as a PDF with the changes from `from` to `to` marked (latexdiff),
// built from Git: works before the pull, with nothing changed here.
async function pdfDiff(app, S, from, to, btn) {
  const t = app.activeTab();
  const doc = t && t.root;
  if (!doc) return toast('Abra um arquivo do paper para ver as mudanças no PDF.', 'warn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Montando o PDF…';
  try {
    const r = await call('compareBuild', { doc, source: { kind: 'git', rev: from, label: from }, target: { kind: 'git', rev: to } });
    if (r.same) toast('Nenhuma mudança no texto deste documento.', 'info');
    else toast(`${r.added + r.deleted} trechos mudaram (${r.changedFiles.join(', ') || basename(doc)}): azul entrou, vermelho riscado saiu.`, 'ok', 8000);
    app.openPdf(r.pdf, { activate: true });
  } catch (err) {
    toast(err.message, 'error', 10000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Fetches the news. since: 'visit' | 7 | 30. Keeps the pinned base.
export async function loadNews(app, S, { since } = {}) {
  if (!S.project || !S.git || !S.git.repo) return (S.news = null);
  const prev = S.news && S.news.root === S.project.root ? S.news : null;
  since = since || (prev && prev.since) || 'visit';
  const base = since === 'visit' && prev && prev.pinned ? prev.pinned : null;
  try {
    const data = await call('gitNews', { root: S.project.root, since, base });
    S.news = { root: S.project.root, since, data, pinned: base, shownBaseline: base && prev.shownBaseline ? prev.shownBaseline : data.baseline };
  } catch (err) {
    S.news = { root: S.project.root, since, error: err.message };
  }
  return S.news;
}

// One line for the Revisão view and the toast: "Bruno: 3 commits (Introdução,
// Dados) · Carla: 1 commit".
export function summary(n) {
  if (!n || !n.data || !n.data.authors) return null;
  const parts = n.data.authors.map((a) => {
    const secs = [...new Set(a.files.flatMap((f) => f.sections || []).filter(Boolean))];
    return `${a.name.split(' ')[0]}: ${plural(a.commits.length, 'commit', 'commits')}${secs.length ? ` (${secs.slice(0, 2).join(', ')}${secs.length > 2 ? '…' : ''})` : ''}`;
  });
  return parts.join(' · ');
}

// On opening a project: ask the remote quietly, then say if there is news.
export async function checkOnOpen(app, S) {
  const root = S.project && S.project.root;
  if (!root || !S.git || !S.git.repo) return;
  S.news = null;
  if (S.git.remote) {
    await call('gitFetch', { root }).catch(() => {});
    if (!S.project || S.project.root !== root) return;
    await app.refreshGit();
  }
  const n = await loadNews(app, S, { since: 'visit' });
  if (!S.project || S.project.root !== root || !n || !n.data) return;
  app.refreshRevisao && app.refreshRevisao();
  app.bottom.renderTabsOnly && app.bottom.render();
  const d = n.data;
  if (!d.count && !d.remoteCount) return;
  const msg = h(
    'div',
    {},
    h('b', {}, 'Novidades desde a sua última visita'),
    h('div', {}, d.count ? summary(n) : `${plural(d.remoteCount, 'commit novo', 'commits novos')} no remoto, ainda não baixado${d.remoteCount > 1 ? 's' : ''}.`),
    h('a', { href: '#', class: 'toast-link', onclick: (e) => (e.preventDefault(), app.bottom.show('novidades')) }, 'Ver o que mudou'),
  );
  toast(msg, 'info', 12000);
}

// Count shown on the bottom tab.
export function newsCount(S) {
  const d = S.news && S.news.data;
  return d ? (d.count || 0) + (d.remoteCount || 0) : 0;
}

export async function renderNewsPanel(app, S, el) {
  const root = S.project && S.project.root;
  if (!root) return clear(el, h('div', { class: 'pad faint' }, 'Abra um projeto.'));
  if (!S.git || !S.git.repo) return clear(el, h('div', { class: 'pad muted' }, 'Este projeto não está no Git. As novidades dos coautores vêm dos commits deles.'));
  if (!S.news || S.news.root !== root) {
    clear(el, h('div', { class: 'pad faint' }, h('span', { class: 'status-dot building' }), ' Lendo os commits…'));
    await loadNews(app, S);
  }
  const n = S.news;
  if (n.error) return clear(el, h('div', { class: 'pad' }, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, n.error))));
  const d = n.data;

  // Seen: pin what is shown, move the mark to HEAD.
  if (n.since === 'visit' && !n.pinned && d.baseline && d.baseline.hash && d.count) {
    n.pinned = d.baseline.hash;
    n.shownBaseline = d.baseline;
    call('gitMarkSeen', { root, hash: d.head }).catch(() => {});
  }

  const period = h(
    'select',
    {
      class: 'sm',
      onchange: async (e) => {
        const v = e.target.value;
        await loadNews(app, S, { since: v === 'visit' ? 'visit' : Number(v) });
        renderNewsPanel(app, S, el);
      },
    },
    h('option', { value: 'visit', selected: n.since === 'visit' }, 'Desde a sua última visita'),
    h('option', { value: '7', selected: n.since === 7 }, 'Últimos 7 dias'),
    h('option', { value: '30', selected: n.since === 30 }, 'Últimos 30 dias'),
  );
  const fetchBtn = S.git.remote
    ? h(
        'button',
        {
          class: 'btn sm',
          title: 'Pergunta ao remoto (GitHub) se chegou algo, sem mudar nada aqui',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            const r = await call('gitFetch', { root });
            if (r.code !== 0) toast((r.stderr || '').trim().split('\n').slice(-2).join(' ') || 'Não deu para falar com o remoto.', 'error', 9000);
            await app.refreshGit();
            await loadNews(app, S);
            renderNewsPanel(app, S, el);
            app.refreshRevisao && app.refreshRevisao();
          },
        },
        icon('refresh'),
        'Buscar no remoto',
      )
    : null;
  const b = n.shownBaseline || d.baseline;
  const sinceText =
    n.since === 'visit'
      ? d.firstVisit
        ? 'Primeira visita: daqui em diante o TeXugo anota o que os coautores mudam entre uma visita e outra. Para ver o que já houve, escolha os últimos 7 ou 30 dias.'
        : b && b.at
          ? `Desde a sua visita de ${dateBR(b.at, true)}.`
          : b && b.date
            ? `Desde o commit de ${dateBR(b.date, true)}.`
            : ''
      : '';
  const visitFrom = n.since === 'visit' && (n.shownBaseline || d.baseline) && (n.shownBaseline || d.baseline).hash;
  const pdfBtn = d.count && visitFrom ? h('button', { class: 'btn sm', title: 'O paper com tudo o que mudou desde a sua visita marcado', onclick: (e) => pdfDiff(app, S, visitFrom, 'HEAD', e.currentTarget) }, icon('pdf'), 'Ver no PDF') : null;
  const head = h('div', { class: 'news-head' }, period, fetchBtn, pdfBtn, h('span', { class: 'faint news-since' }, sinceText));

  const from = n.since === 'visit' && b && b.hash ? b.hash : null;
  const blocks = [];
  if (d.remoteCount) {
    blocks.push(
      h(
        'div',
        { class: 'news-remote' },
        icon('down'),
        h('div', { style: { flex: 1 } }, h('b', {}, `${plural(d.remoteCount, 'commit', 'commits')} no remoto, ainda não baixado${d.remoteCount > 1 ? 's' : ''}`), h('div', { class: 'faint' }, d.remote.map((a) => `${a.name} (${a.commits.length})`).join(' · '))),
        h(
          'button',
          {
            class: 'btn sm primary',
            onclick: async () => {
              const r = await call('gitPull', { root });
              if (r.code === 0) toast('Pull: ok.', 'ok');
              else toast((r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' '), 'error', 9000);
              await app.refreshGit();
              await loadNews(app, S);
              renderNewsPanel(app, S, el);
              app.refreshRevisao && app.refreshRevisao();
            },
          },
          'Baixar (pull)',
        ),
        h('button', { class: 'btn sm', title: 'O paper com o que chegou no remoto marcado, antes de baixar', onclick: (e) => pdfDiff(app, S, 'HEAD', '@{u}', e.currentTarget) }, icon('pdf'), 'Ver no PDF'),
      ),
    );
    for (const a of d.remote) blocks.push(authorBlock(app, S, a, { remote: true }));
  }
  if (d.count) for (const a of d.authors) blocks.push(authorBlock(app, S, a, { from }));
  else if (!d.remoteCount && !(n.since === 'visit' && d.firstVisit))
    blocks.push(h('div', { class: 'pad muted' }, n.since === 'visit' ? 'Nada novo dos coautores desde a sua última visita.' : 'Nenhum commit dos coautores nesse período.'));

  clear(el, h('div', { class: 'news' }, head, blocks));
}

function authorBlock(app, S, a, { from, remote } = {}) {
  const root = S.project.root;
  const color = authorColor({ author: a.name, email: a.email });
  const fileRow = (f) =>
    h(
      'div',
      { class: 'news-file' },
      h('span', { class: 'news-fname click', title: 'Abrir', onclick: () => app.openFile(f.path) }, icon('file'), relPath(root, f.path)),
      h('span', { class: 'news-delta' }, h('span', { class: 'add' }, `+${f.add}`), ' ', h('span', { class: 'del' }, `−${f.del}`)),
      (f.sections || []).length
        ? h(
            'span',
            { class: 'news-secs' },
            f.sections.map((s) =>
              h('button', { class: 'chip click', title: s ? 'Ir para a seção' : 'Ir para o início do arquivo', onclick: () => app.openFile(f.path, { line: (f.lines && s && f.lines[s]) || 1 }) }, sectionName(s)),
            ),
          )
        : null,
      remote
        ? h('button', { class: 'btn sm ghost', title: 'O que chegou no remoto para este arquivo, antes de baixar', onclick: async () => diffModal(`O que chegou em ${basename(f.path)}`, await call('gitNewsDiff', { root, from: 'HEAD', to: '@{u}', path: f.path }), () => app.openFile(f.path)) }, 'Ver mudanças')
        : from
          ? h(
              'button',
              { class: 'btn sm ghost', title: 'Tudo o que mudou neste arquivo desde a sua visita (de todos, inclusive você)', onclick: async () => diffModal(`O que mudou em ${basename(f.path)}`, await call('gitNewsDiff', { root, from, path: f.path }), () => app.openFile(f.path)) },
              'Ver mudanças',
            )
          : null,
    );
  const commitRow = (c) =>
    h(
      'div',
      { class: 'news-commit click', title: 'Ver o commit', onclick: async () => diffModal(`${c.short} · ${c.author}`, await call('gitShow', { root, rev: c.hash }), null) },
      h('span', { class: 'k' }, c.short),
      h('span', { class: 'faint' }, dateBR(c.date, true)),
      h('span', { class: 't' }, c.subject),
    );
  const commits = h('div', { class: 'news-commits hidden' }, a.commits.map(commitRow));
  return h(
    'div',
    { class: 'news-author' + (remote ? ' remote' : '') },
    h(
      'div',
      { class: 'news-who' },
      h('span', { class: 'news-avatar', style: { '--c': color } }, initials(a.name)),
      h('b', {}, a.name),
      h('span', { class: 'faint' }, `${plural(a.commits.length, 'commit', 'commits')} · `, h('span', { class: 'add' }, `+${a.add}`), ' ', h('span', { class: 'del' }, `−${a.del}`), ' linhas'),
      h('button', { class: 'btn sm ghost', onclick: (e) => (commits.classList.toggle('hidden'), (e.currentTarget.textContent = commits.classList.contains('hidden') ? 'Ver commits' : 'Esconder commits')) }, 'Ver commits'),
    ),
    a.files.map(fileRow),
    commits,
  );
}
