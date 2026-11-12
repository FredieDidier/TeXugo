// "Resposta aos pareceristas": paste the reports, pick the submitted
// version; the user's Claude Code drafts response.tex with each comment,
// its reply and where the paper changed (line and page).
import { call, native } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal } from './dom.js';
import { claudeChoice, CLAUDE_MODELS, CLAUDE_EFFORTS } from './agent.js';

let running = null;

export function responseDialog(app, S) {
  const t = app.activeTab();
  const doc = t && t.root;
  if (!doc) return toast('Abra um arquivo do paper (o documento que foi submetido).', 'warn');
  if (running) return toast('A resposta aos pareceristas ainda está sendo escrita.', 'info');
  const reports = h('textarea', { rows: 10, placeholder: 'Cole aqui a carta do editor e os pareceres, como vieram (Editor, Referee 1, Referee 2…).', style: { width: '100%', fontSize: '12.5px' } });
  let kind = 'git';
  const commitSel = h('select', { style: { width: '100%' } }, h('option', {}, 'Carregando…'));
  let commits = [];
  call('gitLog', { root: S.project.root, path: doc })
    .then((log) => {
      commits = log || [];
      if (!commits.length) throw new Error();
      clear(commitSel, commits.map((c) => h('option', { value: c.hash }, `${c.date.slice(0, 10)} · ${c.subject.slice(0, 70)}`)));
    })
    .catch(() => {
      clear(commitSel, h('option', { value: '' }, 'Sem Git nesta pasta'));
      if (kind === 'git') pickKind('path');
    });
  const pathIn = h('input', { placeholder: 'O .tex, o ZIP ou a pasta que você submeteu', style: { flex: 1 } });
  const pick = native && native.pickVersion ? h('button', { class: 'btn', onclick: async () => { const p = await native.pickVersion(); if (p) pathIn.value = p; } }, 'Escolher…') : null;
  const panes = {
    git: h('div', {}, commitSel, h('p', { class: 'faint', style: { fontSize: '12px', margin: '4px 0 0' } }, 'O commit da versão que foi submetida. O Claude compara com o texto atual.')),
    path: h('div', { class: 'row' }, pathIn, pick),
    none: h('p', { class: 'faint', style: { fontSize: '12px', margin: 0 } }, 'Ainda não revisou? O Claude rascunha as respostas e diz o que mudar em cada ponto e onde.'),
  };
  const kindBtns = h('div', { class: 'row', style: { gap: '6px', marginBottom: '6px' } });
  const pickKind = (k) => {
    kind = k;
    for (const [id, el] of Object.entries(panes)) el.style.display = id === k ? '' : 'none';
    kindBtns.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b.dataset.k === k));
  };
  for (const [k, label] of [['git', 'Commit do Git'], ['path', 'Arquivo enviado'], ['none', 'Ainda não revisei']]) kindBtns.append(h('button', { class: 'btn sm', 'data-k': k, onclick: () => pickKind(k) }, label));
  const lang = h('select', {}, h('option', { value: 'en' }, 'Inglês'), h('option', { value: 'pt' }, 'Português'));
  const choice = claudeChoice(S);
  const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id;
  const status = h('div');
  const go = h('button', { class: 'btn primary' }, icon('play'), 'Escrever a resposta');

  go.onclick = async () => {
    if (reports.value.trim().length < 40) return toast('Cole os pareceres.', 'warn');
    let source = null;
    if (kind === 'git') {
      const c = commits.find((x) => x.hash === commitSel.value);
      if (!c) return toast('Escolha o commit da versão submetida.', 'warn');
      source = { kind: 'git', rev: c.hash, label: `the submitted version (commit ${c.hash})` };
    } else if (kind === 'path') {
      if (!pathIn.value.trim()) return toast('Escolha o arquivo submetido.', 'warn');
      source = { kind: 'path', path: pathIn.value.trim() };
    }
    if (app.saveAll) await app.saveAll();
    go.disabled = true;
    const start = Date.now();
    const tick = setInterval(() => {
      const s = Math.round((Date.now() - start) / 1000);
      clear(status, h('p', { class: 'faint' }, h('span', { class: 'status-dot building' }), ` O Claude está lendo os pareceres e as mudanças… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}. Pode fechar esta janela; o arquivo abre quando ficar pronto. `, h('a', { href: '#', onclick: (e) => (e.preventDefault(), call('aiCancel', { root: S.project && S.project.root })) }, 'Cancelar')));
    }, 1000);
    running = call('respondReferees', { root: S.project.root, doc, reports: reports.value, source, lang: lang.value, ...choice });
    try {
      const r = await running;
      m.close();
      await app.openFile(r.file);
      app.refreshRevisao && app.refreshRevisao();
      toast(`${relPath(S.project.root, r.file)}: ${r.comments} comentários${r.todo ? `, ${r.todo} ainda a fazer (em vermelho)` : ''}.${r.pages ? '' : ' Compile o paper pelo TeXugo para as mudanças ganharem a página.'} ⌘-clique no comentário % arquivo:linha abre a mudança.`, 'ok', 12000);
    } catch (err) {
      clear(status, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, err.message)));
      toast('Resposta aos pareceristas: ' + err.message, 'error', 8000);
    } finally {
      clearInterval(tick);
      running = null;
      go.disabled = false;
    }
  };

  const m = modal({
    title: [icon('review'), ` Resposta aos pareceristas: ${basename(doc)}`],
    wide: true,
    body: h(
      'div',
      {},
      h('div', { class: 'field' }, h('label', {}, 'Pareceres'), reports),
      h('div', { class: 'field' }, h('label', {}, 'Versão submetida'), kindBtns, panes.git, panes.path, panes.none),
      h('div', { class: 'field' }, h('label', {}, 'Língua da carta'), lang),
      h('p', { class: 'faint', style: { fontSize: '12px' } }, `Sai um response.tex: cada comentário num quadro, a resposta, e “Change in the paper” com a seção e a página, ou “To do” em vermelho para o que falta. Modelo ${label(CLAUDE_MODELS, choice.model)}, esforço ${label(CLAUDE_EFFORTS, choice.effort).toLowerCase()}. O Claude só lê; o único arquivo escrito é o response.tex.`),
      status,
    ),
    footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Fechar'), go],
  });
  pickKind('git');
  setTimeout(() => reports.focus(), 0);
}
