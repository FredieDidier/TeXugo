// Command palette (⌘K) and quick open (⌘P).
import { call } from './api.js';
import { tr } from './i18n.js';
import { h, clear, icon, fileIcon, relPath } from './dom.js';
import { openSettings } from './settings.js';
import { newProjectDialog, showWelcome, cloneDialog } from './welcome.js';

function commands(app, S) {
  const t = app.activeTab();
  return [
    { t: 'Compilar documento da aba', d: t && t.root ? t.root.split('/').pop() : '', k: '⌘↵', i: 'play', run: () => app.compileTab() },
    { t: 'Compilar tudo que está aberto', k: '⌘⇧↵', i: 'playAll', run: () => app.compileAll() },
    { t: 'Compilar do zero (limpa auxiliares)', i: 'broom', run: () => app.compileTab(null, { clean: true }) },
    ...(S.project.docs || []).map((d) => ({ t: `Compilar ${relPath(S.project.root, d.path)}`, d: d.kind === 'slides' ? 'slides' : d.engine, i: 'play', run: () => app.compileDocs([d.path]) })),
    { t: 'Mostrar no PDF (SyncTeX)', k: '⌘J', i: 'target', run: () => app.syncForward() },
    { t: 'Salvar', k: '⌘S', i: 'check', run: () => app.saveTab(app.activeTab()) },
    { t: 'Salvar todos', k: '⌥⌘S', i: 'check', run: () => app.saveAll() },
    { t: 'Fechar aba', k: '⌘W', i: 'x', run: () => S.active && app.closeTab(S.active) },
    { t: 'Abrir pasta…', i: 'folderOpen', run: () => app.pickAndOpen() },
    { t: 'Novo projeto a partir de modelo…', i: 'plus', run: () => newProjectDialog(app, S) },
    { t: 'Tela inicial', i: 'files', run: () => showWelcome(app, S) },
    { t: 'Clonar repositório do GitHub…', i: 'github', run: () => cloneDialog(app, S) },
    { t: 'Mostrar arquivos', k: '⌘⇧E', i: 'files', run: () => app.sidebar.show('files') },
    { t: 'Estrutura do documento', i: 'outline', run: () => app.sidebar.show('outline') },
    { t: 'Buscar no projeto', k: '⌘⇧F', i: 'search', run: () => app.sidebar.show('search') },
    { t: 'Git: commit, pull, push', i: 'git', run: () => app.sidebar.show('git') },
    { t: 'Problemas da compilação', i: 'alert', run: () => app.bottom.show('problems') },
    { t: 'Log da compilação', i: 'panel', run: () => app.bottom.show('log') },
    { t: 'Dividir o editor / fechar a divisão', k: '⌘⌥\\', i: 'columns', run: () => app.split.toggle() },
    { t: 'Mostrar/esconder painel inferior', i: 'panel', run: () => app.toggleBottom() },
    { t: 'Preferências', k: '⌘,', i: 'gear', run: () => openSettings(app, S) },
    { t: 'Parar compilação', i: 'stop', run: () => call('cancelBuild') },
    { t: 'Formatar documento (latexindent)', k: '⌥⇧F', i: 'wrap', run: () => app.tools.formatDoc(app, S) },
    { t: 'Médico do TeX (pacotes, instalação)', i: 'info', run: () => app.tools.texDoctor(app, S) },
    { t: 'Exportar ZIP para submissão (arXiv)', i: 'down', run: () => app.tools.exportZip(app, S) },
    { t: 'Checar anonimato (double-blind)', i: 'eye', run: () => app.tools.blindCheck(app, S) },
    { t: 'Revisar estilo (ChkTeX)', i: 'check', run: () => app.tools.chktex(app, S) },
    { t: 'Contar palavras (texcount)', i: 'outline', run: () => app.tools.wordCount(app, S) },
    { t: 'Abrir Terminal na pasta do projeto', i: 'command', run: () => call('openTerminal', { path: S.project.root }) },
    { t: 'Mostrar projeto no Finder', i: 'folder', run: () => call('reveal', { path: S.project.root }) },
  ];
}

export async function openPalette(app, S, mode = 'commands') {
  document.querySelector('.overlay.palette-ov')?.remove();
  let files = [];
  const input = h('input', { placeholder: mode === 'files' ? 'Nome do arquivo… (digite > para comandos)' : '> Comando…', value: mode === 'commands' ? '> ' : '' });
  const list = h('div', { class: 'items' });
  const box = h('div', { class: 'modal palette' }, input, list);
  const ov = h('div', { class: 'overlay palette-ov' }, box);
  let sel = 0;
  let items = [];
  const close = () => ov.remove();
  ov.addEventListener('mousedown', (e) => e.target === ov && close());
  document.body.append(ov);
  input.focus();
  try {
    const tree = await call('tree', { root: S.project.root });
    (function walk(nodes) {
      for (const n of nodes) n.dir ? walk(n.children) : files.push(n.path);
    })(tree.children);
  } catch {}

  const score = (text, q) => {
    // Subsequence match with a bonus for contiguous runs and word starts.
    text = text.toLowerCase();
    let ti = 0;
    let s = 0;
    let run = 0;
    for (const ch of q) {
      const i = text.indexOf(ch, ti);
      if (i < 0) return -1;
      run = i === ti ? run + 1 : 0;
      s += 1 + run * 2 + (i === 0 || /[\/._ -]/.test(text[i - 1]) ? 3 : 0);
      ti = i + 1;
    }
    return s - text.length * 0.01;
  };

  const update = () => {
    const v = input.value;
    const isCmd = v.startsWith('>');
    const q = (isCmd ? v.slice(1) : v).trim().toLowerCase();
    if (isCmd) {
      items = commands(app, S)
        .map((c) => ({ ...c, s: q ? Math.max(score(c.t + ' ' + (c.d || ''), q), score(tr(c.t) + ' ' + (c.d || ''), q)) : 0 }))
        .filter((c) => c.s >= 0)
        .sort((a, b) => b.s - a.s);
    } else {
      const open = new Set(S.tabs.map((t) => t.path));
      items = files
        .map((f) => {
          const rel = relPath(S.project.root, f);
          return { t: rel.split('/').pop(), d: rel, path: f, s: q ? score(rel, q) + (open.has(f) ? 2 : 0) : open.has(f) ? 1 : 0, run: () => app.openFile(f) };
        })
        .filter((c) => c.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 60);
    }
    sel = Math.min(sel, Math.max(0, items.length - 1));
    clear(
      list,
      items.length
        ? items.map((it, i) =>
            h(
              'div',
              { class: 'item' + (i === sel ? ' sel' : ''), onmousemove: () => i !== sel && ((sel = i), update()), onclick: () => (close(), it.run()) },
              it.path ? fileIcon(it.path) : icon(it.i || 'command'),
              h('span', { class: 't' }, it.t),
              it.d ? h('span', { class: 'd' }, it.d) : null,
              it.k ? h('kbd', {}, it.k) : null,
            ),
          )
        : h('div', { class: 'pad faint' }, 'Nada encontrado.'),
    );
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => ((sel = 0), update()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') (sel = Math.min(items.length - 1, sel + 1)), update(), e.preventDefault();
    else if (e.key === 'ArrowUp') (sel = Math.max(0, sel - 1)), update(), e.preventDefault();
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[sel];
      close();
      if (it) it.run();
    } else if (e.key === 'Escape') close();
  });
  update();
}
