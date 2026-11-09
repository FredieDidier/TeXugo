// "Comparar com outra versão": pick a version a coauthor sent (.tex, ZIP,
// folder) or a Git commit; TeXugo builds a PDF with the changes marked
// (latexdiff) and opens it beside the paper.
import { call, native } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal } from './dom.js';

export async function compareDialog(app, S) {
  const t = app.activeTab();
  const doc = t && t.root;
  if (!doc) return toast('Abra um arquivo que pertença a um documento.', 'warn');

  let kind = 'path';
  const pathIn = h('input', { placeholder: 'Arquivo .tex, .zip (exportado do Overleaf) ou pasta', style: { flex: 1 }, value: S.settings.lastCompare || '' });
  const pick = native && native.pickVersion
    ? h('button', { class: 'btn', onclick: async () => { const p = await native.pickVersion(); if (p) pathIn.value = p; } }, 'Escolher…')
    : null;
  const commitSel = h('select', { style: { width: '100%' } }, h('option', {}, 'Carregando…'));
  let commits = [];
  call('gitLog', { root: S.project.root, path: doc })
    .then((log) => {
      commits = log || [];
      clear(
        commitSel,
        commits.length
          ? commits.map((c, i) => h('option', { value: c.hash }, `${c.date.slice(0, 10)} · ${c.author} · ${c.subject.slice(0, 70)}${i === 0 ? ' (último commit)' : ''}`))
          : h('option', { value: '' }, 'Nenhum commit com este documento'),
      );
    })
    .catch(() => clear(commitSel, h('option', { value: '' }, 'Esta pasta não está no Git')));

  const panePath = h('div', { class: 'field' }, h('label', {}, 'Versão recebida (do coautor, do Overleaf, do e-mail)'), h('div', { class: 'row' }, pathIn, pick), h('p', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, 'Arquivos que a versão recebida não traz (tabelas geradas, figuras, seções que ninguém mexeu) contam como iguais aos seus.'));
  const paneGit = h('div', { class: 'field', style: { display: 'none' } }, h('label', {}, 'Comparar com o commit'), commitSel, h('p', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, 'Mostra o que mudou do commit escolhido até o texto atual (salvo).'));
  const tabBtn = (id, label) =>
    h('button', {
      class: 'btn sm' + (kind === id ? ' primary' : ''),
      'data-k': id,
      onclick: () => {
        kind = id;
        panePath.style.display = id === 'path' ? '' : 'none';
        paneGit.style.display = id === 'git' ? '' : 'none';
        tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b.dataset.k === id));
      },
    }, label);
  const tabs = h('div', { class: 'row', style: { gap: '6px', marginBottom: '12px' } }, tabBtn('path', 'Versão recebida'), tabBtn('git', 'Versão do Git'));
  const status = h('div');
  const go = h('button', { class: 'btn primary' }, icon('play'), 'Gerar PDF com mudanças');

  go.onclick = async () => {
    let source;
    if (kind === 'path') {
      const p = pathIn.value.trim();
      if (!p) return toast('Escolha o arquivo, o ZIP ou a pasta recebida.', 'warn');
      source = { kind: 'path', path: p };
      S.settings.lastCompare = p;
      app.saveSettingsSoon();
    } else {
      const c = commits.find((x) => x.hash === commitSel.value);
      if (!c) return toast('Escolha um commit.', 'warn');
      source = { kind: 'git', rev: c.hash, label: `commit ${c.hash} (${c.date.slice(0, 10)})` };
    }
    // Compare what is on disk: save the open files of this project first.
    if (app.saveAll) await app.saveAll();
    go.disabled = true;
    clear(status, h('p', { class: 'faint' }, h('span', { class: 'status-dot building' }), ' Comparando e compilando o PDF com as mudanças… (leva o tempo de uma compilação)'));
    try {
      const r = await call('compareBuild', { doc, source });
      m.close();
      app.openPdf(r.pdf, { activate: true });
      resultDialog(app, S, doc, r);
      app.refreshRevisao && app.refreshRevisao();
    } catch (err) {
      clear(status, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, err.message)));
    } finally {
      go.disabled = false;
    }
  };

  const m = modal({
    title: [icon('columns'), ` Comparar ${basename(doc)} com outra versão`],
    wide: true,
    body: h('div', {}, tabs, panePath, paneGit, status),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), go],
  });
}

function resultDialog(app, S, doc, r) {
  const rel = (f) => f.replace(/^\.\.\//, '…/');
  const m = modal({
    title: [icon('check'), ' PDF com as mudanças marcadas'],
    body: h(
      'div',
      {},
      r.same
        ? h('p', {}, `Nenhuma diferença no texto entre ${r.label} e a versão atual.`)
        : h('p', {}, `Comparado com ${r.label}: `, h('b', { style: { color: 'var(--info)' } }, `${r.added} trecho${r.added === 1 ? '' : 's'} novo${r.added === 1 ? '' : 's'}`), ' (sublinhados em azul) e ', h('b', { style: { color: 'var(--err)' } }, `${r.deleted} apagado${r.deleted === 1 ? '' : 's'}`), ' (riscados em vermelho). O PDF abriu numa aba ao lado.'),
      r.changedFiles.length ? h('p', {}, 'Arquivos com mudanças: ', h('span', { style: { fontFamily: 'var(--mono)', fontSize: '12px' } }, r.changedFiles.map(rel).join(', '))) : null,
      r.fromCurrent.length && !/^commit /.test(r.label)
        ? h('p', { class: 'faint', style: { fontSize: '12px' } }, `${r.fromCurrent.length} arquivo${r.fromCurrent.length === 1 ? '' : 's'} que a versão recebida não trazia (como ${rel(r.fromCurrent[0])}) foi considerado igual ao seu.`)
        : null,
      h('p', { class: 'faint', style: { fontSize: '12px' } }, 'Fica em .texugo/diff, fora do Git. Citações que só existem no texto apagado podem aparecer como (?).'),
    ),
    footer: [
      h('button', { class: 'btn', onclick: () => call('reveal', { path: r.pdf }) }, 'Mostrar no Finder'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            try {
              const p = await call('compareSave', { doc, pdf: r.pdf });
              toast(`Salvo: ${relPath(S.project.root, p)}`, 'ok');
              m.close();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        icon('down'),
        'Salvar ao lado do documento',
      ),
    ],
  });
}
