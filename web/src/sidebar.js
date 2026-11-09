// Sidebar views: files, outline, project search, git.
import { call } from './api.js';
import { h, clear, icon, fileIcon, fileKind, basename, relPath, debounce, toast, menu, prompt, confirmBox, modal } from './dom.js';
import { renderRefs } from './references.js';
import { renderRevisao } from './revisao.js';

export class Sidebar {
  constructor(app, S) {
    this.app = app;
    this.S = S;
    S.sidebarView = 'files';
    this.expanded = new Set();
    this.tree = null;
    this.searchState = { query: '', regex: false, results: [] };
    this.refreshTreeSoon = debounce(() => this.loadTree(), 300);
    this.render();
  }

  reset() {
    this.expanded = new Set([this.S.project.root]);
    this.tree = null;
    this.loadTree();
  }

  show(view) {
    this.S.sidebarView = view;
    this.S.settings.sidebarHidden = false;
    this.app.applyLayoutSizes();
    this.render();
    this.app.renderActivity();
    if (view === 'search') setTimeout(() => this.el.querySelector('input')?.focus(), 0);
    if (view === 'git') this.app.refreshGit();
  }

  toggle(view) {
    if (this.S.sidebarView === view && !this.S.settings.sidebarHidden) {
      this.S.settings.sidebarHidden = true;
      this.app.applyLayoutSizes();
      this.app.renderActivity();
    } else this.show(view);
  }

  get el() {
    return this.app.sidebarEl;
  }

  render() {
    const v = this.S.sidebarView;
    if (v === 'files') this.renderFiles();
    else if (v === 'outline') this.renderOutline();
    else if (v === 'search') this.renderSearch();
    else if (v === 'git') this.renderGit();
    else if (v === 'refs') renderRefs(this.app, this.S, this.el);
    else if (v === 'revisao') renderRevisao(this.app, this.S, this.el);
    else if (v === 'claude') {
      if (this.app.agent && this.app.agent.el.parentNode !== this.el) clear(this.el, this.app.agent.el);
      this.app.agent && this.app.agent.focus();
    }
  }
  renderIfFiles() {
    if (this.S.sidebarView === 'files') this.renderFiles();
  }
  renderIfGit() {
    if (this.S.sidebarView === 'git') this.renderGit();
  }
  onActiveChanged() {
    const v = this.S.sidebarView;
    if (v === 'files') this.renderFiles();
    if (v === 'outline') this.renderOutline();
    if (v === 'revisao') renderRevisao(this.app, this.S, this.el);
  }

  // ------------------------------------------------------------ files
  async loadTree() {
    if (!this.S.project) return;
    try {
      this.tree = await call('tree', { root: this.S.project.root, showArtifacts: !!this.S.settings.showArtifacts });
      this.S.project.docs = await call('documents', { root: this.S.project.root });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    this.renderIfFiles();
    this.app.renderTopbar();
  }

  renderFiles() {
    const S = this.S;
    if (!S.project) return clear(this.el);
    const docs = new Set((S.project.docs || []).map((d) => d.path));
    const activePath = S.active;
    // Expand the folders that lead to the active file once, when it becomes
    // active; after that the user's own collapsing wins (Recolher pastas).
    if (activePath && this.revealedFor !== activePath) {
      this.revealedFor = activePath;
      let d = activePath.slice(0, activePath.lastIndexOf('/'));
      while (d.startsWith(S.project.root) && d.length >= S.project.root.length) {
        this.expanded.add(d);
        d = d.slice(0, d.lastIndexOf('/'));
      }
    }
    const rows = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const pad = 8 + depth * 14 + 'px';
        if (n.dir) {
          const open = this.expanded.has(n.path);
          rows.push(
            h(
              'div',
              {
                class: 'tree-row',
                style: { paddingLeft: pad },
                onclick: () => {
                  open ? this.expanded.delete(n.path) : this.expanded.add(n.path);
                  this.renderFiles();
                },
                oncontextmenu: (e) => this.fileMenu(e, n),
              },
              icon(open ? 'chevDown' : 'chevRight', 'chev'),
              icon(open ? 'folderOpen' : 'folder'),
              h('span', { class: 'name' }, n.name),
            ),
          );
          if (open) walk(n.children, depth + 1);
        } else {
          const tab = S.tabs.find((t) => t.path === n.path);
          rows.push(
            h(
              'div',
              {
                class: `tree-row ${fileKind(n.name)}` + (n.path === activePath ? ' active' : '') + (tab && tab.dirty ? ' dirty' : ''),
                style: { paddingLeft: 8 + depth * 14 + 17 + 'px' },
                title: relPath(S.project.root, n.path),
                onclick: () => this.app.openFile(n.path),
                oncontextmenu: (e) => this.fileMenu(e, n),
              },
              fileIcon(n.name),
              h('span', { class: 'name' }, n.name),
              docs.has(n.path) ? h('span', { class: 'doc-tag', title: 'Documento compilável (\\documentclass)' }, 'doc') : null,
            ),
          );
        }
      }
    };
    if (this.tree) walk(this.tree.children, 0);
    clear(
      this.el,
      h(
        'div',
        { class: 'sidebar-head' },
        h('span', { class: 'title', title: S.project.root }, S.project.name),
        h('button', { class: 'icon-btn', title: 'Novo arquivo', onclick: () => this.newFile(S.project.root) }, icon('newFile')),
        h('button', { class: 'icon-btn', title: 'Nova pasta', onclick: () => this.newFile(S.project.root, true) }, icon('newFolder')),
        h('button', { class: 'icon-btn', title: 'Atualizar', onclick: () => this.loadTree() }, icon('refresh')),
        h(
          'button',
          {
            class: 'icon-btn',
            title: 'Mais',
            onclick: (e) =>
              menu(e.clientX, e.clientY + 10, [
                { label: S.settings.showArtifacts ? 'Esconder auxiliares (.aux, .log…)' : 'Mostrar auxiliares (.aux, .log…)', icon: 'eye', action: () => ((S.settings.showArtifacts = !S.settings.showArtifacts), this.app.saveSettingsSoon(), this.loadTree()) },
                { label: 'Recolher pastas', icon: 'chevUp', action: () => ((this.expanded = new Set()), this.renderFiles()) },
                { label: 'Mostrar no Finder', icon: 'folder', action: () => call('reveal', { path: S.project.root }) },
                'sep',
                { label: 'Abrir outra pasta…', icon: 'folderOpen', action: () => this.app.pickAndOpen() },
              ]),
          },
          icon('dots'),
        ),
      ),
      h('div', { class: 'sidebar-body' }, rows, this.tree && this.tree.truncated ? h('div', { class: 'pad faint' }, 'Lista cortada: pasta com muitos arquivos.') : null),
    );
    this.el.querySelector('.tree-row.active')?.scrollIntoView({ block: 'nearest' });
  }

  fileMenu(e, n) {
    e.preventDefault();
    const S = this.S;
    const dir = n.dir ? n.path : n.path.slice(0, n.path.lastIndexOf('/'));
    const isDoc = (S.project.docs || []).some((d) => d.path === n.path);
    menu(e.clientX, e.clientY, [
      !n.dir ? { label: 'Abrir', icon: 'file', action: () => this.app.openFile(n.path) } : null,
      isDoc ? { label: 'Compilar', icon: 'play', action: () => this.app.compileDocs([n.path]) } : null,
      { label: 'Novo arquivo aqui', icon: 'newFile', action: () => this.newFile(dir) },
      { label: 'Nova pasta aqui', icon: 'newFolder', action: () => this.newFile(dir, true) },
      'sep',
      { label: 'Renomear', icon: 'edit', action: () => this.rename(n) },
      { label: 'Copiar caminho', action: () => navigator.clipboard.writeText(n.path) },
      { label: 'Copiar caminho relativo', action: () => navigator.clipboard.writeText(relPath(S.project.root, n.path)) },
      { label: 'Mostrar no Finder', icon: 'folder', action: () => call('reveal', { path: n.path }) },
      'sep',
      { label: 'Mover para o Lixo', icon: 'trash', danger: true, action: () => this.trash(n) },
    ]);
  }

  async newFile(dir, isDir = false) {
    const name = await prompt(isDir ? 'Nova pasta' : 'Novo arquivo', { value: isDir ? 'nova-pasta' : 'secao.tex', ok: 'Criar' });
    if (!name) return;
    const path = dir + '/' + name;
    try {
      await call('createFile', { path, dir: isDir });
      await this.loadTree();
      if (!isDir) this.app.openFile(path);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async rename(n) {
    const name = await prompt('Renomear', { value: n.name, ok: 'Renomear' });
    if (!name || name === n.name) return;
    const to = n.path.slice(0, n.path.lastIndexOf('/') + 1) + name;
    try {
      await call('rename', { from: n.path, to });
      const t = this.S.tabs.find((x) => x.path === n.path);
      if (t) {
        t.path = to;
        t.name = name;
        if (this.S.active === n.path) this.S.active = to;
      }
      await this.loadTree();
      this.app.renderTabs();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async trash(n) {
    const ok = await confirmBox('Mover para o Lixo?', `${n.name} vai para o Lixo do macOS (dá para recuperar de lá).`, { ok: 'Mover para o Lixo', danger: true });
    if (!ok) return;
    try {
      await call('trash', { path: n.path });
      const t = this.S.tabs.find((x) => x.path === n.path);
      if (t) {
        t.dirty = false;
        this.app.closeTab(t.path);
      }
      this.loadTree();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ------------------------------------------------------------ outline
  async renderOutline() {
    const t = this.app.activeTab();
    const head = h('div', { class: 'sidebar-head' }, h('span', { class: 'title' }, 'Estrutura'));
    if (!t || t.binary) return clear(this.el, head, h('div', { class: 'pad faint' }, 'Abra um arquivo .tex.'));
    // Outline of the document: the root and the files it inputs, in order.
    const files = [t.path];
    let items = [];
    try {
      const text = t.path === this.S.active ? this.app.view.state.doc.toString() : t.state.doc.toString();
      items = await call('outline', { path: t.path, text });
    } catch {}
    const symbols = await call('symbols', { root: this.S.project.root }).catch(() => ({ labels: [] }));
    const labels = symbols.labels.filter((l) => files.includes(l.file));
    this.outlineItems = items;
    clear(
      this.el,
      head,
      h(
        'div',
        { class: 'sidebar-body' },
        h('div', { class: 'section-label' }, basename(t.path)),
        items.length
          ? items.map((it) =>
              h(
                'div',
                { class: 'list-row', style: { paddingLeft: 10 + Math.max(0, it.level - 1) * 12 + 'px' }, onclick: () => this.app.openFile(t.path, { line: it.line }), 'data-line': it.line },
                h('span', { class: 'k' }, it.kind === 'frame' ? '▭' : it.kind === 'section' ? '§' : it.kind === 'subsection' ? '§§' : it.kind.slice(0, 3)),
                h('span', { class: 't' }, it.title || '(sem título)'),
              ),
            )
          : h('div', { class: 'pad faint' }, 'Nenhuma seção ou slide neste arquivo.'),
        labels.length ? h('div', { class: 'section-label' }, `Rótulos (${labels.length})`) : null,
        labels.map((l) =>
          h(
            'div',
            { class: 'list-row', title: 'Clique para ir; ⌥-clique copia \\ref{…}', onclick: (e) => (e.altKey ? (navigator.clipboard.writeText(`\\ref{${l.key}}`), toast('Copiado: \\ref{' + l.key + '}', 'ok', 1800)) : this.app.openFile(l.file, { line: l.line })) },
            h('span', { class: 'k' }, 'lbl'),
            h('span', { class: 't' }, l.key),
          ),
        ),
      ),
    );
  }
  cursorMoved(line) {
    if (this.S.sidebarView !== 'outline' || !this.outlineItems) return;
    let cur = null;
    for (const it of this.outlineItems) if (it.line <= line) cur = it.line;
    this.el.querySelectorAll('.list-row[data-line]').forEach((r) => r.classList.toggle('active', Number(r.dataset.line) === cur));
  }

  // ------------------------------------------------------------ search
  renderSearch() {
    const st = this.searchState;
    const input = h('input', { value: st.query, placeholder: 'Buscar em .tex, .bib, .md…', style: { width: '100%' } });
    const run = debounce(async () => {
      st.query = input.value;
      if (!st.query) {
        st.results = [];
        return this.renderSearchResults();
      }
      try {
        st.results = await call('search', { root: this.S.project.root, query: st.query, regex: st.regex });
      } catch (err) {
        st.results = [];
        st.error = err.message;
      }
      this.renderSearchResults();
    }, 250);
    input.addEventListener('input', run);
    this.resultsEl = h('div', { class: 'sidebar-body' });
    clear(
      this.el,
      h('div', { class: 'sidebar-head' }, h('span', { class: 'title' }, 'Buscar no projeto')),
      h(
        'div',
        { style: { padding: '0 10px 8px' } },
        input,
        h('label', { class: 'toggle', style: { marginTop: '6px' } }, h('input', { type: 'checkbox', checked: st.regex, onchange: (e) => ((st.regex = e.target.checked), run()) }), h('span', { class: 'sw' }), 'expressão regular'),
      ),
      this.resultsEl,
    );
    this.renderSearchResults();
  }

  renderSearchResults() {
    const st = this.searchState;
    if (!this.resultsEl) return;
    const byFile = new Map();
    for (const r of st.results) {
      if (!byFile.has(r.file)) byFile.set(r.file, []);
      byFile.get(r.file).push(r);
    }
    clear(
      this.resultsEl,
      st.query && !st.results.length ? h('div', { class: 'pad faint' }, 'Nada encontrado.') : null,
      st.results.length ? h('div', { class: 'section-label' }, `${st.results.length} resultado${st.results.length > 1 ? 's' : ''} em ${byFile.size} arquivo${byFile.size > 1 ? 's' : ''}`) : null,
      [...byFile].map(([file, hits]) => [
        h('div', { class: 'list-row', onclick: () => this.app.openFile(file) }, fileIcon(file), h('span', { class: 't' }, relPath(this.S.project.root, file)), h('span', { class: 'faint' }, String(hits.length))),
        hits.slice(0, 50).map((r) => {
          const before = r.text.slice(Math.max(0, r.col - 30), r.col);
          const match = r.text.slice(r.col, r.col + r.len);
          const after = r.text.slice(r.col + r.len, r.col + r.len + 80);
          return h('div', { class: 'search-hit', title: `linha ${r.line}`, onclick: () => this.app.openFile(file, { line: r.line, col: r.col }) }, before.trimStart(), h('mark', {}, match), after);
        }),
      ]),
    );
  }

  // ------------------------------------------------------------ git
  async renderGit() {
    const S = this.S;
    const g = S.git;
    const head = h('div', { class: 'sidebar-head' }, h('span', { class: 'title' }, 'Git'), h('button', { class: 'icon-btn', title: 'Atualizar', onclick: () => this.app.refreshGit() }, icon('refresh')));
    if (!g) return clear(this.el, head, h('div', { class: 'pad faint' }, 'Carregando…'));
    if (!g.repo) {
      return clear(
        this.el,
        head,
        h(
          'div',
          { class: 'pad' },
          h('p', { class: 'muted' }, 'Esta pasta ainda não é um repositório Git.'),
          h('button', { class: 'btn', onclick: async () => (await call('gitInit', { root: S.project.root }), this.app.refreshGit()) }, icon('git'), 'Criar repositório'),
          h('p', { class: 'faint', style: { marginTop: '10px' } }, 'Depois, publique no GitHub pelo GitHub Desktop (File → Add Local Repository).'),
        ),
      );
    }
    const msg = h('textarea', { rows: 2, placeholder: 'Mensagem do commit (opcional: vazia, o TeXugo escreve uma a partir dos arquivos)', style: { width: '100%', resize: 'vertical' } });
    const staged = g.files.filter((f) => f.staged);
    const unstaged = g.files.filter((f) => !f.staged || f.work !== ' ');
    const doCommit = async () => {
      const m = msg.value.trim();
      const r = await call('gitCommit', { root: S.project.root, message: m, all: staged.length === 0 });
      if (r.code === 0) toast(`Commit feito: “${r.message}”.`, 'ok');
      else toast(r.stderr || r.stdout, 'error', 8000);
      this.app.refreshGit();
    };
    const fileRow = (f, isStaged) =>
      h(
        'div',
        { class: 'git-file', title: f.rel, onclick: () => this.showDiff(f, isStaged) },
        h('span', { class: 'st ' + (f.untracked ? 'U' : isStaged ? f.index : f.work) }, f.untracked ? 'U' : isStaged ? f.index : f.work),
        h('span', { class: 'nm' }, basename(f.rel), h('span', { class: 'faint' }, '  ' + f.rel.slice(0, -basename(f.rel).length))),
        h(
          'span',
          { class: 'acts' },
          h('button', { class: 'icon-btn', title: 'Abrir', onclick: (e) => (e.stopPropagation(), this.app.openFile(f.path)) }, icon('file')),
          isStaged
            ? h('button', { class: 'icon-btn', title: 'Tirar do commit', onclick: async (e) => (e.stopPropagation(), await call('gitUnstage', { root: S.project.root, files: [f.path] }), this.app.refreshGit()) }, icon('x'))
            : h('button', { class: 'icon-btn', title: 'Pôr no commit', onclick: async (e) => (e.stopPropagation(), await call('gitStage', { root: S.project.root, files: [f.path] }), this.app.refreshGit()) }, icon('plus')),
        ),
      );
    const remoteAction = async (name, label) => {
      toast(label + '…', 'info', 1500);
      const r = await call(name, { root: S.project.root });
      if (r.code === 0) toast(label + ': ok.', 'ok');
      else toast((r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' '), 'error', 9000);
      this.app.refreshGit();
    };
    clear(
      this.el,
      head,
      h(
        'div',
        { class: 'sidebar-body' },
        h(
          'div',
          { class: 'pad' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } }, icon('git'), h('b', {}, g.branch || '(sem branch)'), g.upstream ? h('span', { class: 'faint' }, '→ ' + g.upstream) : h('span', { class: 'faint' }, 'sem remoto')),
          msg,
          h(
            'div',
            { style: { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
            h('button', { class: 'btn primary sm', onclick: doCommit, disabled: !g.files.length }, icon('commit'), staged.length ? `Commit (${staged.length})` : 'Commit de tudo'),
            g.remote
              ? h(
                  'button',
                  {
                    class: 'btn sm',
                    title: 'Commit do que mudou (se houver), pull e push, num clique',
                    onclick: async () => {
                      toast('Sincronizando…', 'info', 1500);
                      const r = await call('gitSync', { root: S.project.root, message: msg.value.trim() });
                      if (r.code === 0) toast(r.steps.length ? `Sincronizado: ${r.steps.join(', ')}.` : 'Já estava tudo sincronizado.', 'ok', 6000);
                      else toast((r.stderr || '').trim().split('\n').slice(-3).join(' '), 'error', 10000);
                      this.app.refreshGit();
                    },
                  },
                  icon('refresh'),
                  'Sincronizar',
                )
              : null,
            h('button', { class: 'btn sm', onclick: () => remoteAction('gitPull', 'Pull') }, icon('down'), 'Pull', g.behind ? ` ${g.behind}` : ''),
            h('button', { class: 'btn sm', onclick: () => remoteAction('gitPush', 'Push') }, icon('up'), 'Push', g.ahead ? ` ${g.ahead}` : ''),
            g.webUrl ? h('button', { class: 'btn sm ghost', title: 'Abrir no GitHub', onclick: () => call('openUrl', { url: g.webUrl }) }, icon('github')) : null,
          ),
        ),
        staged.length ? h('div', { class: 'section-label' }, `No commit (${staged.length})`) : null,
        staged.map((f) => fileRow(f, true)),
        h('div', { class: 'section-label' }, `Alterações (${unstaged.length})`),
        unstaged.length ? unstaged.map((f) => fileRow(f, false)) : h('div', { class: 'pad faint' }, 'Nada mudou desde o último commit.'),
        h('div', { class: 'section-label' }, 'Histórico'),
        this.historyEl = h('div', {}),
      ),
    );
    try {
      const log = await call('gitLog', { root: S.project.root });
      clear(this.historyEl, log.slice(0, 25).map((c) => h('div', { class: 'list-row', title: `${c.hash} · ${c.author} · ${new Date(c.date).toLocaleString('pt-BR')}` }, h('span', { class: 'k' }, c.hash.slice(0, 7)), h('span', { class: 't' }, c.subject))));
    } catch {}
  }

  async showDiff(f, staged) {
    const text = await call('gitDiff', { root: this.S.project.root, path: f.path, staged });
    const body = h(
      'div',
      { class: 'diff' },
      (text || '(sem diferenças de texto)').split('\n').map((l) => {
        const cls = l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : 'ctx';
        return h('span', { class: cls }, l || ' ');
      }),
    );
    modal({ title: `Diferenças: ${f.rel}`, body, wide: true, footer: [h('button', { class: 'btn', onclick: () => (document.querySelector('.overlay')?.remove(), this.app.openFile(f.path)) }, 'Abrir arquivo')] });
  }
}
