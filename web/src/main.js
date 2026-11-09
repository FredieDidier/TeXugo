// TeXugo UI entry point: layout, tabs, compile flow, PDF panes, problems.
import { call, connect, on, fileUrl, native } from './api.js';
import { h, clear, icon, wordmark, fileIcon, fileKind, basename, relPath, debounce, toast, menu, modal, prompt, confirmBox, gutter } from './dom.js';
import { createState, createView, jumpTo, showDiagnostics, symbols, EditorView, wrapCompartment } from './editor.js';
import { PdfTab } from './pdfview.js';
import { Sidebar } from './sidebar.js';
import { BottomPanel } from './bottom.js';
import { showWelcome, newProjectDialog } from './welcome.js';
import { openPalette } from './palette.js';
import { openSettings, applyTheme } from './settings.js';
import * as tools from './tools.js';
import { renderMarkdown } from './markdown.js';
import { bootPdfWindow } from './pdfwin.js';
import { TOKEN } from './api.js';

export const S = {
  hello: null,
  project: null,
  tabs: [],
  active: null,
  pdfTabs: [],
  activePdf: null,
  // doc path -> { status, steps, pass, reason, result }
  docState: new Map(),
  logs: new Map(),
  building: null, // { id, order, requested }
  queued: false,
  lastSummary: null,
  settings: { theme: 'system', editorSize: 13.5, wrap: true, autoCompile: false, invertPdf: false, sidebarWidth: 260, pdfWidth: null, bottomHeight: 230, bottomOpen: true, reopenLast: true },
  cursor: { line: 1, col: 1, words: 0 },
  detached: new Set(), // PDFs shown in their own window
};

const app = {};
export default app;

// ---------------------------------------------------------------- layout
function buildLayout() {
  const root = document.getElementById('app');
  app.topbar = h('div', { class: 'topbar' + (native ? '' : ' browser') });
  app.activity = h('div', { class: 'activitybar' });
  app.sidebarEl = h('div', { class: 'sidebar' });
  app.tabsEl = h('div', { class: 'tabs' });
  app.docBar = h('div', { class: 'doc-bar' });
  app.editorHost = h('div', { class: 'editor-host' });
  app.editorGroup = h('div', { class: 'editor-group' }, app.tabsEl, app.docBar, app.editorHost);
  app.pdfTabsEl = h('div', { class: 'tabs' });
  app.pdfTools = h('div', { class: 'pdf-tools' });
  app.pdfStack = h('div', { class: 'pdf-stack' });
  app.pdfGroup = h('div', { class: 'pdf-group' }, app.pdfTabsEl, app.pdfTools, app.pdfStack);
  app.bottomEl = h('div', { class: 'bottom' });
  app.statusEl = h('div', { class: 'statusbar' });

  const pdfGutter = gutter('v', {
    getSize: () => app.pdfGroup.getBoundingClientRect().width,
    setSize: (w) => {
      S.settings.pdfWidth = Math.max(240, Math.min(w, innerWidth - 500));
      app.pdfGroup.style.width = S.settings.pdfWidth + 'px';
      saveSettingsSoon();
    },
    invert: true,
  });
  const sideGutter = gutter('v', {
    getSize: () => app.sidebarEl.getBoundingClientRect().width,
    setSize: (w) => {
      S.settings.sidebarWidth = Math.max(160, Math.min(w, 600));
      app.sidebarEl.style.width = S.settings.sidebarWidth + 'px';
      saveSettingsSoon();
    },
  });
  const bottomGutter = gutter('h', {
    getSize: () => app.bottomEl.getBoundingClientRect().height,
    setSize: (v) => {
      S.settings.bottomHeight = Math.max(90, Math.min(v, innerHeight - 200));
      app.bottomEl.style.height = S.settings.bottomHeight + 'px';
      saveSettingsSoon();
    },
    invert: true,
  });
  app.bottomGutter = bottomGutter;
  app.sideGutter = sideGutter;
  app.pdfGutter = pdfGutter;
  app.panes = h('div', { class: 'panes' }, app.editorGroup, pdfGutter, app.pdfGroup);
  app.workspace = h('div', { class: 'workspace' }, app.panes, bottomGutter, app.bottomEl);
  root.append(app.topbar, h('div', { class: 'main' }, app.activity, app.sidebarEl, sideGutter, app.workspace), app.statusEl);

  app.view = createView(app.editorHost);
  app.emptyEditor = h('div', { class: 'empty-editor' });
  app.binaryView = h('div', { class: 'binary-view hidden' });
  app.mdView = h('div', { class: 'md-view hidden' }, (app.mdBody = h('article', { class: 'markdown-body' })));
  app.editorHost.append(app.emptyEditor, app.binaryView, app.mdView);
  app.sidebar = new Sidebar(app, S);
  app.bottom = new BottomPanel(app, S);
  applyLayoutSizes();
}

function applyLayoutSizes() {
  app.sidebarEl.style.width = S.settings.sidebarWidth + 'px';
  if (S.settings.pdfWidth) app.pdfGroup.style.width = S.settings.pdfWidth + 'px';
  app.bottomEl.style.height = S.settings.bottomHeight + 'px';
  app.bottomEl.classList.toggle('hidden', !S.settings.bottomOpen);
  app.bottomGutter.classList.toggle('hidden', !S.settings.bottomOpen);
  app.sidebarEl.classList.toggle('hidden', !!S.settings.sidebarHidden);
  app.sideGutter.classList.toggle('hidden', !!S.settings.sidebarHidden);
  const st = document.documentElement.style;
  st.setProperty('--editor-size', S.settings.editorSize + 'px');
  st.setProperty('--editor-lh', String(S.settings.editorLineHeight || 1.6));
  if (S.settings.editorFont) st.setProperty('--editor-font', `'${S.settings.editorFont}', var(--mono)`);
  else st.removeProperty('--editor-font');
  st.setProperty('--md-size', (S.settings.mdSize || 15) + 'px');
  st.setProperty('--md-lh', String(S.settings.mdLineHeight || 1.65));
  const mdFonts = { sans: 'var(--ui)', serif: "'Iowan Old Style', 'Palatino', Georgia, serif", mono: 'var(--mono)' };
  st.setProperty('--md-font', mdFonts[S.settings.mdFont || 'sans']);
}
app.applyLayoutSizes = applyLayoutSizes;

const saveSettingsSoon = debounce(() => call('saveSettings', { settings: S.settings }).catch(() => {}), 600);
app.saveSettingsSoon = saveSettingsSoon;

function renderTopbar() {
  const p = S.project;
  const anyBuilding = !!S.building;
  const openRoots = allOpenRoots();
  clear(
    app.topbar,
    h('div', { class: 'brand' }, h('img', { src: './logo.svg', alt: '' }), wordmark()),
    p ? h('span', { class: 'project-name' }, '·  ' + p.name) : null,
    h('div', { class: 'spacer' }),
    p ? h('div', { class: 'quick', onclick: () => openPalette(app, S, 'files') }, icon('search'), h('span', {}, 'Buscar arquivo ou comando'), h('kbd', {}, '⌘K')) : null,
    h('div', { class: 'spacer' }),
    anyBuilding ? h('div', { class: 'build-indicator' }, h('span', { class: 'status-dot building' }), 'Compilando ', h('b', {}, basename(currentBuildDoc() || '')), S.queued ? ' · +fila' : '') : null,
    p
      ? anyBuilding
        ? h('button', { class: 'btn', onclick: () => call('cancelBuild'), title: 'Parar a compilação' }, icon('stop'), 'Parar')
        : h(
            'div',
            { class: 'tip-wrap' },
            h(
              'button',
              { class: 'btn', onclick: () => compileAll(), disabled: !openRoots.length },
              icon('playAll'),
              openRoots.length > 1 ? `Compilar os ${openRoots.length} documentos` : 'Compilar tudo',
            ),
            // In-app hover card: what this button will compile, and why
            // a tab may not count as a document of its own.
            h(
              'div',
              { class: 'tip-card' },
              h('div', { class: 'tip-title' }, 'Vai compilar ', h('kbd', {}, '⌘⇧↵')),
              openRoots.length
                ? openRoots.map((d) => {
                    const tabs = S.tabs.filter((t) => t.root === d && t.path !== d).map((t) => t.name);
                    return h('div', { class: 'tip-row' }, icon('tex'), h('b', {}, relPath(S.project.root, d)), tabs.length ? h('span', { class: 'faint' }, ` inclui ${tabs.join(', ')}`) : null);
                  })
                : h('div', { class: 'faint' }, 'Nenhuma aba aberta pertence a um documento.'),
              h('div', { class: 'tip-foot' }, 'Um documento é o .tex que vira PDF. Abas que entram nele (como sections/body.tex) não contam de novo.'),
            ),
          )
      : null,
    h('button', { class: 'icon-btn', title: 'Tema claro/escuro', onclick: cycleTheme }, icon(isDark() ? 'sun' : 'moon')),
    h('button', { class: 'icon-btn', title: 'Preferências (⌘,)', onclick: () => openSettings(app, S) }, icon('gear')),
  );
}
app.renderTopbar = renderTopbar;

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function cycleTheme() {
  S.settings.theme = isDark() ? 'light' : 'dark';
  applyTheme(S.settings.theme);
  saveSettingsSoon();
  renderTopbar();
}

function currentBuildDoc() {
  for (const [doc, st] of S.docState) if (st.status === 'building' && st.current) return doc;
  return S.building ? S.building.order[0] : null;
}

// ---------------------------------------------------------------- tabs
function tabByPath(p) {
  return S.tabs.find((t) => t.path === p);
}
function activeTab() {
  return tabByPath(S.active);
}
app.activeTab = activeTab;

// Hooks hold the tab object, not its path, so they keep working after the
// file is renamed.
const editorHooks = (t) => ({
  save: () => saveTab(t),
  compile: () => compileTab(t),
  compileAll: () => compileAll(),
  syncForward: () => syncForward(),
  format: () => tools.formatDoc(app, S),
  onChange: () => {
    if (!t.dirty) {
      t.dirty = true;
      renderTabs();
      app.sidebar.renderIfFiles();
    }
    t.version = (t.version || 0) + 1;
    countWordsSoon();
    if (isMd(t) && t.mdMode === 'split') mdRenderSoon();
  },
  onCursor: (state) => {
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    S.cursor.line = line.number;
    S.cursor.col = pos - line.from + 1;
    renderStatusSoon();
    app.sidebar.cursorMoved && app.sidebar.cursorMoved(line.number);
    if (S.settings.followCursor) followSoon();
  },
});

export async function openFile(path, { line, col, focus = true, preview = false } = {}) {
  let t = tabByPath(path);
  const kind = fileKind(path);
  if (kind === 'pdf') {
    openPdf(path, { activate: true });
    return;
  }
  if (!t) {
    let data;
    try {
      data = await call('read', { path });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    t = { path, name: basename(path), kind, dirty: false, mtime: data.mtime, binary: data.binary || kind === 'image', roots: [], root: null, autoCompile: S.settings.autoCompile };
    if (!t.binary) t.state = createState(data.text, path, editorHooks(t), S.settings);
    const idx = S.tabs.findIndex((x) => x.path === S.active);
    S.tabs.splice(idx >= 0 ? idx + 1 : S.tabs.length, 0, t);
    refreshRoots(t);
  }
  activate(path);
  if (line && !t.binary) jumpTo(app.view, line, col || 0);
  else if (focus && !t.binary) app.view.focus();
  saveUiSoon();
}
app.openFile = openFile;

async function refreshRoots(t) {
  if (!t || !S.project) return;
  if (!/\.(tex|bib)$/.test(t.path)) {
    t.roots = [];
    renderDocBar();
    return;
  }
  try {
    t.roots = await call('rootsFor', { root: S.project.root, path: t.path });
  } catch {
    t.roots = [];
  }
  const saved = S.savedRoots && S.savedRoots[t.path];
  if (!t.root || !t.roots.some((r) => r.path === t.root)) t.root = t.roots.some((r) => r.path === saved) ? saved : t.roots[0] ? t.roots[0].path : null;
  renderTabs();
  renderDocBar();
  renderTopbar();
}

function activate(path) {
  const prev = activeTab();
  if (prev && !prev.binary && prev.path !== path) prev.state = app.view.state;
  S.active = path;
  const t = activeTab();
  app.emptyEditor.classList.toggle('hidden', !!t);
  if (!t) {
    app.view.dom.classList.add('hidden');
    app.binaryView.classList.add('hidden');
    renderEmpty();
  } else if (t.binary) {
    app.view.dom.classList.add('hidden');
    clear(app.binaryView, t.kind === 'image' ? h('img', { src: fileUrl(t.path) }) : h('div', { class: 'muted' }, 'Arquivo binário: não dá para editar aqui.'));
    app.binaryView.classList.remove('hidden');
  } else {
    app.binaryView.classList.add('hidden');
    app.view.dom.classList.remove('hidden');
    if (app.view.state !== t.state) app.view.setState(t.state);
    applyDiagnostics();
  }
  applyMdMode();
  renderTabs();
  renderDocBar();
  app.sidebar.onActiveChanged();
  countWordsSoon();
  renderStatus();
  // Show the PDF of this tab's document if it is open.
  if (t && t.root) {
    const pdf = t.root.replace(/\.tex$/, '.pdf');
    if (S.pdfTabs.some((p) => p.path === pdf)) activatePdf(pdf);
  }
}
app.activate = activate;

async function closeTab(path) {
  const t = tabByPath(path);
  if (!t) return;
  if (t.dirty) {
    if (path === S.active) t.state = app.view.state;
    const choice = await new Promise((resolve) => {
      let done = false;
      const pick = (v) => {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const m = modal({
        title: 'Alterações não salvas',
        body: h('div', {}, `${t.name} tem alterações que ainda não foram salvas.`),
        footer: [
          h('button', { class: 'btn danger', onclick: () => pick('discard') }, 'Descartar'),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn', onclick: () => pick('cancel') }, 'Cancelar'),
          h('button', { class: 'btn primary', onclick: () => pick('save') }, 'Salvar e fechar'),
        ],
        onClose: () => pick('cancel'),
      });
    });
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await saveTab(t, { quiet: true }))) return;
  }
  const idx = S.tabs.indexOf(t);
  S.tabs.splice(idx, 1);
  if (S.active === path) {
    const next = S.tabs[idx] || S.tabs[idx - 1];
    S.active = null;
    activate(next ? next.path : null);
  } else renderTabs();
  renderTopbar();
  saveUiSoon();
}
app.closeTab = closeTab;

function renderTabs() {
  clear(
    app.tabsEl,
    S.tabs.map((t) => {
      const st = t.root ? docStatus(t.root) : null;
      const el = h(
        'div',
        {
          class: 'tab' + (t.path === S.active ? ' active' : '') + (t.dirty ? ' dirty' : ''),
          title: relPath(S.project ? S.project.root : '', t.path) + (t.root ? `\nDocumento: ${basename(t.root)}` : ''),
          draggable: 'true',
          onclick: () => activate(t.path),
          onauxclick: (e) => e.button === 1 && closeTab(t.path),
          oncontextmenu: (e) => {
            e.preventDefault();
            menu(e.clientX, e.clientY, [
              t.root ? { label: `Compilar ${basename(t.root)}`, icon: 'play', kb: '⌘↵', action: () => compileTab(t) } : null,
              { label: 'Fechar', icon: 'x', kb: '⌘W', action: () => closeTab(t.path) },
              { label: 'Fechar as outras', action: async () => { for (const x of S.tabs.filter((x) => x !== t)) await closeTab(x.path); } },
              'sep',
              { label: 'Mostrar no Finder', icon: 'folder', action: () => call('reveal', { path: t.path }) },
              { label: 'Copiar caminho', action: () => navigator.clipboard.writeText(t.path) },
            ]);
          },
        },
        h('span', { class: 'status-dot ' + (st || ''), title: statusLabel(st) }),
        h('span', { class: 'label' }, t.name),
        h('span', { class: 'close', onclick: (e) => (e.stopPropagation(), closeTab(t.path)) }, icon('x')),
      );
      el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/texugo-tab', t.path));
      el.addEventListener('dragover', (e) => (e.preventDefault(), el.classList.add('dragover')));
      el.addEventListener('dragleave', () => el.classList.remove('dragover'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('dragover');
        const from = e.dataTransfer.getData('text/texugo-tab');
        const a = S.tabs.findIndex((x) => x.path === from);
        if (a < 0 || from === t.path) return;
        const [moved] = S.tabs.splice(a, 1);
        S.tabs.splice(S.tabs.indexOf(t), 0, moved);
        renderTabs();
        saveUiSoon();
      });
      return el;
    }),
  );
  const act = app.tabsEl.querySelector('.tab.active');
  if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
app.renderTabs = renderTabs;

function statusLabel(st) {
  return { ok: 'Compilado: tudo certo', undefined: 'Compilado com ?? (referências indefinidas)', error: 'Erro na última compilação', building: 'Compilando…', warn: 'Compilado com avisos' }[st] || 'Ainda não compilado nesta sessão';
}

function docStatus(doc) {
  const st = S.docState.get(doc);
  if (!st) return null;
  if (st.status === 'building' || st.status === 'waiting') return 'building';
  return st.status;
}

// ---------------------------------------------------------------- markdown
const isMd = (t) => !!t && /\.(md|markdown)$/i.test(t.path);

// Markdown tabs show one of: rendered preview (default, like GitHub), the
// source, or both side by side with the preview updating as you type.
function applyMdMode() {
  const t = activeTab();
  const md = isMd(t) && !t.binary;
  const mode = md ? t.mdMode || 'preview' : 'edit';
  app.editorHost.classList.toggle('md-split', md && mode === 'split');
  app.mdView.classList.toggle('hidden', !md || mode === 'edit');
  if (md) app.view.dom.classList.toggle('hidden', mode === 'preview');
  if (md && mode !== 'edit') mdRender();
}
function mdRender() {
  const t = activeTab();
  if (!isMd(t)) return;
  const text = app.view.state.doc.toString();
  const top = app.mdView.scrollTop;
  renderMarkdown(app.mdBody, text, t.path, app);
  app.mdView.scrollTop = top;
}
const mdRenderSoon = debounce(mdRender, 200);

function renderDocBar() {
  const t = activeTab();
  if (!t) {
    app.docBar.classList.add('hidden');
    return;
  }
  app.docBar.classList.remove('hidden');
  const rel = relPath(S.project.root, t.path).split('/');
  const crumbs = h('div', { class: 'crumbs' }, rel.slice(0, -1).map((p) => [p, ' / ']), h('b', {}, rel[rel.length - 1]));
  const items = [crumbs];
  if (t.roots.length) {
    const st = docStatus(t.root);
    if (t.roots.length > 1 || t.roots[0].path !== t.path) {
      const sel = h(
        'select',
        {
          title: 'Este arquivo entra em mais de um documento: escolha qual compilar',
          onchange: (e) => {
            t.root = e.target.value;
            S.savedRoots = { ...(S.savedRoots || {}), [t.path]: t.root };
            renderDocBar();
            renderTabs();
            saveUiSoon();
          },
        },
        t.roots.map((r) => h('option', { value: r.path, selected: r.path === t.root }, relPath(S.project.root, r.path))),
      );
      items.push(h('div', { class: 'root-pick' }, 'Documento', sel));
    }
    const info = t.roots.find((r) => r.path === t.root);
    if (info) items.push(h('span', { class: 'chip', title: `Motor: ${info.engine} (${info.engineSource})` }, info.engine));
    const res = S.docState.get(t.root)?.result;
    if (st && st !== 'building' && res) items.push(resultChip(res));
    items.push(
      h(
        'label',
        { class: 'toggle', title: 'Compilar este documento sempre que salvar' },
        h('input', {
          type: 'checkbox',
          checked: !!t.autoCompile,
          onchange: (e) => {
            t.autoCompile = e.target.checked;
            saveUiSoon();
          },
        }),
        h('span', { class: 'sw' }),
        'ao salvar',
      ),
    );
    const building = st === 'building';
    items.push(
      h(
        'div',
        { class: 'split-btn' },
        h(
          'button',
          { class: 'btn primary', onclick: () => compileTab(t), disabled: building, title: `Compilar ${basename(t.root)} (⌘↵)` },
          building ? h('span', { class: 'status-dot building' }) : icon('play'),
          building ? 'Compilando…' : res ? 'Recompilar' : 'Compilar',
        ),
        h(
          'button',
          {
            class: 'btn primary',
            title: 'Mais opções',
            onclick: (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              menu(r.left - 150, r.bottom + 4, [
                { label: 'Compilar este documento', icon: 'play', kb: '⌘↵', action: () => compileTab(t) },
                { label: 'Compilar tudo que está aberto', icon: 'playAll', kb: '⌘⇧↵', action: () => compileAll() },
                { label: 'Compilar do zero (limpa auxiliares)', icon: 'broom', action: () => compileTab(t, { clean: true }) },
                'sep',
                { label: 'Mostrar no PDF', icon: 'target', kb: '⌘J', action: () => syncForward() },
                { label: 'Abrir PDF fora do app', icon: 'external', action: () => call('openExternal', { path: t.root.replace(/\.tex$/, '.pdf') }).catch((e) => toast(e.message, 'error')) },
                { label: 'Limpar arquivos auxiliares', icon: 'trash', action: () => call('cleanAux', { doc: t.root }).then(() => toast('Auxiliares removidos.', 'ok')) },
                'sep',
                { label: 'Formatar documento (latexindent)', icon: 'wrap', kb: '⌥⇧F', action: () => tools.formatDoc(app, S) },
                { label: 'Médico do TeX', icon: 'info', action: () => tools.texDoctor(app, S) },
                { label: 'Exportar ZIP para submissão', icon: 'down', action: () => tools.exportZip(app, S) },
                { label: 'Checar anonimato (double-blind)', icon: 'eye', action: () => tools.blindCheck(app, S) },
                { label: 'Revisar estilo (ChkTeX)', icon: 'check', action: () => tools.chktex(app, S) },
                { label: 'Contar palavras', icon: 'outline', action: () => tools.wordCount(app, S) },
              ]);
            },
          },
          icon('chevDown'),
        ),
      ),
    );
  } else if (isMd(t)) {
    const mode = t.mdMode || 'preview';
    const seg = (id, label, ic) =>
      h('button', { class: 'btn sm' + (mode === id ? ' primary' : ''), onclick: () => ((t.mdMode = id), applyMdMode(), renderDocBar(), id !== 'preview' && app.view.focus()) }, icon(ic), label);
    items.push(h('div', { class: 'split-btn seg' }, seg('preview', 'Visualizar', 'eye'), seg('split', 'Lado a lado', 'columns'), seg('edit', 'Código', 'edit')));
  } else if (/\.tex$/.test(t.path)) {
    items.push(h('span', { class: 'chip', title: 'Nenhum documento do projeto faz \\input deste arquivo. Adicione "% !TEX root = ../paper.tex" no topo para dizer qual é.' }, icon('info'), 'fora de qualquer documento'));
  }
  clear(app.docBar, items);
}
app.renderDocBar = renderDocBar;

function resultChip(res) {
  const q = res.undefinedRefs.length + res.undefinedCites.length;
  if (res.status === 'error') return h('span', { class: 'chip error', onclick: () => app.bottom.show('problems'), style: { cursor: 'pointer' } }, icon('error'), `${res.errors.length || 1} erro${res.errors.length > 1 ? 's' : ''}`);
  if (q) return h('span', { class: 'chip undefined', onclick: () => app.bottom.show('problems'), style: { cursor: 'pointer' } }, `${q} ??`);
  return h('span', { class: 'chip ok', title: 'Nenhuma referência ou citação indefinida' }, icon('check'), 'zero ??', res.pages ? ` · ${res.pages} p.` : '');
}

function renderEmpty() {
  clear(
    app.emptyEditor,
    h(
      'div',
      {},
      h('img', { src: './logo.svg' }),
      h('div', { style: { fontSize: '15px', color: 'var(--muted)' } }, 'Abra um arquivo na barra lateral'),
      h(
        'div',
        { class: 'keys' },
        h('span', {}, h('kbd', {}, '⌘P')), 'abrir arquivo',
        h('span', {}, h('kbd', {}, '⌘K')), 'comandos',
        h('span', {}, h('kbd', {}, '⌘↵')), 'compilar a aba',
        h('span', {}, h('kbd', {}, '⌘⇧↵')), 'compilar tudo',
        h('span', {}, h('kbd', {}, '⌘J')), 'mostrar no PDF',
        h('span', {}, h('kbd', {}, '2× clique')), 'no PDF: ir à linha',
      ),
    ),
  );
}

// ---------------------------------------------------------------- saving
async function saveTab(t, { quiet = false } = {}) {
  if (!t || t.binary) return true;
  if (t.path === S.active) t.state = app.view.state;
  const text = t.state.doc.toString();
  const version = t.version;
  try {
    const r = await call('write', { path: t.path, text, expectMtime: t.mtime });
    if (r.conflict) {
      const overwrite = await confirmBox(
        'O arquivo mudou no disco',
        `${t.name} foi alterado fora do TeXugo (git, outro editor ou um agente) depois que você o abriu. Sobrescrever com a sua versão?`,
        { ok: 'Sobrescrever', danger: true },
      );
      if (!overwrite) return false;
      const r2 = await call('write', { path: t.path, text });
      t.mtime = r2.mtime;
    } else t.mtime = r.mtime;
    if (t.version === version) t.dirty = false;
    renderTabs();
    app.sidebar.renderIfFiles();
    if (!quiet && t.autoCompile && t.root) compileTab(t);
    if (/\.(tex|bib)$/.test(t.path)) refreshSymbolsSoon();
    return true;
  } catch (err) {
    toast('Não salvou: ' + err.message, 'error');
    return false;
  }
}
app.saveTab = saveTab;

async function saveAll() {
  for (const t of S.tabs) if (t.dirty) if (!(await saveTab(t, { quiet: true }))) return false;
  return true;
}
app.saveAll = saveAll;

// ---------------------------------------------------------------- compile
function allOpenRoots() {
  const set = new Set();
  for (const t of S.tabs) if (t.root) set.add(t.root);
  for (const p of S.pdfTabs) if (p.doc) set.add(p.doc);
  return [...set];
}

async function compileDocs(docs, opts = {}) {
  if (!docs.length) return;
  // Compiling the file on screen while the disk has an older version is a
  // classic source of confusion: always save first.
  if (!(await saveAll())) return;
  for (const d of docs) {
    const st = S.docState.get(d) || {};
    S.docState.set(d, { ...st, status: 'waiting', steps: [], requestedAt: Date.now() });
  }
  renderTabs();
  renderDocBar();
  try {
    await call('build', { root: S.project.root, docs, ...opts });
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function compileTab(t, opts) {
  t = t || activeTab();
  if (!t) return toast('Abra um arquivo para compilar.', 'warn');
  if (!t.root) {
    if (/\.tex$/.test(t.path)) toast('Este arquivo não entra em nenhum documento. Ponha "% !TEX root = arquivo-principal.tex" no topo.', 'warn', 6000);
    return;
  }
  wantPdf = t.root;
  return compileDocs([t.root], opts);
}
app.compileTab = compileTab;

async function compileAll() {
  const docs = allOpenRoots();
  if (!docs.length) return toast('Nenhuma aba aberta tem documento para compilar.', 'warn');
  return compileDocs(docs);
}
app.compileAll = compileAll;
app.compileDocs = compileDocs;

let wantPdf = null; // the PDF to bring to front when its build ends

// Several windows share one server: ignore builds of other projects.
const mine = (e) => {
  if (!S.project) return false;
  if (e.root) return e.root === S.project.root;
  const d = e.doc || (e.docs && e.docs[0]);
  return !d || d.startsWith(S.project.root + '/') || (S.building && S.building.id === e.id);
};

function wireBuildEvents() {
  on('build:queued', (e) => {
    if (!mine(e)) return;
    S.queued = true;
    renderTopbar();
  });
  on('build:start', (e) => {
    if (!mine(e)) return;
    S.building = { id: e.id, order: e.order, requested: e.requested };
    S.queued = false;
    for (const d of e.order) {
      const st = S.docState.get(d) || {};
      S.docState.set(d, { ...st, status: 'waiting', steps: [], passes: [], current: false });
      S.logs.set(d, '');
    }
    if (e.expanded.length) app.bottom.note(`Também vou compilar ${e.expanded.map(basename).join(', ')}: ${e.requested.map(basename).join(', ')} importa os rótulos dele${e.expanded.length > 1 ? 's' : ''} (\\externaldocument).`);
    else app.bottom.note(null);
    if (S.settings.bottomOpen) app.bottom.show('build', { soft: true });
    refreshBuildUi();
  });
  on('build:doc', (e) => {
    if (!mine(e)) return;
    for (const [d, st] of S.docState) if (st.current) st.current = false;
    const st = S.docState.get(e.doc) || { steps: [], passes: [] };
    st.status = 'building';
    st.current = true;
    st.passes = [...(st.passes || []), { pass: e.pass, reason: e.reason }];
    st.steps = [...(st.steps || []), { rule: `passada ${e.pass}`, pass: true }];
    S.docState.set(e.doc, st);
    refreshBuildUi();
  });
  on('build:step', (e) => {
    if (!mine(e)) return;
    const st = S.docState.get(e.doc);
    if (!st) return;
    st.steps.push({ rule: e.rule.replace(/ .*$/, '') });
    app.bottom.renderBuild();
  });
  on('build:log', (e) => {
    if (!mine(e)) return;
    S.logs.set(e.doc, (S.logs.get(e.doc) || '') + e.text);
    app.bottom.appendLog(e.doc, e.text);
  });
  on('build:done', (e) => {
    if (!mine(e)) return;
    S.building = null;
    S.lastSummary = e;
    for (const d of e.docs || []) {
      const st = S.docState.get(d.doc) || {};
      S.docState.set(d.doc, { ...st, status: d.status === 'skipped' ? st.prev || null : d.status, current: false, result: d });
    }
    for (const [, st] of S.docState) if (st.status === 'waiting' || st.status === 'building') st.status = null;
    if (e.fatal) toast(e.fatal.split('\n')[0], 'error', 8000);
    // Refresh or open PDFs.
    for (const d of e.docs || []) {
      if (!d.pdf) continue;
      const tab = S.pdfTabs.find((p) => p.path === d.pdf);
      if (tab) reloadPdf(tab);
      else if (d.requested && !S.detached.has(d.pdf) && (wantPdf === d.doc || !S.pdfTabs.length)) openPdf(d.pdf, { doc: d.doc, activate: true });
    }
    if (wantPdf) {
      const pdf = wantPdf.replace(/\.tex$/, '.pdf');
      if (S.pdfTabs.some((p) => p.path === pdf)) activatePdf(pdf);
      wantPdf = null;
    }
    const bad = (e.docs || []).filter((d) => d.status === 'error');
    const qq = (e.docs || []).reduce((n, d) => n + d.undefinedRefs.length + d.undefinedCites.length, 0);
    if (e.cancelled) toast('Compilação interrompida.', 'warn');
    else if (bad.length) {
      app.bottom.show('problems');
      toast(`${bad.map((d) => d.name).join(', ')}: erro na compilação.`, 'error');
    } else if (qq) {
      app.bottom.show('problems');
      toast(`Compilou, mas ainda há ${qq} ?? no PDF. Veja Problemas.`, 'warn', 6000);
    }
    refreshBuildUi();
    applyDiagnostics();
    refreshSymbolsSoon();
  });
}

function refreshBuildUi() {
  renderTabs();
  renderDocBar();
  renderTopbar();
  app.bottom.renderBuild();
  app.bottom.renderProblems();
  renderStatus();
  renderActivity();
}
app.refreshBuildUi = refreshBuildUi;

// All problems of the last results, flattened.
export function allProblems() {
  const out = [];
  for (const [, st] of S.docState) {
    const r = st.result;
    if (!r) continue;
    for (const e of r.errors) {
      const miss = (e.message.match(/File `([^']+\.(?:sty|cls|def|bst|cfg|fd))' not found/) || [])[1];
      out.push({ severity: 'error', doc: r.doc, file: e.file, line: e.line, message: e.message, hint: e.hint, context: e.context, missing: miss || null });
    }
    for (const u of r.undefinedRefs) out.push({ severity: 'undefined', doc: r.doc, file: u.file, line: u.line, message: `Referência indefinida: ${u.key}`, hint: u.explain, key: u.key });
    for (const u of r.undefinedCites) out.push({ severity: 'undefined', doc: r.doc, file: u.file, line: u.line, message: `Citação indefinida: ${u.key}`, hint: u.explain, key: u.key });
    for (const m of r.missingExternal || []) out.push({ severity: 'error', doc: r.doc, file: r.doc, line: null, message: `\\externaldocument aponta para ${basename(m.external)}, que não existe.` });
    for (const k of r.multiplyDefined) out.push({ severity: 'warning', doc: r.doc, file: r.doc, line: null, message: `Rótulo definido duas vezes: ${k}` });
    for (const w of r.warnings) {
      if (/^(Reference|Citation) `/.test(w.message) || /multiply defined/.test(w.message)) continue;
      out.push({ severity: 'warning', doc: r.doc, file: w.file, line: w.line, message: w.message, pkg: w.package });
    }
    for (const b of r.badboxes) if (b.kind === 'overfull' || S.settings.showUnderfull) out.push({ severity: 'badbox', doc: r.doc, file: b.file, line: b.line, message: b.message });
  }
  if (S.lint) for (const l of S.lint.items) out.push({ severity: 'lint', doc: S.lint.file, file: S.lint.file, line: l.line, message: `ChkTeX ${l.num}: ${l.message}` });
  return out;
}
app.allProblems = allProblems;

function applyDiagnostics() {
  const t = activeTab();
  if (!t || t.binary) return;
  const sev = { error: 'error', undefined: 'warning', warning: 'warning', badbox: 'info', lint: 'info' };
  const diags = allProblems()
    .filter((p) => p.file === t.path && p.line)
    .map((p) => ({ line: p.line, severity: sev[p.severity], message: p.message + (p.hint ? '\n' + p.hint : ''), source: basename(p.doc) }));
  showDiagnostics(app.view, diags);
}
app.applyDiagnostics = applyDiagnostics;

// ---------------------------------------------------------------- PDF
function openPdf(path, { doc, activate: act = true } = {}) {
  if (S.detached.has(path)) return;
  let p = S.pdfTabs.find((x) => x.path === path);
  if (!p) {
    const viewer = new PdfTab(path, { onInverse: inverseSync, onState: () => p === pdfActive() && renderPdfTools() });
    p = { path, doc: doc || guessDoc(path), viewer };
    S.pdfTabs.push(p);
    app.pdfStack.append(viewer.el);
    viewer.el.classList.toggle('invert', !!S.settings.invertPdf && isDark());
    reloadPdf(p);
  }
  if (act) activatePdf(path);
  renderPdfTabs();
  saveUiSoon();
}
app.openPdf = openPdf;

function guessDoc(pdf) {
  const tex = pdf.replace(/\.pdf$/, '.tex');
  return S.project && S.project.docs.some((d) => d.path === tex) ? tex : null;
}

async function reloadPdf(p) {
  try {
    await p.viewer.load(fileUrl(p.path));
    p.missing = false;
  } catch {
    p.missing = true;
  }
  if (p === pdfActive()) renderPdfStack();
  renderPdfTools();
}

function pdfActive() {
  return S.pdfTabs.find((p) => p.path === S.activePdf);
}

function activatePdf(path) {
  S.activePdf = path;
  renderPdfTabs();
  renderPdfStack();
  renderPdfTools();
}

function closePdf(path) {
  const i = S.pdfTabs.findIndex((p) => p.path === path);
  if (i < 0) return;
  S.pdfTabs[i].viewer.destroy();
  S.pdfTabs.splice(i, 1);
  if (S.activePdf === path) S.activePdf = (S.pdfTabs[i] || S.pdfTabs[i - 1] || {}).path || null;
  renderPdfTabs();
  renderPdfStack();
  renderPdfTools();
  renderTopbar();
  saveUiSoon();
}

function renderPdfTabs() {
  clear(
    app.pdfTabsEl,
    S.pdfTabs.map((p) =>
      h(
        'div',
        { class: 'tab' + (p.path === S.activePdf ? ' active' : ''), title: relPath(S.project.root, p.path), onclick: () => activatePdf(p.path) },
        h('span', { class: 'status-dot ' + (p.doc ? docStatus(p.doc) || '' : '') }),
        icon('pdf'),
        h('span', { class: 'label' }, basename(p.path)),
        h('span', { class: 'close', onclick: (e) => (e.stopPropagation(), closePdf(p.path)) }, icon('x')),
      ),
    ),
  );
}

function renderPdfStack() {
  for (const p of S.pdfTabs) p.viewer.el.classList.toggle('hidden', p.path !== S.activePdf);
  app.pdfStack.querySelectorAll('.pdf-empty').forEach((e) => e.remove());
  const p = pdfActive();
  if (!p || p.missing) {
    app.pdfStack.append(
      h(
        'div',
        { class: 'pdf-empty' },
        h(
          'div',
          {},
          h('div', { class: 'big' }, p ? 'O PDF ainda não existe' : 'Nenhum PDF aberto'),
          h('div', {}, 'Compile um documento (', h('kbd', {}, '⌘↵'), ') e o PDF aparece aqui.'),
          h('div', { class: 'faint', style: { marginTop: '6px' } }, 'Cada documento ganha sua aba de PDF. Dá para ter paper e apêndice lado a lado nas abas.'),
        ),
      ),
    );
  }
}

function renderPdfTools() {
  const p = pdfActive();
  if (!p) {
    clear(app.pdfTools, h('span', { class: 'muted', style: { padding: '0 8px', fontSize: '12px' } }, 'PDF'));
    return;
  }
  const v = p.viewer;
  const pageInput = h('input', {
    value: v.page,
    onkeydown: (e) => {
      if (e.key === 'Enter') v.page = Number(e.target.value) || 1;
    },
  });
  clear(
    app.pdfTools,
    h('button', { class: 'icon-btn', title: 'Página anterior', onclick: () => (v.page = v.page - 1) }, icon('chevUp')),
    h('button', { class: 'icon-btn', title: 'Próxima página', onclick: () => (v.page = v.page + 1) }, icon('chevDown')),
    h('span', { class: 'pageinfo' }, pageInput, `/ ${v.pages || '–'}`),
    h('span', { class: 'sep' }),
    h('button', { class: 'icon-btn', title: 'Diminuir', onclick: () => v.zoom(1 / 1.15) }, icon('zoomOut')),
    h('span', { class: 'zoom' }, Math.round((v.viewer.currentScale || 1) * 100) + '%'),
    h('button', { class: 'icon-btn', title: 'Aumentar', onclick: () => v.zoom(1.15) }, icon('zoomIn')),
    h('button', { class: 'icon-btn' + (v.scale === 'page-width' ? ' on' : ''), title: 'Largura da página', onclick: () => v.setScale('page-width') }, icon('fitWidth')),
    h('button', { class: 'icon-btn' + (v.scale === 'page-fit' ? ' on' : ''), title: 'Página inteira', onclick: () => v.setScale('page-fit') }, icon('fitPage')),
    h('span', { style: { flex: 1 } }),
    isSlides(p) ? h('button', { class: 'btn sm', title: 'Tela cheia, um slide por vez (setas, espaço, clique; Esc sai)', onclick: () => v.present() }, icon('slides'), 'Apresentar') : null,
    h('button', { class: 'icon-btn' + (S.settings.followCursor ? ' on' : ''), title: 'O PDF acompanha o cursor do editor', onclick: () => ((S.settings.followCursor = !S.settings.followCursor), saveSettingsSoon(), renderPdfTools()) }, icon('target')),
    h('button', { class: 'icon-btn' + (S.settings.invertPdf ? ' on' : ''), title: 'PDF escuro (só na tela)', onclick: toggleInvert }, icon('invert')),
    p.doc ? h('button', { class: 'icon-btn', title: 'Ir ao trecho no código (ou dê 2 cliques no PDF)', onclick: () => toast('Dê dois cliques num trecho do PDF para ir à linha do código.', 'info') }, icon('sync')) : null,
    h('button', { class: 'icon-btn', title: 'Abrir este PDF numa janela separada (outro monitor)', onclick: () => detachPdf(p) }, icon('columns')),
    h('button', { class: 'icon-btn', title: 'Abrir no Preview', onclick: () => call('openExternal', { path: p.path }) }, icon('external')),
  );
}

function detachPdf(p) {
  const url = `/?t=${encodeURIComponent(TOKEN)}&pdfwin=${encodeURIComponent(p.path)}&root=${encodeURIComponent(S.project.root)}`;
  const w = window.open(url, '_blank', 'popup,width=900,height=1000');
  if (!w && !native) return toast('O navegador bloqueou a janela nova. Permita pop-ups para este endereço.', 'warn');
  S.detached.add(p.path);
  closePdf(p.path);
  applyPdfPane();
}

// The PDF pane hides when every PDF lives in its own window.
function applyPdfPane() {
  const hide = !S.pdfTabs.length && S.detached.size > 0;
  app.pdfGroup.classList.toggle('hidden', hide);
  app.pdfGutter.classList.toggle('hidden', hide);
}

function wireWindowEvents() {
  on('pdfwin:open', (e) => {
    if (!S.project || e.root !== S.project.root) return;
    S.detached.add(e.pdf);
    if (S.pdfTabs.some((x) => x.path === e.pdf)) closePdf(e.pdf);
    applyPdfPane();
  });
  // Closing a PDF window (its button or the red dot) brings the PDF back.
  on('pdfwin:close', (e) => {
    if (!S.project || e.root !== S.project.root) return;
    S.detached.delete(e.pdf);
    openPdf(e.pdf, { activate: true });
    applyPdfPane();
  });
  on('pdfwin:dock', (e) => {
    if (!S.project || e.root !== S.project.root) return;
    S.detached.delete(e.pdf);
    openPdf(e.pdf, { activate: true });
    applyPdfPane();
  });
  on('open-request', async (e) => {
    if (!S.project || e.root !== S.project.root) return;
    await openFile(e.file, { line: e.line });
    if (native && native.focus) native.focus();
    else window.focus();
  });
}

function isSlides(p) {
  if (!p.doc) return false;
  const d = (S.project.docs || []).find((x) => x.path === p.doc);
  return !!d && d.kind === 'slides';
}

function toggleInvert() {
  S.settings.invertPdf = !S.settings.invertPdf;
  for (const p of S.pdfTabs) p.viewer.el.classList.toggle('invert', S.settings.invertPdf && isDark());
  saveSettingsSoon();
  renderPdfTools();
}

const followSoon = debounce(() => syncForward({ quiet: true }), 500);

async function syncForward({ quiet = false } = {}) {
  const t = activeTab();
  if (!t || !t.root) return;
  {
    const pdf = t.root.replace(/\.tex$/, '.pdf');
    if (S.detached.has(pdf)) {
      try {
        const r = await call('syncForward', { file: t.path, line: S.cursor.line, column: S.cursor.col, pdf });
        if (r.ok) call('broadcast', { msg: { type: 'sync-show', pdf, hit: r.hits[0] } });
      } catch {}
      return;
    }
  }
  if (quiet) {
    // Following the cursor: only when the PDF is already open and current.
    const pdf = t.root.replace(/\.tex$/, '.pdf');
    const p = S.pdfTabs.find((x) => x.path === pdf);
    if (!p || p.missing || S.building) return;
    if (S.activePdf !== pdf) activatePdf(pdf);
    try {
      const r = await call('syncForward', { file: t.path, line: S.cursor.line, column: S.cursor.col, pdf });
      if (r.ok) p.viewer.showSync(r.hits[0]);
    } catch {}
    return;
  }
  const pdf = t.root.replace(/\.tex$/, '.pdf');
  let p = S.pdfTabs.find((x) => x.path === pdf);
  if (!p) {
    openPdf(pdf, { doc: t.root });
    p = S.pdfTabs.find((x) => x.path === pdf);
    await new Promise((r) => setTimeout(r, 700));
  }
  activatePdf(pdf);
  if (!(await ensureSynctex(pdf))) return;
  try {
    const r = await call('syncForward', { file: t.path, line: S.cursor.line, column: S.cursor.col, pdf });
    if (r.ok) p.viewer.showSync(r.hits[0]);
    else toast('Sem posição no PDF para esta linha. Compile de novo.', 'warn');
  } catch (err) {
    toast(err.message, 'error');
  }
}
app.syncForward = syncForward;

// A PDF built outside TeXugo (terminal, Lattice, plain pdflatex) may have no
// .synctex.gz, the map between PDF and source. Say so and offer a build.
async function ensureSynctex(pdf) {
  const map = pdf.replace(/\.pdf$/, '.synctex.gz');
  let st = [];
  try {
    st = await call('stat', { paths: [map] });
  } catch {}
  if (st[0] && st[0].mtime != null) return true;
  const doc = pdf.replace(/\.pdf$/, '.tex');
  const isDoc = (S.project.docs || []).some((d) => d.path === doc);
  const ok = await confirmBox(
    'Este PDF não tem SyncTeX',
    `${basename(pdf)} foi compilado fora do TeXugo, sem o mapa que liga o PDF ao código (${basename(map)}). ${isDoc ? 'Compile uma vez pelo TeXugo e o clique duplo passa a funcionar.' : ''}`,
    { ok: isDoc ? 'Compilar agora' : 'OK' },
  );
  if (ok && isDoc) {
    wantPdf = doc;
    compileDocs([doc]);
  }
  return false;
}

async function inverseSync(args) {
  if (!(await ensureSynctex(args.pdf))) return;
  try {
    const r = await call('syncInverse', args);
    if (r.ok) await openFile(r.file, { line: r.line });
    else toast('Não achei a linha correspondente (o PDF foi compilado com SyncTeX?).', 'warn');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------- status bar
function renderStatus() {
  const t = activeTab();
  const probs = allProblems();
  const errs = probs.filter((p) => p.severity === 'error').length;
  const qq = probs.filter((p) => p.severity === 'undefined').length;
  const warns = probs.filter((p) => p.severity === 'warning').length;
  const anyResult = [...S.docState.values()].some((s) => s.result);
  clear(
    app.statusEl,
    S.project && S.git && S.git.repo
      ? h('span', { class: 'item click', onclick: () => app.sidebar.show('git'), title: 'Git' }, icon('git'), S.git.branch || '—', S.git.files.length ? ` · ${S.git.files.length} alterações` : '', S.git.ahead ? ` ↑${S.git.ahead}` : '', S.git.behind ? ` ↓${S.git.behind}` : '')
      : null,
    anyResult
      ? h(
          'span',
          { class: 'item click', onclick: () => app.bottom.show('problems'), title: 'Problemas da última compilação' },
          icon('error'), String(errs), icon('warn'), String(warns),
          h('span', { class: 'zero-qq', style: { color: qq ? 'var(--warn)' : 'var(--ok)' } }, qq ? `${qq} ??` : 'zero ??'),
        )
      : null,
    S.building ? h('span', { class: 'item' }, h('span', { class: 'status-dot building' }), 'compilando') : null,
    h('span', { class: 'grow' }),
    t && !t.binary ? h('span', { class: 'item' }, `${S.cursor.words.toLocaleString('pt-BR')} palavras`) : null,
    t && !t.binary ? h('span', { class: 'item' }, `Ln ${S.cursor.line}, Col ${S.cursor.col}`) : null,
    t ? h('span', { class: 'item' }, t.path.endsWith('.bib') ? 'BibTeX' : t.path.endsWith('.tex') ? 'LaTeX' : /\.md$/.test(t.path) ? 'Markdown' : 'Texto') : null,
    h('span', { class: 'item click', onclick: () => toggleBottom(), title: 'Painel inferior' }, icon('panel')),
  );
}
app.renderStatus = renderStatus;
const renderStatusSoon = debounce(renderStatus, 80);

const countWordsSoon = debounce(() => {
  const t = activeTab();
  if (!t || t.binary) return;
  const text = app.view.state.doc.toString();
  // Rough prose count: drop comments, commands and math.
  const prose = text
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' ')
    .replace(/\\(begin|end)\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/[{}\\&~^_#]/g, ' ');
  S.cursor.words = (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  renderStatus();
}, 400);

function renderActivity() {
  const probs = allProblems();
  const errs = probs.filter((p) => p.severity === 'error').length;
  const views = [
    ['files', 'files', 'Arquivos (⌘⇧E)'],
    ['outline', 'outline', 'Estrutura do documento'],
    ['search', 'search', 'Buscar no projeto (⌘⇧F)'],
    ['git', 'git', 'Git e GitHub'],
  ];
  clear(
    app.activity,
    views.map(([id, ic, title]) =>
      h(
        'button',
        { class: 'icon-btn' + (S.sidebarView === id && !S.settings.sidebarHidden ? ' on' : ''), title, onclick: () => app.sidebar.toggle(id) },
        icon(ic),
        id === 'git' && S.git && S.git.files && S.git.files.length ? h('span', { class: 'badge warn' }, String(Math.min(99, S.git.files.length))) : null,
      ),
    ),
    h('div', { class: 'grow' }),
    h('button', { class: 'icon-btn', title: 'Problemas', onclick: () => app.bottom.show('problems') }, icon('alert'), errs ? h('span', { class: 'badge' }, String(errs)) : null),
    h('button', { class: 'icon-btn', title: 'Novo projeto a partir de modelo', onclick: () => newProjectDialog(app, S) }, icon('plus')),
  );
}
app.renderActivity = renderActivity;

function toggleBottom(force) {
  S.settings.bottomOpen = force ?? !S.settings.bottomOpen;
  applyLayoutSizes();
  saveSettingsSoon();
}
app.toggleBottom = toggleBottom;

// ---------------------------------------------------------------- project
async function openProject(root) {
  let p;
  try {
    p = await call('openProject', { root });
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  // Close the previous project's tabs.
  for (const pt of S.pdfTabs) pt.viewer.destroy();
  S.tabs = [];
  S.pdfTabs = [];
  S.active = null;
  S.activePdf = null;
  S.docState.clear();
  S.project = p;
  document.title = `${p.name} — TeXugo`;
  document.querySelector('.welcome')?.remove();
  activate(null);
  app.sidebar.reset();
  const ui = p.ui || {};
  S.savedRoots = ui.roots || {};
  // Restore last session's tabs, or open the first document.
  const tabs = (ui.tabs || []).filter(Boolean);
  if (tabs.length) {
    for (const t of tabs) await openFile(t.path, { focus: false }).then(() => {
      const tab = tabByPath(t.path);
      if (tab) tab.autoCompile = !!t.autoCompile;
    });
    if (ui.active && tabByPath(ui.active)) activate(ui.active);
  } else if (p.docs.length) {
    const main = p.docs.find((d) => /^(main|paper|slides|ementa)\.tex$/.test(d.name)) || p.docs[0];
    await openFile(main.path);
  }
  for (const pdf of ui.pdfs || []) openPdf(pdf, { activate: false });
  if (ui.activePdf && S.pdfTabs.some((x) => x.path === ui.activePdf)) activatePdf(ui.activePdf);
  else if (S.pdfTabs[0]) activatePdf(S.pdfTabs[0].path);
  else {
    // Show existing PDFs of the open documents right away.
    // Roots are resolved asynchronously; a tab that is itself a document
    // is its own root, so do not wait for that.
    for (const t of S.tabs) {
      const root = t.root || (p.docs.some((d) => d.path === t.path) ? t.path : null);
      if (!root) continue;
      const pdf = root.replace(/\.tex$/, '.pdf');
      if (!S.pdfTabs.some((x) => x.path === pdf)) openPdf(pdf, { doc: root, activate: false });
    }
    if (S.pdfTabs[0]) activatePdf(S.pdfTabs[0].path);
  }
  renderPdfStack();
  renderPdfTabs();
  renderPdfTools();
  renderTopbar();
  renderActivity();
  refreshSymbolsSoon();
  refreshGit();
  // PDF windows of this project that are already open announce themselves.
  call('broadcast', { msg: { type: 'pdfwin:ping' } }).catch(() => {});
  // Previous results from this app session (other window or reopen).
  try {
    const res = await call('lastResults', { docs: p.docs.map((d) => d.path) });
    res.forEach((r) => r && S.docState.set(r.doc, { status: r.status, result: r, steps: [] }));
    refreshBuildUi();
  } catch {}
}
app.openProject = openProject;

const saveUiSoon = debounce(() => {
  if (!S.project) return;
  call('saveProjectUi', {
    root: S.project.root,
    ui: {
      tabs: S.tabs.map((t) => ({ path: t.path, autoCompile: t.autoCompile })),
      active: S.active,
      pdfs: S.pdfTabs.map((p) => p.path),
      activePdf: S.activePdf,
      roots: S.savedRoots,
    },
  }).catch(() => {});
}, 500);
app.saveUiSoon = saveUiSoon;

const refreshSymbolsSoon = debounce(async () => {
  if (!S.project) return;
  try {
    const s = await call('symbols', { root: S.project.root });
    symbols.labels = s.labels;
    symbols.bibKeys = s.bibKeys;
  } catch {}
}, 700);

async function refreshGit() {
  if (!S.project) return;
  try {
    S.git = await call('gitStatus', { root: S.project.root });
  } catch {
    S.git = null;
  }
  renderStatus();
  renderActivity();
  app.sidebar.renderIfGit();
}
app.refreshGit = refreshGit;
const refreshGitSoon = debounce(refreshGit, 800);

async function checkDisk() {
  if (!S.project) return;
  // macOS may report a rename (editors and agents often write a temp file
  // and move it over the original) under the temporary name only, so
  // check every open tab's mtime instead of trusting the file list.
  let stats = [];
  try {
    stats = await call('stat', { paths: S.tabs.filter((t) => !t.binary).map((t) => t.path) });
  } catch {}
  for (const st of stats) {
    const t = tabByPath(st.path);
    if (!t || st.mtime == null || Math.abs(st.mtime - t.mtime) < 1) continue;
    let data;
    try {
      data = await call('read', { path: t.path });
    } catch {
      continue;
    }
    const current = t.path === S.active ? app.view.state.doc.toString() : t.state.doc.toString();
    if (current === data.text) {
      t.mtime = data.mtime;
      continue;
    }
    if (!t.dirty) {
      // Changed on disk (git pull, an agent, another editor): reload in
      // place, keeping the cursor where it was.
      const est = t.path === S.active ? app.view.state : t.state;
      const head = Math.min(est.selection.main.head, data.text.length);
      const tr = est.update({ changes: { from: 0, to: est.doc.length, insert: data.text }, selection: { anchor: head } });
      if (t.path === S.active) app.view.dispatch(tr);
      else t.state = tr.state;
      t.dirty = false;
      t.mtime = data.mtime;
      renderTabs();
    } else if (!t.warnedMtime || t.warnedMtime !== data.mtime) {
      t.warnedMtime = data.mtime;
      toast(`${t.name} mudou no disco e você tem alterações não salvas. Ao salvar, o TeXugo pergunta antes de sobrescrever.`, 'warn', 7000);
    }
  }
}
const checkDiskSoon = debounce(checkDisk, 300);

function wireFsEvents() {
  on('fs:change', async (e) => {
    if (!S.project || e.root !== S.project.root) return;
    app.sidebar.refreshTreeSoon();
    refreshGitSoon();
    await checkDisk();
    for (const f of e.files) {
      // A PDF rebuilt outside the app (terminal, build.sh).
      if (f.endsWith('.pdf') && !S.building) {
        const p = S.pdfTabs.find((x) => x.path === f);
        if (p) reloadPdfSoon(p);
      }
    }
  });
}
const pdfReloadTimers = new Map();
function reloadPdfSoon(p) {
  clearTimeout(pdfReloadTimers.get(p.path));
  pdfReloadTimers.set(p.path, setTimeout(() => reloadPdf(p), 600));
}

// ---------------------------------------------------------------- keys
function wireKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'k' || (k === 'p' && e.shiftKey)) {
      e.preventDefault();
      if (S.project) openPalette(app, S, 'commands');
    } else if (k === 'p') {
      e.preventDefault();
      if (S.project) openPalette(app, S, 'files');
    } else if (k === 's' && !e.defaultPrevented) {
      e.preventDefault();
      if (e.altKey) saveAll();
      else saveTab(activeTab());
    } else if (k === 'enter' && !e.defaultPrevented) {
      e.preventDefault();
      if (e.shiftKey) compileAll();
      else compileTab();
    } else if (k === 'w') {
      e.preventDefault();
      if (S.active) closeTab(S.active);
    } else if (k === 'f' && e.shiftKey) {
      e.preventDefault();
      app.sidebar.show('search');
    } else if (k === 'e' && e.shiftKey) {
      e.preventDefault();
      app.sidebar.show('files');
    } else if (k === ',') {
      e.preventDefault();
      openSettings(app, S);
    } else if (k === 'j' && !e.defaultPrevented && document.activeElement && !document.activeElement.closest('.cm-editor')) {
      e.preventDefault();
      syncForward();
    } else if (k === '\\') {
      e.preventDefault();
      S.settings.sidebarHidden = !S.settings.sidebarHidden;
      applyLayoutSizes();
      renderActivity();
    } else if (e.key === 'Tab' && e.ctrlKey) {
      e.preventDefault();
      const i = S.tabs.findIndex((t) => t.path === S.active);
      const n = S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length];
      if (n) activate(n.path);
    } else if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
      const t = S.tabs[Number(e.key) - 1];
      if (t) {
        e.preventDefault();
        activate(t.path);
      }
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (S.tabs.some((t) => t.dirty)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  if (native && native.onMenu) {
    native.onMenu((action) => {
      const map = {
        open: () => app.pickAndOpen(),
        newProject: () => newProjectDialog(app, S),
        save: () => saveTab(activeTab()),
        saveAll: () => saveAll(),
        compile: () => compileTab(),
        compileAll: () => compileAll(),
        palette: () => S.project && openPalette(app, S, 'commands'),
        quickOpen: () => S.project && openPalette(app, S, 'files'),
        settings: () => openSettings(app, S),
        closeTab: () => S.active && closeTab(S.active),
        syncForward: () => syncForward(),
        toggleBottom: () => toggleBottom(),
        welcome: () => showWelcome(app, S),
      };
      map[action] && map[action]();
    });
  }
}

app.pickAndOpen = async function () {
  let root;
  if (native) root = await native.pickFolder();
  else root = await prompt('Abrir pasta', { label: 'Caminho completo da pasta do projeto', placeholder: '/Users/voce/Documents/GitHub/projeto/latex', ok: 'Abrir' });
  if (root) openProject(root);
};

// ---------------------------------------------------------------- boot
async function boot() {
  const qs = new URLSearchParams(location.search);
  if (qs.get('pdfwin')) return bootPdfWindow(qs.get('pdfwin'), qs.get('root'));
  try {
    S.hello = await call('hello');
  } catch (err) {
    document.body.textContent = 'TeXugo: não consegui falar com o servidor local (' + err.message + ').';
    return;
  }
  Object.assign(S.settings, S.hello.settings || {});
  applyTheme(S.settings.theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    renderTopbar();
    for (const p of S.pdfTabs) p.viewer.el.classList.toggle('invert', S.settings.invertPdf && isDark());
  });
  buildLayout();
  wireBuildEvents();
  wireFsEvents();
  wireKeys();
  wireWindowEvents();
  connect();
  on('ws:open', () => S.project && (refreshGit(), checkDiskSoon(), call('broadcast', { msg: { type: 'pdfwin:ping' } }).catch(() => {})));
  window.addEventListener('focus', () => checkDiskSoon());
  renderTopbar();
  renderActivity();
  renderStatus();
  renderPdfTabs();
  renderPdfStack();
  renderPdfTools();
  activate(null);
  const qp = new URLSearchParams(location.search).get('open');
  const last = qp || (S.settings.reopenLast !== false && S.hello.recents[0]);
  if (last) await openProject(last);
  else showWelcome(app, S);
}

app.S = S;
app.tools = tools;
app.wrapCompartment = wrapCompartment;
app.EditorView = EditorView;
boot();
