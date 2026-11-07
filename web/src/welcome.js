// Welcome screen and the "new project from template" dialog.
import { call, native } from './api.js';
import { h, clear, icon, wordmark, toast, modal } from './dom.js';

export async function showWelcome(app, S) {
  document.querySelector('.welcome')?.remove();
  let templates = [];
  try {
    templates = await call('templates');
  } catch {}
  const recents = (S.hello.recents || []).slice(0, 8);
  const t = S.hello.tools || {};
  const el = h(
    'div',
    { class: 'welcome' },
    h(
      'div',
      { class: 'welcome-inner' },
      h(
        'div',
        { class: 'hero' },
        h('img', { src: './logo.svg', alt: '' }),
        h('div', {}, h('h1', {}, wordmark()), h('p', {}, 'O bicho que cava até achar a referência. Zero ?? no seu PDF.')),
        S.project ? h('button', { class: 'btn', style: { marginLeft: 'auto' }, onclick: () => el.remove() }, icon('x'), 'Voltar ao projeto') : null,
      ),
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          {},
          h('h3', {}, 'Começar algo novo'),
          h(
            'div',
            { class: 'tpl-grid' },
            templates.map((tp) =>
              h('div', { class: 'tpl', onclick: () => newProjectDialog(app, S, tp) }, h('div', { class: 'n' }, icon(tp.icon), tp.name), h('div', { class: 'd' }, tp.description)),
            ),
          ),
        ),
        h(
          'div',
          {},
          h('h3', {}, 'Abrir'),
          h('button', { class: 'btn primary', style: { marginBottom: '14px' }, onclick: () => app.pickAndOpen() }, icon('folderOpen'), 'Abrir pasta…'),
          recents.length ? h('h3', { style: { marginTop: '8px' } }, 'Recentes') : null,
          recents.map((r) =>
            h(
              'div',
              { class: 'recent', onclick: () => app.openProject(r), title: r },
              icon('folder'),
              h('div', { style: { minWidth: 0 } }, h('div', {}, r.split('/').pop()), h('div', { class: 'p' }, r.replace(S.hello.home, '~'))),
              h(
                'button',
                {
                  class: 'icon-btn x',
                  title: 'Tirar da lista',
                  onclick: async (e) => {
                    e.stopPropagation();
                    S.hello.recents = await call('forgetRecent', { root: r });
                    showWelcome(app, S);
                  },
                },
                icon('x'),
              ),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'tools-check' },
        ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'synctex', 'git'].map((k) => h('span', { class: 'chip ' + (t[k] ? 'ok' : 'error'), title: t[k] || 'não encontrado' }, t[k] ? icon('check') : icon('x'), k)),
        S.hello.tex ? h('span', { class: 'faint', style: { alignSelf: 'center', marginLeft: '6px' } }, S.hello.tex) : h('span', { style: { color: 'var(--err)' } }, 'TeX Live não encontrado: instale o MacTeX.'),
      ),
    ),
  );
  document.body.append(el);
}

export async function newProjectDialog(app, S, tpl) {
  let templates = [];
  try {
    templates = await call('templates');
  } catch {}
  let chosen = tpl || templates[0];
  const defaultParent = S.project ? S.project.root.split('/').slice(0, -1).join('/') : (S.hello.home || '') + '/Documents';
  const title = h('input', { placeholder: 'Ex.: Darker Evenings' });
  const author = h('input', { value: S.settings.author || '', placeholder: 'Seu nome' });
  const inst = h('input', { value: S.settings.institution || '', placeholder: 'Instituição' });
  const parent = h('input', { value: S.settings.lastParent || defaultParent });
  const folder = h('input', { placeholder: 'nome-da-pasta' });
  title.addEventListener('input', () => {
    if (!folder.dataset.touched) folder.value = slug(title.value) || '';
  });
  folder.addEventListener('input', () => (folder.dataset.touched = '1'));
  const grid = h('div', { class: 'tpl-grid', style: { marginBottom: '14px' } });
  const renderGrid = () =>
    clear(
      grid,
      templates.map((tp) =>
        h(
          'div',
          { class: 'tpl', style: tp.id === chosen.id ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--sel)' } : {}, onclick: () => ((chosen = tp), renderGrid()) },
          h('div', { class: 'n' }, icon(tp.icon), tp.name),
          h('div', { class: 'd' }, tp.description),
        ),
      ),
    );
  renderGrid();
  const create = async () => {
    const name = folder.value.trim() || slug(title.value);
    if (!name) return toast('Dê um nome à pasta.', 'warn');
    S.settings.author = author.value;
    S.settings.institution = inst.value;
    S.settings.lastParent = parent.value;
    app.saveSettingsSoon();
    try {
      const p = await call('createProject', { template: chosen.id, parent: parent.value, name, fields: { title: title.value || 'Título', author: author.value, institution: inst.value } });
      m.close();
      document.querySelector('.welcome')?.remove();
      await app.openProject(p.root);
      toast(`Projeto criado em ${p.root}`, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const m = modal({
    title: 'Novo projeto',
    wide: true,
    body: h(
      'div',
      {},
      grid,
      h('div', { class: 'field' }, h('label', {}, 'Título'), title),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, h('div', { class: 'field' }, h('label', {}, 'Autor'), author), h('div', { class: 'field' }, h('label', {}, 'Instituição'), inst)),
      h(
        'div',
        { class: 'field' },
        h('label', {}, 'Onde criar'),
        h(
          'div',
          { class: 'row' },
          parent,
          native
            ? h(
                'button',
                {
                  class: 'btn',
                  onclick: async () => {
                    const p = await native.pickFolder();
                    if (p) parent.value = p;
                  },
                },
                'Escolher…',
              )
            : null,
        ),
      ),
      h('div', { class: 'field' }, h('label', {}, 'Nome da pasta'), folder),
    ),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'Criar projeto')],
  });
  setTimeout(() => title.focus(), 0);
}

function slug(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
