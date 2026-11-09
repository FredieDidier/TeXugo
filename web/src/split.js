// Split editor: a second pane beside the main editor showing any open tab,
// by default the active one (two places of the same file).
//
// The tab's text has one owner: the main view's state when the tab is
// active, t.state otherwise. The split view keeps its own EditorState (own
// cursor, scroll and undo history) and the two are kept identical by
// forwarding each change, tagged with `synced` so it is not sent back.
import { Annotation } from '@codemirror/state';
import { createState, EditorView } from './editor.js';
import { h, clear, icon, gutter } from './dom.js';

const synced = Annotation.define();
export const isSynced = (u) => u.transactions.some((tr) => tr.annotation(synced));

export class SplitEditor {
  constructor(app, S) {
    this.app = app;
    this.S = S;
    this.tab = null;
    this.head = h('div', { class: 'split-head' });
    this.host = h('div', { class: 'split-host' });
    this.el = h('div', { class: 'split-pane hidden' }, this.head, this.host);
    this.gutter = gutter('v', {
      getSize: () => this.el.getBoundingClientRect().width,
      setSize: (w) => {
        S.settings.splitWidth = Math.max(160, Math.min(w, innerWidth - 700));
        this.applyWidth();
        app.saveSettingsSoon();
      },
      invert: true,
    });
    this.gutter.classList.add('hidden');
    this.view = new EditorView({ parent: this.host });
  }

  // Half and half until the divider is dragged.
  applyWidth() {
    const w = this.S.settings.splitWidth;
    this.el.style.flex = w ? 'none' : '';
    this.el.style.width = w ? w + 'px' : '';
  }

  get open() {
    return !!this.tab;
  }

  // Current state of the tab's text, wherever it lives.
  mainState(t) {
    return t.path === this.S.active ? this.app.view.state : t.state;
  }

  show(t) {
    if (!t || t.binary || !t.state) return;
    this.tab = t;
    const hooks = {
      save: () => this.app.saveTab(t),
      compile: () => this.app.compileTab(t),
      compileAll: () => this.app.compileAll(),
      syncForward: () => {
        const pos = this.view.state.selection.main.head;
        const line = this.view.state.doc.lineAt(pos);
        this.app.syncForward({ tab: t, line: line.number, col: pos - line.from + 1 });
      },
      format: () => {},
      onChange: (u) => !isSynced(u) && this.toMain(t, u),
    };
    const st = createState(this.mainState(t).doc.toString(), t.path, hooks, this.S.settings);
    this.view.setState(st);
    this.applyWidth();
    this.el.classList.remove('hidden');
    this.gutter.classList.remove('hidden');
    this.render();
    this.app.saveUiSoon();
  }

  close() {
    this.tab = null;
    this.el.classList.add('hidden');
    this.gutter.classList.add('hidden');
    this.app.saveUiSoon();
    this.app.renderDocBar();
  }

  toggle() {
    if (this.open) this.close();
    else this.show(this.app.activeTab());
    this.app.renderDocBar();
  }

  // Split -> main.
  toMain(t, u) {
    for (const tr of u.transactions) {
      if (!tr.docChanged) continue;
      const spec = { changes: tr.changes, annotations: synced.of(true) };
      if (t.path === this.S.active) this.app.view.dispatch(spec);
      else {
        t.state = t.state.update(spec).state;
        // No update object: the change must not be forwarded back here.
        t.hooks.onChange();
      }
    }
  }

  // Main -> split, called from the main view's change hook.
  fromMain(t, u) {
    if (this.tab !== t || isSynced(u)) return;
    for (const tr of u.transactions) if (tr.docChanged) this.view.dispatch({ changes: tr.changes, annotations: synced.of(true) });
  }

  // After the tab's text was replaced outside the views (reload from disk).
  resync(t) {
    if (this.tab !== t) return;
    const text = this.mainState(t).doc.toString();
    const cur = this.view.state.doc;
    if (cur.toString() === text) return;
    this.view.dispatch({ changes: { from: 0, to: cur.length, insert: text }, annotations: synced.of(true) });
  }

  tabClosed(t) {
    if (this.tab === t) this.close();
  }

  render() {
    const t = this.tab;
    if (!t) return;
    const tabs = this.S.tabs.filter((x) => !x.binary && x.state);
    clear(
      this.head,
      h(
        'select',
        {
          class: 'split-select',
          title: 'Arquivo mostrado no lado direito',
          onchange: (e) => this.show(tabs.find((x) => x.path === e.target.value)),
        },
        tabs.map((x) => h('option', { value: x.path, selected: x === t }, x.name)),
      ),
      t.dirty ? h('span', { class: 'faint', title: 'Alterações não salvas' }, '●') : null,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'icon-btn', title: 'Fechar a divisão (⌘⌥\\)', onclick: () => this.close() }, icon('x')),
    );
  }
}
