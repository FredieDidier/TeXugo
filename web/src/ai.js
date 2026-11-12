// AI writing actions on the selection: the server runs the user's Claude
// Code; here we pick the selection, show progress, and show the result as a
// word diff to accept (one undoable edit) or discard.
import { call } from './api.js';
import { h, icon, toast, modal, basename } from './dom.js';
import { detect, kindOf } from './vicios/core.js';
import { hitInfo } from './vicios/cm.js';
import { wordDiff } from './diff.js';
import { claudeChoice } from './agent.js';

export const AI_ACTIONS = [
  { id: 'trocar', label: 'Trocar o trecho marcado', hint: 'Só o que o detector de vícios sublinhou muda' },
  { id: 'revisar', label: 'Revisar', hint: 'Gramática, clareza e afirmações exageradas' },
  { id: 'reescrever', label: 'Reescrever', hint: 'Mais livre: muda a estrutura das frases, mantém o conteúdo' },
  { id: 'polir', label: 'Polir', hint: 'Palavras melhores, mesmo sentido e tamanho' },
  { id: 'humanizar', label: 'Humanizar (tirar tiques de IA)', hint: 'Usa os vícios sublinhados como pista' },
  { id: 'encurtar', label: 'Encurtar', hint: 'Cerca de um terço a menos, sem cortar ressalvas' },
  { id: 'traduzir', label: 'Traduzir para o inglês', hint: 'Inglês acadêmico, sem decalques do português' },
  { id: 'fluidez', label: 'Fluidez e coesão', hint: 'Ligação entre frases e parágrafos' },
  { id: 'formal', label: 'Deixar mais formal', hint: 'Registro de artigo, sem inflar' },
];

// The view the user is working in (main editor or the split pane) and its tab.
export function focusedTarget(app) {
  const inSplit = app.split.open && app.split.el.contains(document.activeElement);
  if (inSplit) return { view: app.split.view, tab: app.split.tab };
  return { view: app.view, tab: app.activeTab() };
}

// From a vício tooltip: select the sentence around the flagged span and ask
// Claude to replace just the flagged words.
export function replaceFlagged(app, S, view, from, to) {
  const doc = view.state.doc;
  const line = doc.lineAt(from);
  const text = line.text;
  let a = from - line.from;
  let b = to - line.from;
  while (a > 0 && !/[.!?]\s/.test(text.slice(a - 2, a))) a--;
  const m = /[.!?](\s|$)/.exec(text.slice(b));
  b = m ? b + m.index + 1 : text.length;
  view.dispatch({ selection: { anchor: line.from + a, head: line.from + b } });
  const tab = app.split.open && app.split.view === view ? app.split.tab : app.activeTab();
  return runAiAction(app, S, 'trocar', { view, tab });
}

export async function runAiAction(app, S, action, target = focusedTarget(app)) {
  const { view, tab } = target;
  const act = AI_ACTIONS.find((a) => a.id === action);
  if (!tab || tab.binary || !view) return toast('Abra um arquivo de texto.', 'warn');
  const sel = view.state.selection.main;
  if (sel.empty) return toast('Selecione o trecho que o Claude deve reescrever.', 'warn');
  const doc = view.state.doc;
  const raw = doc.sliceString(sel.from, sel.to);
  // Leading and trailing white space stays outside the rewrite.
  const lead = raw.match(/^\s*/)[0];
  const trail = raw.slice(lead.length).match(/\s*$/)[0];
  const from = sel.from + lead.length;
  const to = sel.to - trail.length;
  const text = doc.sliceString(from, to);
  if (!text.trim()) return toast('Selecione um trecho com texto.', 'warn');
  const before = doc.sliceString(Math.max(0, from - 1200), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + 1200));
  const kind = kindOf(tab.path) || 'txt';
  const full = detect(doc.toString(), { kind });
  const hints = full.hits
    .filter((x) => x.from >= from && x.to <= to)
    .slice(0, 40)
    .map((x) => ({ text: doc.sliceString(x.from, x.to).slice(0, 120), why: hitInfo(x).title + ': ' + x.en }));
  const lang = detect(text, { kind }).stats.lang;
  if (action === 'trocar' && !hints.length) return toast('Nada sublinhado pelo detector de vícios neste trecho.', 'info');

  let cancelled = false;
  const wait = modal({
    title: [icon('edit'), ` ${act.label}`],
    body: h('div', {}, h('p', {}, h('span', { class: 'status-dot building' }), ' O Claude Code está reescrevendo o trecho selecionado…'), h('p', { class: 'muted' }, 'Roda na pasta do projeto, com a sua conta e as suas skills. Leva de 10 segundos a um minuto.')),
    footer: [h('button', { class: 'btn', onclick: () => ((cancelled = true), call('aiCancel', { root: S.project && S.project.root }), wait.close()) }, 'Cancelar')],
    onClose: () => {
      if (!cancelled) {
        cancelled = true;
        call('aiCancel', { root: S.project && S.project.root });
      }
    },
  });
  let r;
  try {
    r = await call('aiRewrite', { root: S.project.root, path: tab.path, action, text, before, after, hints, lang, ...claudeChoice(S) });
  } catch (err) {
    if (!cancelled) {
      wait.close();
      toast(err.message, 'error', 8000);
    }
    return;
  }
  if (cancelled) return;
  cancelled = true;
  wait.close();
  if (r.text === text) return toast('O Claude não mudou nada nesse trecho.', 'info');
  showDiff(app, { view, tab, from, to, text, r, act });
}

function showDiff(app, { view, tab, from, to, text, r, act }) {
  const accept = () => {
    if (view.state.doc.sliceString(from, to) !== text) {
      toast('O trecho mudou enquanto o Claude trabalhava. Selecione de novo e repita.', 'warn', 7000);
      return;
    }
    view.dispatch({ changes: { from, to, insert: r.text }, selection: { anchor: from, head: from + r.text.length }, userEvent: 'input.ai', scrollIntoView: true });
    m.close();
    view.focus();
    toast('Trecho trocado. ⌘Z desfaz.', 'ok');
  };
  const m = modal({
    wide: true,
    title: [icon('edit'), ` ${act.label}: ${basename(tab.path)}`],
    body: h(
      'div',
      { class: 'ai-diff' },
      r.note ? h('p', {}, document.createTextNode(r.note)) : null,
      h('div', { class: 'ai-diff-text' }, diffNodes(text, r.text)),
      h('p', { class: 'faint', style: { fontSize: '12px' } }, `${(r.ms / 1000).toFixed(0)} s${r.style ? ` · estilo: ${basename(r.style)}` : ''}`),
    ),
    footer: [
      h('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(r.text).then(() => toast('Copiado.', 'ok')) }, 'Copiar'),
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn', onclick: () => m.close() }, 'Descartar'),
      h('button', { class: 'btn primary', onclick: accept }, icon('check'), 'Aceitar'),
    ],
  });
  m.el.addEventListener('keydown', (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), accept()));
}

function diffNodes(a, b) {
  // Text nodes, not strings: h() would run the author's words through the UI
  // translation.
  const t = (s) => document.createTextNode(s);
  return wordDiff(a, b).map((p) => (p.op === 'eq' ? t(p.s) : h(p.op, {}, t(p.s))));
}
