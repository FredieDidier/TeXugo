// Editor side of the writing-tic detector: dotted underlines, an explanation
// on hover, and the current hits for the status bar and the report.
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, hoverTooltip, tooltips, closeHoverTooltips } from '@codemirror/view';
import { detect, kindOf, CATEGORIES, SOURCES } from './core.js';
import { getLang } from '../i18n.js';

// Shared switches, set from the settings; onResult tells the app a view's
// hits changed (status bar count); agentName names the agent that replaces.
export const viciosConfig = { enabled: true, lang: 'auto', onResult: null, agentName: () => 'Claude' };

const setHits = StateEffect.define();
const refreshEffect = StateEffect.define();

const hitsField = StateField.define({
  create: () => ({ hits: [], deco: Decoration.none }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setHits)) return e.value;
    if (!tr.docChanged || !v.hits.length) return v;
    const hits = v.hits
      .map((h) => ({ ...h, from: tr.changes.mapPos(h.from, 1), to: tr.changes.mapPos(h.to, -1) }))
      .filter((h) => h.to > h.from);
    return { hits, deco: v.deco.map(tr.changes) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function decorate(hits) {
  return Decoration.set(
    hits.map((h) => Decoration.mark({ class: `cm-vicio cm-vicio-${h.cat}` }).range(h.from, h.to)),
    true,
  );
}

const plugin = (kind) =>
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.timer = null;
        this.schedule(50);
      }
      update(u) {
        if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)))) this.schedule(u.docChanged ? 600 : 0);
      }
      schedule(ms) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.run(), ms);
      }
      run() {
        const view = this.view;
        let hits = [];
        if (viciosConfig.enabled) {
          try {
            hits = detect(view.state.doc.toString(), { kind, lang: viciosConfig.lang }).hits;
          } catch (err) {
            console.error('vícios:', err);
          }
        }
        const cur = view.state.field(hitsField);
        if (!hits.length && !cur.hits.length) return;
        view.dispatch({ effects: setHits.of({ hits, deco: decorate(hits) }) });
        viciosConfig.onResult && viciosConfig.onResult(view, hits);
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
  );

// The explanation shown on hover.
export function hitInfo(h) {
  const en = getLang() === 'en';
  const cat = CATEGORIES[h.cat] || { pt: h.cat, en: h.cat };
  const srcs = (h.src || '').split('').map((k) => SOURCES[k]).filter(Boolean);
  return { title: en ? cat.en : cat.pt, text: en ? h.en : h.pt, fix: en ? h.fixEn : h.fix, era: h.era, sources: srcs };
}

const tooltip = hoverTooltip((view, pos) => {
  const { hits } = view.state.field(hitsField);
  const here = hits.filter((h) => pos >= h.from && pos <= h.to);
  if (!here.length) return null;
  return {
    pos: Math.min(...here.map((h) => h.from)),
    end: Math.max(...here.map((h) => h.to)),
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'vicio-tip';
      for (const h of here) {
        const info = hitInfo(h);
        const box = document.createElement('div');
        box.className = 'vicio-tip-item';
        const t = document.createElement('div');
        t.className = 'vicio-tip-title';
        t.textContent = info.title + (info.era ? ` · ${info.era}` : '');
        const p = document.createElement('div');
        p.textContent = info.text;
        box.append(t, p);
        if (info.fix) {
          const f = document.createElement('div');
          f.className = 'vicio-tip-fix';
          f.textContent = info.fix;
          box.append(f);
        }
        if (info.sources.length) {
          const s = document.createElement('div');
          s.className = 'vicio-tip-src';
          s.textContent = (getLang() === 'en' ? (info.sources.length > 1 ? 'Sources of this rule: ' : 'Source of this rule: ') : info.sources.length > 1 ? 'Fontes desta regra: ' : 'Fonte desta regra: ') + info.sources.map((x) => x.t.split(',')[0].split(':')[0]).join('; ');
          box.append(s);
        }
        dom.append(box);
      }
      if (viciosConfig.onReplace) {
        const b = document.createElement('button');
        b.className = 'btn sm vicio-tip-replace';
        const who = viciosConfig.agentName();
        b.textContent = getLang() === 'en' ? `✻ Replace with ${who}` : `✻ Trocar com o ${who}`;
        b.title = getLang() === 'en' ? `${who} rewrites only the flagged words of this sentence; you accept or discard` : `O ${who} troca só o trecho sublinhado desta frase; você aceita ou descarta`;
        const from = Math.min(...here.map((x) => x.from));
        const to = Math.max(...here.map((x) => x.to));
        b.onmousedown = (e) => (e.preventDefault(), view.dispatch({ effects: closeHoverTooltips }), viciosConfig.onReplace(view, from, to));
        dom.append(b);
      }
      return { dom };
    },
  };
}, { hoverTime: 350 });

export function viciosExtension(path) {
  const kind = kindOf(path || '');
  if (!kind) return [];
  // Tooltips live in <body>, so a narrow editor pane does not clip them.
  return [hitsField, plugin(kind), tooltip, tooltips({ parent: document.body })];
}

export function viciosOf(state) {
  const v = state.field(hitsField, false);
  return v ? v.hits : [];
}

export function refreshVicios(view) {
  if (view.state.field(hitsField, false)) view.dispatch({ effects: refreshEffect.of(null) });
}
