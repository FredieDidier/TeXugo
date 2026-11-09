// Terminal panel: real terminals (xterm.js on the server's pseudo-terminals)
// in the project folder, in a tab of the bottom panel. "Claude Code" opens a
// terminal that runs `claude` connected to TeXugo (see ide.js), so Claude
// sees the selection and the compile errors and proposes edits as diffs.
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { call, on, wsSend } from './api.js';
import { h, clear, icon, toast } from './dom.js';
import { claudeChoice } from './agent.js';

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function theme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  return {
    background: css('--sunken', dark ? '#121418' : '#fbfaf7'),
    foreground: css('--text', dark ? '#e7e3da' : '#24262b'),
    cursor: css('--accent', '#b9741a'),
    cursorAccent: css('--sunken', '#fff'),
    selectionBackground: css('--sel', 'rgba(217,142,31,0.25)'),
    ...(dark
      ? { black: '#1b1e24', brightBlack: '#5c6370', red: '#ef6b62', green: '#7cc47f', yellow: '#e9a23b', blue: '#6aa9f0', magenta: '#b48ff0', cyan: '#5fc4c4', white: '#d7d3ca', brightWhite: '#ffffff' }
      : { black: '#24262b', brightBlack: '#7a7f88', red: '#c4413a', green: '#3d8b40', yellow: '#a8650f', blue: '#2f6fbf', magenta: '#8a5cc7', cyan: '#23898a', white: '#d9d5cc', brightWhite: '#ffffff' }),
  };
}

export class TerminalPanel {
  constructor(app, S) {
    this.app = app;
    this.S = S;
    this.items = new Map(); // id -> { id, kind, title, term, fit, el, exited }
    this.active = null;
    this.bar = h('div', { class: 'term-bar' });
    this.stack = h('div', { class: 'term-stack' });
    this.el = h('div', { class: 'term-panel' }, this.bar, this.stack);
    on('term:data', (e) => this.items.get(e.id)?.term.write(e.data));
    on('term:exit', (e) => {
      const t = this.items.get(e.id);
      if (t) {
        t.exited = e.code;
        this.renderBar();
      }
    });
    on('term:list', (e) => this.sync(e.items));
    // After a reconnect or a reload, take back the terminals still running.
    on('ws:open', () => call('termList').then((l) => this.sync(l)).catch(() => {}));
    new ResizeObserver(() => this.fitActive()).observe(this.stack);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.retheme());
    this.renderBar();
  }

  get count() {
    return this.items.size;
  }

  retheme() {
    for (const t of this.items.values()) t.term.options.theme = theme();
  }

  async sync(list) {
    const ids = new Set(list.map((x) => x.id));
    for (const id of [...this.items.keys()]) if (!ids.has(id)) this.drop(id);
    for (const info of list) {
      if (this.items.has(info.id)) continue;
      const snap = await call('termSnapshot', { id: info.id }).catch(() => null);
      if (snap) this.attach(snap, snap.buf);
    }
    if (!this.active && this.items.size) this.activate([...this.items.keys()][0]);
    this.renderBar();
  }

  attach(info, buf = '') {
    if (this.items.has(info.id)) return this.items.get(info.id);
    const term = new Terminal({
      fontFamily: css('--editor-font', css('--mono', 'Menlo, monospace')),
      fontSize: 12.5,
      lineHeight: 1.15,
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: 8000,
      allowProposedApi: true,
      theme: theme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => call('openUrl', { url: uri }).catch(() => window.open(uri))));
    const el = h('div', { class: 'term-view hidden' });
    this.stack.append(el);
    term.open(el);
    term.onData((data) => wsSend({ type: 'term:input', id: info.id, data }));
    term.onResize(({ cols, rows }) => wsSend({ type: 'term:resize', id: info.id, cols, rows }));
    if (buf) term.write(buf);
    const t = { ...info, term, fit, el };
    this.items.set(info.id, t);
    return t;
  }

  drop(id) {
    const t = this.items.get(id);
    if (!t) return;
    t.term.dispose();
    t.el.remove();
    this.items.delete(id);
    if (this.active === id) this.active = this.items.size ? [...this.items.keys()].pop() : null;
    if (this.active) this.activate(this.active);
    this.renderBar();
  }

  activate(id) {
    this.active = id;
    for (const [k, t] of this.items) t.el.classList.toggle('hidden', k !== id);
    this.renderBar();
    requestAnimationFrame(() => {
      this.fitActive();
      this.items.get(id)?.term.focus();
    });
  }

  fitActive() {
    const t = this.items.get(this.active);
    if (!t || !this.el.isConnected || !t.el.offsetWidth) return;
    try {
      t.fit.fit();
    } catch {}
  }

  async open(kind = 'shell') {
    if (!this.S.project) return toast('Abra um projeto primeiro.', 'warn');
    // Claude: reuse the one already running.
    if (kind === 'claude') {
      const running = [...this.items.values()].find((t) => t.kind === 'claude' && t.exited == null);
      if (running) {
        this.app.bottom.show('terminal');
        return this.activate(running.id);
      }
    }
    this.app.bottom.show('terminal');
    const dims = this.guessSize();
    let info;
    try {
      info = await call('termCreate', { root: this.S.project.root, kind, ...dims, ...(kind === 'claude' ? claudeChoice(this.S) : {}) });
    } catch (err) {
      return toast(err.message, 'error', 8000);
    }
    this.attach(info);
    this.activate(info.id);
  }

  guessSize() {
    const w = this.stack.clientWidth || 800;
    const hgt = this.stack.clientHeight || 200;
    return { cols: Math.max(40, Math.floor(w / 7.6)), rows: Math.max(8, Math.floor(hgt / 17)) };
  }

  close(id) {
    call('termKill', { id }).catch(() => {});
    this.drop(id);
  }

  focus() {
    this.items.get(this.active)?.term.focus();
  }

  renderBar() {
    clear(
      this.bar,
      [...this.items.values()].map((t) =>
        h(
          'div',
          { class: 'term-tab' + (t.id === this.active ? ' active' : '') + (t.exited != null ? ' exited' : ''), onclick: () => this.activate(t.id), title: t.cwd || '' },
          h('span', { class: 'term-kind' + (t.kind === 'claude' ? ' claude' : '') }, t.kind === 'claude' ? '✻' : '›'),
          h('span', {}, t.title),
          h('span', { class: 'close', title: 'Fechar terminal', onclick: (e) => (e.stopPropagation(), this.close(t.id)) }, icon('x')),
        ),
      ),
      h('button', { class: 'btn sm ghost', title: 'Novo terminal na pasta do projeto', onclick: () => this.open('shell') }, icon('plus'), 'Terminal'),
      h('button', { class: 'btn sm', title: 'Abre o Claude Code ligado ao TeXugo: ele vê a seleção e os erros de compilação, e cada edição que propõe aparece aqui como diferença para aceitar ou recusar.', onclick: () => this.open('claude') }, h('span', { class: 'term-kind claude' }, '✻'), 'Claude Code'),
      this.items.size ? null : h('span', { class: 'muted', style: { fontSize: '12px', marginLeft: '6px' } }, 'Um terminal de verdade, na pasta do projeto.'),
    );
  }
}
