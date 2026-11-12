// "Quem escreveu cada trecho": a gutter with who last changed each line (git
// blame of the editor's own text, so it follows unsaved edits). The first
// line of each run carries the author's initials; the rest of the run a bar
// in the author's colour. Hover: name, date and commit; click: the commit.
import { locale } from './i18n.js';
import { StateEffect, StateField, RangeSet, Compartment } from '@codemirror/state';
import { gutter, GutterMarker, EditorView } from '@codemirror/view';
import { call } from './api.js';
import { h, toast, modal, debounce, relPath } from './dom.js';

export const setBlame = StateEffect.define();
export const blameCompartment = new Compartment();
const COLORS = 8;

// Stable colour per author within the session; you are always neutral.
const colorOf = new Map();
export function authorColor(c) {
  if (c.me) return 'var(--blame-me)';
  const key = c.email || c.author || '?';
  if (!colorOf.has(key)) colorOf.set(key, colorOf.size % COLORS);
  return `var(--blame-${colorOf.get(key)})`;
}

export function initials(name) {
  const parts = String(name || '?').replace(/[<>()]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const who = (c) => (c.local ? 'Você (ainda sem commit)' : c.me ? `Você (${c.author})` : c.author);
const when = (c) => (c.time ? new Date(c.time).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

class AuthorMarker extends GutterMarker {
  constructor(c, first) {
    super();
    this.c = c;
    this.first = first;
  }
  eq(o) {
    return o.c === this.c && o.first === this.first;
  }
  toDOM() {
    const c = this.c;
    const title = c.local ? 'Você, ainda sem commit' : `${who(c)} · ${when(c)}\n${c.summary || ''}\nClique para ver o commit`;
    return h('div', { class: 'cm-blame-m' + (this.first ? ' first' : '') + (c.local ? ' local' : ''), style: { '--c': authorColor(c) }, title }, this.first ? (c.local ? '•' : initials(c.author)) : '');
  }
}
const spacer = new AuthorMarker({ author: 'WW', me: true }, true);

function build(state, data) {
  if (!data || !data.lines) return RangeSet.empty;
  const out = [];
  const n = Math.min(state.doc.lines, data.lines.length);
  let prev = null;
  for (let i = 0; i < n; i++) {
    const c = data.commits[data.lines[i]];
    if (!c) continue;
    out.push(new AuthorMarker(c, c !== prev).range(state.doc.line(i + 1).from));
    prev = c;
  }
  return RangeSet.of(out);
}

// Markers follow edits until the next blame arrives; new lines get none.
export const blameField = StateField.define({
  create: () => RangeSet.empty,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setBlame)) return build(tr.state, e.value);
    return tr.docChanged ? v.map(tr.changes) : v;
  },
});

let onClick = null;
const blameGutter = gutter({
  class: 'cm-blame-gutter',
  markers: (v) => v.state.field(blameField),
  initialSpacer: () => spacer,
  domEventHandlers: {
    mousedown(view, line) {
      let found = null;
      view.state.field(blameField).between(line.from, line.from, (_a, _b, m) => {
        found = m;
      });
      if (found && !found.c.local && onClick) {
        onClick(found.c);
        return true;
      }
      return false;
    },
  },
});

export const blameOn = [blameField, blameGutter];

// Lines per author in the last blame of a tab, most first.
export function shares(data) {
  if (!data || !data.lines) return [];
  const count = new Map();
  for (const hash of data.lines) {
    const c = data.commits[hash];
    const key = c.local || c.me ? '__me' : c.email || c.author;
    if (!count.has(key)) count.set(key, { name: c.local || c.me ? 'Você' : c.author, c, n: 0 });
    count.get(key).n++;
  }
  const total = data.lines.length || 1;
  return [...count.values()].sort((a, b) => b.n - a.n).map((x) => ({ ...x, pct: Math.round((100 * x.n) / total) }));
}

// The app side: one switch for every tab; the active tab is blamed when it
// is shown, saved, or two seconds after typing stops.
export function setupBlame(app, S) {
  const ctl = {
    on: false,
    data: new Map(), // tab path -> last blame
    async refresh(t) {
      if (!ctl.on || !t || t.binary || t.path !== S.active || !S.project) return;
      const view = app.view;
      const text = view.state.doc.toString();
      let r;
      try {
        r = await call('gitBlame', { root: S.project.root, path: t.path, text });
      } catch (err) {
        return toast(err.message, 'error');
      }
      if (!ctl.on || t.path !== S.active || view.state.doc.toString() !== text) return;
      if (!r.repo) return ctl.note('Este projeto não está no Git: não há autoria a mostrar.');
      if (!r.tracked) return ctl.note(`${relPath(S.project.root, t.path)} ainda não entrou num commit: tudo nele é seu.`);
      if (r.error) return ctl.note(r.error);
      ctl.data.set(t.path, r);
      view.dispatch({ effects: setBlame.of(r) });
      app.refreshRevisao && app.refreshRevisao();
    },
    noted: new Set(),
    note(msg) {
      if (ctl.noted.has(msg)) return;
      ctl.noted.add(msg);
      toast(msg, 'info', 6000);
    },
    // Puts the gutter in (or out of) the view's state for the shown tab.
    apply(t) {
      if (!t || t.binary || t.path !== S.active) return;
      const view = app.view;
      const has = view.state.field(blameField, false) !== undefined;
      if (ctl.on !== has) {
        view.dispatch({ effects: blameCompartment.reconfigure(ctl.on ? blameOn : []) });
        // CodeMirror re-measures wrapped lines only when the scroller's width
        // changes, not when a gutter narrows the text: ask for it the way it
        // does itself after web fonts load.
        requestAnimationFrame(() => {
          if (view.viewState) view.viewState.mustMeasureContent = 'refresh';
          view.requestMeasure();
        });
      }
      if (ctl.on) ctl.refresh(t);
    },
    toggle(on = !ctl.on) {
      ctl.on = on;
      ctl.noted.clear();
      ctl.apply(app.activeTab());
      app.renderDocBar && app.renderDocBar();
      app.refreshRevisao && app.refreshRevisao();
      if (on) toast('Autoria ligada: as iniciais na margem dizem quem escreveu cada trecho. Clique nelas para ver o commit.', 'info', 6000);
    },
    changed: debounce((t) => ctl.on && ctl.refresh(t), 2000),
    stats(t) {
      return t ? shares(ctl.data.get(t.path)) : [];
    },
  };
  onClick = async (c) => {
    const t = app.activeTab();
    const text = await call('gitShow', { root: S.project.root, rev: c.hash, path: t && t.path });
    diffModal(`${c.hash.slice(0, 7)} · ${c.author}`, text, t && (() => app.openFile(t.path)));
  };
  return ctl;
}

// A unified diff in a modal, coloured line by line.
export function diffModal(title, text, open) {
  const body = h(
    'div',
    { class: 'diff' },
    (text || '(sem diferenças de texto)').split('\n').map((l) => {
      const cls = l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : 'ctx';
      return h('span', { class: cls }, l || ' ');
    }),
  );
  const m = modal({ title, body, wide: true, footer: open ? [h('button', { class: 'btn', onclick: () => (m.close(), open()) }, 'Abrir arquivo')] : [] });
  return m;
}
