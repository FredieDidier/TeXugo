// Page side of the Claude Code bridge (server/ide.js): reports the open tabs
// and the selection while Claude Code is connected, and answers its requests
// (show a proposed edit as a diff, open a file, save).
import { call, on } from './api.js';
import { h, icon, toast, modal, basename, debounce } from './dom.js';
import { wordDiff } from './diff.js';

export function setupIde(app, S) {
  S.ideClients = 0;
  const mine = (p) => S.project && p && p.startsWith(S.project.root + '/');
  const reply = (askId, answer) => call('uiReply', { askId, answer }).catch(() => {});

  // ------------------------------------------------------------ state out
  const selectionOf = (view, tab) => {
    const st = view.state;
    const r = st.selection.main;
    const pos = (p) => {
      const l = st.doc.lineAt(p);
      return { line: l.number - 1, character: p - l.from };
    };
    return { filePath: tab.path, text: st.sliceDoc(r.from, r.to), start: pos(r.from), end: pos(r.to), isEmpty: r.empty };
  };
  const push = () => {
    if (!S.ideClients || !S.project) return;
    const t = app.activeTab();
    const tabs = S.tabs.filter((x) => !x.binary).map((x) => ({ path: x.path, active: x === t, dirty: !!x.dirty, lines: (x === t ? app.view.state : x.state)?.doc.lines || 0 }));
    let selection = null;
    const inSplit = app.split.open && app.split.el.contains(document.activeElement);
    if (inSplit && app.split.tab) selection = selectionOf(app.split.view, app.split.tab);
    else if (t && !t.binary) selection = selectionOf(app.view, t);
    call('ideState', { tabs, selection }).catch(() => {});
  };
  app.idePush = debounce(push, 150);

  on('ide:clients', (e) => {
    const was = S.ideClients;
    S.ideClients = e.count;
    if (e.count && !was) {
      push();
      toast('Claude Code ligado ao TeXugo: ele vê a sua seleção e os erros de compilação.', 'ok', 5000);
    }
    app.renderStatus();
  });

  // ------------------------------------------------------------ requests in
  on('ide:openFile', async (e) => {
    if (!mine(e.path)) return;
    await app.openFile(e.path, { line: e.startLine, focus: e.focus });
    const t = S.tabs.find((x) => x.path === e.path);
    if (t && e.startText && t.path === S.active) {
      const doc = app.view.state.doc.toString();
      const a = doc.indexOf(e.startText);
      if (a >= 0) {
        let b = a + e.startText.length;
        if (e.endText) {
          const k = doc.indexOf(e.endText, a);
          if (k >= 0) b = k + e.endText.length;
        }
        if (e.selectToEndOfLine) b = app.view.state.doc.lineAt(b).to;
        app.view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
      }
    }
    reply(e.askId, { ok: true });
  });

  on('ide:save', async (e) => {
    if (!mine(e.path)) return;
    const t = S.tabs.find((x) => x.path === e.path);
    reply(e.askId, { saved: t ? await app.saveTab(t, { quiet: true }) : false });
  });

  on('ide:dirty', (e) => {
    if (!mine(e.path)) return;
    toast(`O Claude quer editar ${basename(e.path)}, mas há alterações não salvas. Salve (⌘S) e peça de novo.`, 'warn', 9000);
  });

  const open = new Map(); // reqId -> modal
  on('ide:closeDiff', (e) => {
    const m = open.get(e.reqId);
    if (m) m.close();
  });

  on('ide:openDiff', (e) => {
    if (!mine(e.path)) return;
    let answered = false;
    const answer = (accepted) => {
      if (answered) return;
      answered = true;
      open.delete(e.reqId);
      reply(e.askId, { accepted });
    };
    const m = modal({
      wide: true,
      title: [h('span', { class: 'term-kind claude' }, '✻'), ` Claude Code quer ${e.isNew ? 'criar' : 'editar'} ${basename(e.path)}`],
      body: h(
        'div',
        { class: 'ai-diff' },
        h('p', { class: 'muted' }, 'Se você aceitar, o Claude grava o arquivo e o TeXugo recarrega a aba (⌘Z desfaz). Se recusar, ele não grava e pergunta o que fazer.'),
        fileDiff(e.oldText, e.newText),
      ),
      footer: [
        h('span', { class: 'faint', style: { fontSize: '11.5px' } }, e.tabName || ''),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn', onclick: () => (answer(false), m.close()) }, 'Recusar'),
        h('button', { class: 'btn primary', onclick: () => (answer(true), m.close()) }, icon('check'), 'Aceitar'),
      ],
      onClose: () => answer(false),
    });
    open.set(e.reqId, m);
    m.el.addEventListener('keydown', (k) => k.key === 'Enter' && (k.metaKey || k.ctrlKey) && (k.preventDefault(), answer(true), m.close()));
  });
}

// "Mencionar no Claude": puts the file and lines of the selection into the
// Claude Code prompt (like @file#L10-20).
export async function mentionInClaude(app, S, target) {
  const { view, tab } = target || { view: app.view, tab: app.activeTab() };
  if (!tab || tab.binary) return;
  if (!S.ideClients) {
    toast('Abra o Claude Code pelo TeXugo primeiro (painel inferior, aba Terminal).', 'warn', 6000);
    return app.terminals.open('claude');
  }
  const r = view.state.selection.main;
  const a = view.state.doc.lineAt(r.from).number - 1;
  const b = view.state.doc.lineAt(r.empty ? r.from : Math.max(r.from, r.to - 1)).number - 1;
  await call('ideMention', { path: tab.path, lineStart: a, lineEnd: b });
  app.bottom.show('terminal');
  app.terminals.focus();
}

// The changed region of a whole file, with two lines of context, as a word
// diff; the rest of the file is summarized.
function fileDiff(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const ctx = 2;
  const from = Math.max(0, p - ctx);
  const oldMid = a.slice(from, a.length - Math.max(0, s - ctx)).join('\n');
  const newMid = b.slice(from, b.length - Math.max(0, s - ctx)).join('\n');
  const t = (x) => document.createTextNode(x);
  const parts = wordDiff(oldMid, newMid).map((d) => (d.op === 'eq' ? t(d.s) : h(d.op, {}, t(d.s))));
  const first = p + 1;
  const lastOld = a.length - s;
  return h(
    'div',
    {},
    h('p', { class: 'faint', style: { fontSize: '12px' } }, oldText ? `Linhas ${first}–${Math.max(first, lastOld)} de ${a.length}` : `Arquivo novo, ${b.length} linhas`),
    h('div', { class: 'ai-diff-text' }, parts),
  );
}
