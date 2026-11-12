// Command palette (⌘K), quick open (⌘P) and go to line (⌃G, or ":42").
import { AI_ACTIONS, runAiAction } from './ai.js';
import { call } from './api.js';
import { tr } from './i18n.js';
import { h, clear, icon, fileIcon, relPath, basename, REVEAL, toast } from './dom.js';
import { openSettings } from './settings.js';
import { newProjectDialog, showWelcome, cloneDialog } from './welcome.js';
import { markDialog, feedbackDialog } from './sent.js';
import { fuzzyScore, bestScore } from './fuzzy.js';

function commands(app, S) {
  const t = app.activeTab();
  return [
    { t: 'Compilar documento da aba', d: t && t.root ? basename(t.root) : '', k: '⌘↵', i: 'play', run: () => app.compileTab() },
    { t: 'Compilar tudo que está aberto', k: '⌘⇧↵', i: 'playAll', run: () => app.compileAll() },
    { t: 'Compilar do zero (limpa auxiliares)', i: 'broom', run: () => app.compileTab(null, { clean: true }) },
    ...(S.project.docs || []).map((d) => ({ t: `Compilar ${relPath(S.project.root, d.path)}`, d: d.kind === 'slides' ? 'slides' : d.engine, i: 'play', run: () => app.compileDocs([d.path]) })),
    ...(t && t.root ? [{ t: t.livePreview ? 'Desligar a prévia ao vivo' : 'Ligar a prévia ao vivo (PDF enquanto digita)', kw: 'live preview ao vivo tempo real enquanto digita automático', i: 'play', run: () => app.live.setOn(t, !t.livePreview) }] : []),
    { t: 'Corretor gramatical: lista do arquivo', kw: 'gramática ortografia spelling grammar languagetool corretor erros', i: 'edit', run: () => app.grammarList() },
    { t: 'Ir para a linha…', kw: 'goto go to line linha número pular', k: '⌃G', i: 'target', run: () => openPalette(app, S, 'line') },
    { t: 'Mostrar no PDF', kw: 'synctex', k: '⌘J', i: 'target', run: () => app.syncForward() },
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
    { t: 'Referências do projeto (.bib, verificar no Crossref)', kw: 'bib bibtex citar crossref doi papers bibliografia verificar checar', i: 'book', run: () => app.sidebar.show('refs') },
    { t: 'Comentar o trecho selecionado', kw: 'comentário comentar nota coautor anotação discussão', i: 'comment', run: () => app.comments.add(app.view, app.activeTab()) },
    {
      t: 'Remover e-mails dos comentários',
      kw: 'comentários email e-mail privacidade limpar autor',
      i: 'comment',
      run: async () => {
        const n = await call('commentsStripEmails', { root: S.project.root });
        toast(n ? `E-mail removido de ${n} comentário${n === 1 ? '' : 's'}. Faça um commit para levar a limpeza ao repositório.` : 'Nenhum comentário tinha e-mail.', 'ok', 6000);
        app.comments.load();
      },
    },
    { t: 'Comentários no texto (seus e dos coautores)', kw: 'comentários comentário coautor discussão responder resolver', i: 'comment', run: () => app.bottom.show('comentarios') },
    { t: 'Marcar a versão enviada (para ler o retorno contra ela)', kw: 'enviar enviada versão marcar coautor amigo leitor retorno sugestões', i: 'papers', run: () => markDialog(app, S) },
    { t: 'Recebi um retorno: ler as sugestões contra a versão enviada', kw: 'retorno sugestões recebi versão enviada comparar coautor amigo leitor pdf anotado', i: 'down', run: () => feedbackDialog(app, S) },
    { t: 'Pacote de replicação: checklist da revista', kw: 'replicação replication pacote data editor dcas readme seed dados código aea econometrica zenodo dataverse', i: 'papers', run: () => app.bottom.show('replicacao') },
    { t: 'Novidades dos coautores desde a sua última visita', kw: 'git commits coautor novidades mudanças quem mudou pull remoto', i: 'users', run: () => app.bottom.show('novidades') },
    { t: 'Mostrar ou esconder quem escreveu cada trecho', kw: 'autoria blame git coautor quem escreveu linha', i: 'users', run: () => app.blame.toggle() },
    { t: 'Revisão: coautores, pareceristas, antes de enviar', kw: 'revisão revisar submissão submeter coautor parecerista checklist', i: 'clipboard', run: () => app.sidebar.show('revisao') },
    { t: 'Git: commit, pull, push', i: 'git', run: () => app.sidebar.show('git') },
    { t: 'Problemas da compilação', i: 'alert', run: () => app.bottom.show('problems') },
    { t: 'Log da compilação', i: 'panel', run: () => app.bottom.show('log') },
    { t: 'Dividir o editor / fechar a divisão', k: '⌘⌥\\', i: 'columns', run: () => app.split.toggle() },
    { t: 'Mostrar/esconder painel inferior', i: 'panel', run: () => app.toggleBottom() },
    { t: 'Atalhos e comandos (manual)', kw: 'ajuda help teclado atalho keyboard shortcuts manual onde fica', k: '⌘?', i: 'command', run: () => app.shortcuts() },
    { t: 'Preferências', k: '⌘,', i: 'gear', run: () => openSettings(app, S) },
    { t: 'Parar compilação', i: 'stop', run: () => call('cancelBuild') },
    { t: 'Revisar como parecerista (parecer do Claude)', kw: 'referee report parecer revisão claude ia ai review', i: 'review', run: () => app.review() },
    { t: 'Parecer: ver o último', kw: 'referee report parecer', i: 'review', run: async () => (await app.loadLastReview(), app.bottom.show('parecer')) },
    { t: 'Resposta aos pareceristas (R&R, response letter)', kw: 'r&r revise resubmit response letter referee resposta parecer carta', i: 'letter', run: () => app.respond() },
    { t: 'Anotações do PDF (Preview, Acrobat, coautor)', kw: 'anotações annotations highlight destaque nota comentários pdf coautor preview acrobat', i: 'edit', run: () => app.annotations() },
    { t: 'Comparar com outra versão (PDF com mudanças)', kw: 'latexdiff diff coautor overleaf zip commit revisão mudanças marcadas', i: 'columns', run: () => app.compare() },
    { t: 'Biblioteca de papers (ler e buscar no texto)', kw: 'biblioteca library papers pdf ler leitura buscar busca texto artigos literatura zotero', k: '⌥⌘B', i: 'papers', run: () => app.library() },
    { t: 'Importar do Zotero (ou .bib do Mendeley, Paperpile)', kw: 'zotero mendeley paperpile bib bibtex biblioteca importar referências', i: 'down', run: () => app.zotero() },
    { t: 'Adicionar referência (DOI, arXiv, título)', kw: 'bib bibtex citar cite crossref paper doi arxiv', k: '⌥⌘R', i: 'plus', run: () => app.addReference() },
    { t: 'Colar tabela (Excel, CSV) como LaTeX', kw: 'csv planilha excel numbers sheets booktabs tabular', i: 'outline', run: () => app.pasteTable() },
    { t: 'Formatar documento', kw: 'latexindent indentar', k: '⌥⇧F', i: 'wrap', run: () => app.tools.formatDoc(app, S) },
    { t: 'Médico do TeX (pacotes, instalação)', i: 'info', run: () => app.tools.texDoctor(app, S) },
    { t: 'Exportar ZIP para submissão', kw: 'arxiv', i: 'down', run: () => app.tools.exportZip(app, S) },
    ...AI_ACTIONS.map((a) => ({ t: `IA: ${a.label} (seleção)`, kw: 'claude ia ai reescrever ' + a.hint, i: 'edit', run: () => runAiAction(app, S, a.id) })),
    { t: 'Abrir terminal na pasta do projeto', k: '⌃`', kw: 'shell zsh bash console', i: 'command', run: () => app.terminals.open('shell') },
    { t: 'Claude: conversar sobre o projeto', kw: 'chat agente ia ai claude perguntar', i: 'claude', run: () => app.sidebar.show('claude') },
    { t: 'Claude Code (ligado ao TeXugo)', kw: 'claude agente ia ai terminal', i: 'command', run: () => app.terminals.open('claude') },
    { t: 'Perguntar ao Claude sobre a seleção', kw: 'claude at mention arroba', i: 'command', run: () => app.mentionInClaude() },
    { t: 'Vícios de escrita (tiques de IA)', kw: 'ia ai detector humanizar estilo travessão', i: 'edit', run: () => app.tools.viciosReport(app, S) },
    { t: 'Checar antes de submeter (anonimato, fontes Type 3)', kw: 'double-blind blind pdffonts', i: 'eye', run: () => app.tools.blindCheck(app, S) },
    { t: 'Revisar estilo', kw: 'chktex lint', i: 'check', run: () => app.tools.chktex(app, S) },
    { t: 'Contar palavras', kw: 'texcount', i: 'outline', run: () => app.tools.wordCount(app, S) },
    { t: 'Abrir Terminal na pasta do projeto', i: 'command', run: () => call('openTerminal', { path: S.project.root }) },
    { t: REVEAL === 'Mostrar no Finder' ? 'Mostrar projeto no Finder' : 'Mostrar projeto na pasta', i: 'folder', run: () => call('reveal', { path: S.project.root }) },
  ];
}

// The commands used last come first when nothing is typed.
const RECENT_KEY = 'texugo-palette-recent';
function recentCommands() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}
function rememberCommand(t) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...recentCommands().filter((x) => x !== t)].slice(0, 6)));
  } catch {}
}

export async function openPalette(app, S, mode = 'commands') {
  document.querySelector('.overlay.palette-ov')?.remove();
  const opener = document.activeElement;
  let files = [];
  const input = h('input', {
    placeholder: 'Arquivo ou comando…   > só comandos   : linha',
    value: mode === 'commands' ? '> ' : mode === 'line' ? ':' : '',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    'aria-autocomplete': 'list',
    'aria-label': 'Buscar arquivo ou comando',
    spellcheck: 'false',
  });
  const list = h('div', { class: 'items', id: 'palette-list', role: 'listbox' });
  const hints = h('div', { class: 'hints' });
  const box = h('div', { class: 'modal palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paleta de comandos' }, input, list, hints);
  const ov = h('div', { class: 'overlay palette-ov' }, box);
  let sel = 0;
  let items = [];
  const close = (back = true) => {
    ov.remove();
    if (back && opener && opener.isConnected) opener.focus({ preventScroll: true });
  };
  const run = (it) => {
    close(!it);
    if (!it) return;
    if (it.cmd) rememberCommand(it.t);
    it.run();
  };
  ov.addEventListener('mousedown', (e) => e.target === ov && close());
  document.body.append(ov);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const hint = (keys, what) => h('span', {}, h('kbd', {}, keys), what);
  const update = () => {
    const v = input.value;
    const isCmd = v.startsWith('>');
    const isLine = v.startsWith(':');
    const q = (isCmd || isLine ? v.slice(1) : v).trim().toLowerCase();
    let empty = 'Nada encontrado.';
    if (isLine) {
      const t = app.activeTab();
      const total = t && !t.binary ? app.view.state.doc.lines : 0;
      const n = Number(q);
      items = [];
      if (!total) empty = 'Abra um arquivo de texto para ir a uma linha.';
      else if (!q) empty = `Digite o número da linha (1 a ${total}).`;
      else if (!Number.isInteger(n) || n < 1) empty = 'Digite só o número da linha.';
      else {
        const line = Math.min(n, total);
        items = [{ t: `Ir para a linha ${line}`, d: n > total ? `${t.name} tem ${total} linhas` : t.name, i: 'target', run: () => app.openFile(t.path, { line }) }];
      }
    } else {
      // One search for both: what was asked for first (commands after ">",
      // files otherwise), then the matches of the other kind.
      const open = new Set(S.tabs.map((t) => t.path));
      const fileItems = () =>
        files
          .map((f) => {
            const rel = relPath(S.project.root, f);
            const base = q ? fuzzyScore(rel, q) : 0;
            return { t: basename(rel), d: rel, path: f, s: base < 0 ? -1 : base + (open.has(f) ? 2 : 0), run: () => app.openFile(f) };
          })
          .filter((c) => c.s >= 0)
          .sort((a, b) => b.s - a.s);
      const all = commands(app, S).map((c) => ({ ...c, cmd: true }));
      const cmdItems = () =>
        all
          .map((c) => ({ ...c, s: bestScore([c.t + ' ' + (c.d || ''), tr(c.t), c.kw], q) }))
          .filter((c) => c.s >= 0)
          .sort((a, b) => b.s - a.s);
      if (isCmd && !q) {
        const rec = recentCommands().map((t) => all.find((c) => c.t === t)).filter(Boolean);
        items = [...rec.map((c) => ({ ...c, g: 'Usados por último' })), ...all.filter((c) => !rec.includes(c)).map((c) => ({ ...c, g: rec.length ? 'Todos os comandos' : null }))];
      } else if (isCmd) {
        const fs = fileItems().slice(0, 8);
        items = [...cmdItems().map((c) => ({ ...c, g: fs.length ? 'Comandos' : null })), ...fs.map((c) => ({ ...c, g: 'Arquivos' }))];
      } else {
        const fs = fileItems().slice(0, 60);
        const cs = q.length >= 2 ? cmdItems().slice(0, 6) : [];
        items = [...fs.map((c) => ({ ...c, g: cs.length ? 'Arquivos' : null })), ...cs.map((c) => ({ ...c, g: 'Comandos' }))];
        if (!files.length && !items.length) empty = 'Lendo os arquivos do projeto…';
      }
    }
    sel = Math.min(sel, Math.max(0, items.length - 1));
    const row = (it, i) =>
      h(
        'div',
        { class: 'item' + (i === sel ? ' sel' : ''), id: 'palette-opt-' + i, role: 'option', 'aria-selected': i === sel ? 'true' : 'false', onmousemove: () => i !== sel && ((sel = i), update()), onclick: () => run(it) },
        it.path ? fileIcon(it.path) : icon(it.i || 'command'),
        h('span', { class: 't' }, it.t),
        it.d ? h('span', { class: 'd' }, it.d) : null,
        it.k ? h('kbd', {}, it.k) : null,
      );
    clear(
      list,
      items.length
        ? items.map((it, i) => [it.g && (i === 0 || items[i - 1].g !== it.g) ? h('div', { class: 'group', role: 'presentation' }, it.g) : null, row(it, i)])
        : h('div', { class: 'pad muted', role: 'status' }, empty),
    );
    if (items.length) input.setAttribute('aria-activedescendant', 'palette-opt-' + sel);
    else input.removeAttribute('aria-activedescendant');
    clear(hints, hint('↑↓', 'escolher'), hint('↵', isLine ? 'ir' : isCmd ? 'executar' : 'abrir'), isCmd || isLine ? null : hint('>', 'só comandos'), isLine ? null : hint(':', 'ir para a linha'), hint('esc', 'fechar'));
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => ((sel = 0), update()));
  input.addEventListener('keydown', (e) => {
    const move = (to) => ((sel = Math.max(0, Math.min(items.length - 1, to))), update(), e.preventDefault());
    if (e.key === 'ArrowDown') move(sel === items.length - 1 ? 0 : sel + 1);
    else if (e.key === 'ArrowUp') move(sel === 0 ? items.length - 1 : sel - 1);
    else if (e.key === 'PageDown') move(sel + 8);
    else if (e.key === 'PageUp') move(sel - 8);
    else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[sel]);
    } else if (e.key === 'Escape') (e.stopPropagation(), close());
    else if (e.key === 'Tab') e.preventDefault();
  });
  update();
  try {
    const tree = await call('tree', { root: S.project.root });
    (function walk(nodes) {
      for (const n of nodes) n.dir ? walk(n.children) : files.push(n.path);
    })(tree.children);
  } catch {}
  if (ov.isConnected) update();
}
