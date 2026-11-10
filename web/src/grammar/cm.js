// Editor side of the grammar checker: wavy underlines (red for spelling,
// blue for grammar and style), and on hover the explanation with the
// suggested fixes as buttons. See text.js (LaTeX -> plain) and
// server/grammar.js (LanguageTool).
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, hoverTooltip, closeHoverTooltips } from '@codemirror/view';
import { call } from '../api.js';
import { getLang } from '../i18n.js';
import { grammarParagraphs, mapMatch, ltLang } from './text.js';
import { localMatches } from './local.js';
import { kindOf } from '../vicios/core.js';

// Shared switches, set from the settings. status: 'off' | 'missing' |
// 'starting' | 'checking' | 'ok' | 'error'.
export const grammarConfig = {
  enabled: true,
  server: 'local', // or 'online'
  level: 'picky', // 'picky' (rigoroso, the default) or 'default'
  words: [], // the user's dictionary
  disabledRules: [],
  status: 'off',
  error: null,
  onStatus: null, // (status) => void
  onResult: null, // (view, hits) => void
  onAddWord: null, // (word) => void
  onDisableRule: null, // (rule) => void
};

const setHits = StateEffect.define();
const refreshEffect = StateEffect.define();
const cache = new Map(); // level|lang|text -> matches
const CACHE_MAX = 4000;

function setStatus(s, error = null) {
  if (grammarConfig.status === s && grammarConfig.error === error) return;
  grammarConfig.status = s;
  grammarConfig.error = error;
  grammarConfig.onStatus && grammarConfig.onStatus(s);
}

const hitsField = StateField.define({
  create: () => ({ hits: [], deco: Decoration.none }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setHits)) return e.value;
    if (!tr.docChanged || !v.hits.length) return v;
    // An edit inside a flagged word clears that flag until the next check.
    const hits = [];
    for (const h of v.hits) {
      let touched = false;
      tr.changes.iterChangedRanges((a, b) => {
        if (a <= h.to && b >= h.from) touched = true;
      });
      if (!touched) hits.push({ ...h, from: tr.changes.mapPos(h.from, 1), to: tr.changes.mapPos(h.to, -1) });
    }
    return { hits, deco: decorate(hits) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function decorate(hits) {
  return Decoration.set(
    hits.filter((h) => h.to > h.from).map((h) => Decoration.mark({ class: h.type === 'misspelling' ? 'cm-spell' : 'cm-grammar' }).range(h.from, h.to)),
    true,
  );
}

const keyOf = (p) => `${grammarConfig.level}|${grammarConfig.server}|${grammarConfig.disabledRules.join(',')}|${p.lang}|${p.text}`;

const plugin = (path) =>
  ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.timer = null;
        this.seq = 0;
        this.schedule(400);
      }
      update(u) {
        if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)))) this.schedule(u.docChanged ? 1500 : 0);
      }
      schedule(ms) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.run(), ms);
      }
      async run() {
        const view = this.view;
        const seq = ++this.seq;
        if (!grammarConfig.enabled || grammarConfig.status === 'missing') {
          if (view.state.field(hitsField).hits.length) view.dispatch({ effects: setHits.of({ hits: [], deco: Decoration.none }) });
          return;
        }
        const doc = view.state.doc.toString();
        let paras;
        try {
          paras = grammarParagraphs(doc, path);
        } catch (err) {
          console.error('gramática:', err);
          return;
        }
        const todo = paras.filter((p) => !cache.has(keyOf(p)));
        if (todo.length) {
          setStatus(grammarConfig.status === 'ok' || grammarConfig.status === 'checking' ? 'checking' : 'starting');
          const r = await call('grammarCheck', {
            paras: todo.map((p) => ({ text: p.text, lang: ltLang(p.lang) })),
            server: grammarConfig.server,
            level: grammarConfig.level,
            disabledRules: grammarConfig.disabledRules,
          }).catch((err) => ({ error: err.message }));
          if (r.error) {
            setStatus(r.code === 'NOT_INSTALLED' ? 'missing' : 'error', r.error);
            return;
          }
          if (cache.size > CACHE_MAX) cache.clear();
          todo.forEach((p, i) => cache.set(keyOf(p), r.results[i] || []));
        }
        if (seq !== this.seq) return; // a newer check is under way
        setStatus('ok');
        // The text moved on while LanguageTool was reading: check again.
        if (view.state.doc.toString() !== doc) return this.schedule(300);
        const words = new Set(grammarConfig.words.map((w) => w.toLowerCase()));
        const hits = [];
        for (const p of paras) {
          const lt = cache.get(keyOf(p)) || [];
          for (const m of [...localMatches(p, lt), ...lt]) {
            const at = mapMatch(p, m.offset, m.length);
            if (!at || at.to <= at.from) continue;
            const word = p.text.slice(m.offset, m.offset + m.length);
            if (m.type === 'misspelling' && words.has(word.toLowerCase())) continue;
            if (grammarConfig.disabledRules.includes(m.rule)) continue;
            // An acronym read as a word ("do SIM" taken as "sim"): not ours
            // to fix.
            if (m.type !== 'misspelling' && /\b\p{Lu}{2,}\b/u.test(word)) continue;
            hits.push({ ...at, ...m, word, lang: p.lang });
          }
        }
        hits.sort((a, b) => a.from - b.from);
        const cur = view.state.field(hitsField);
        if (!hits.length && !cur.hits.length) return grammarConfig.onResult && grammarConfig.onResult(view, hits);
        view.dispatch({ effects: setHits.of({ hits, deco: decorate(hits) }) });
        grammarConfig.onResult && grammarConfig.onResult(view, hits);
      }
      destroy() {
        clearTimeout(this.timer);
        this.seq++;
      }
    },
  );

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const tooltip = hoverTooltip(
  (view, pos) => {
    const { hits } = view.state.field(hitsField);
    const here = hits.filter((h) => pos >= h.from && pos <= h.to);
    if (!here.length) return null;
    const en = getLang() === 'en';
    return {
      pos: Math.min(...here.map((h) => h.from)),
      end: Math.max(...here.map((h) => h.to)),
      above: true,
      create() {
        const dom = el('div', 'vicio-tip grammar-tip');
        for (const h of here) {
          const box = el('div', 'vicio-tip-item');
          const spell = h.type === 'misspelling';
          box.append(el('div', 'vicio-tip-title ' + (spell ? 'is-spell' : 'is-grammar'), (spell ? (en ? 'Spelling' : 'Ortografia') : h.short || h.category || (en ? 'Grammar' : 'Gramática'))));
          box.append(el('div', '', h.message));
          if (h.replacements.length) {
            const row = el('div', 'grammar-fixes');
            for (const rep of h.replacements) {
              const b = el('button', 'btn sm', rep || (en ? '(delete)' : '(apagar)'));
              b.title = en ? 'Replace' : 'Trocar';
              b.onmousedown = (e) => {
                e.preventDefault();
                view.dispatch({ changes: { from: h.from, to: h.to, insert: rep }, effects: closeHoverTooltips, userEvent: 'input.grammar' });
              };
              row.append(b);
            }
            box.append(row);
          }
          const more = el('div', 'grammar-more');
          if (spell && grammarConfig.onAddWord) {
            const a = el('button', 'link', en ? 'Add to dictionary' : 'Adicionar ao dicionário');
            a.onmousedown = (e) => (e.preventDefault(), view.dispatch({ effects: closeHoverTooltips }), grammarConfig.onAddWord(h.word));
            more.append(a);
          }
          if (h.rule && grammarConfig.onDisableRule) {
            const a = el('button', 'link', en ? 'Never flag this rule' : 'Não apontar mais esta regra');
            a.title = h.ruleDesc ? `${h.rule}: ${h.ruleDesc}` : h.rule;
            a.onmousedown = (e) => (e.preventDefault(), view.dispatch({ effects: closeHoverTooltips }), grammarConfig.onDisableRule(h.rule));
            more.append(a);
          }
          more.append(el('span', 'vicio-tip-src', /^TEXUGO_/.test(h.rule || '') ? 'TeXugo' : 'LanguageTool'));
          box.append(more);
          dom.append(box);
        }
        return { dom };
      },
    };
  },
  { hoverTime: 350 },
);

export function grammarExtension(path) {
  if (!kindOf(path || '')) return [];
  return [hitsField, plugin(path), tooltip];
}

export function grammarOf(state) {
  const v = state.field(hitsField, false);
  return v ? v.hits : [];
}

export function refreshGrammar(view) {
  if (view && view.state.field(hitsField, false)) view.dispatch({ effects: refreshEffect.of(null) });
}

// Forget everything checked so far (after changing server, level, rules).
export function resetGrammarCache() {
  cache.clear();
}
