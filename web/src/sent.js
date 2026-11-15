// "Versões enviadas" on the page: mark the version you send to someone,
// then read what comes back against it (server/sent.js). The suggestions
// live in the "Sugestões" tab of the bottom panel, one person's return at a
// time; each one is accepted (applied to the editor, ⌘Z undoes), rejected,
// or, in a conflict, merged by hand or by Claude.
import { call, native } from './api.js';
import { h, clear, icon, toast, modal, basename, relPath } from './dom.js';
import { getLang, locale } from './i18n.js';
import { locate } from '../../server/anchor.js';
import { pieces } from '../../server/textdiff.js';
import { fromSent } from './annotations.js';

const L = (pt, en) => (getLang() === 'en' ? en : pt);
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return L(`há ${Math.max(m, 1)} min`, `${Math.max(m, 1)} min ago`);
  if (m < 48 * 60) return L(`há ${Math.round(m / 60)} h`, `${Math.round(m / 60)} h ago`);
  return new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
};
const day = (iso) => new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
const STATUS = {
  aplica: () => L('aplica direto', 'applies as is'),
  feita: () => L('já está no texto', 'already in the text'),
  conflito: () => L('conflito', 'conflict'),
  sumiu: () => L('trecho sumiu', 'passage gone'),
};

export async function loadSent(app, S) {
  const root = S.project && S.project.root;
  if (!root) return null;
  try {
    const r = await call('sentList', { root });
    S.sent = { root, ...r, current: S.sent && S.sent.root === root ? S.sent.current : null };
  } catch (err) {
    S.sent = { root, error: err.message, marks: [], feedback: [] };
  }
  return S.sent;
}

// Open suggestions across all returns (for the tab count and Revisão).
export function sentCount(S) {
  return S.sent && S.sent.feedback ? S.sent.feedback.reduce((n, f) => n + ((f.counts && f.counts.open) || 0), 0) : 0;
}

const docOf = (app) => {
  const t = app.activeTab();
  return t && t.root;
};

export function markDialog(app, S) {
  const doc = docOf(app);
  if (!doc) return toast(L('Abra um arquivo do paper.', 'Open a file of the paper.'), 'warn');
  const to = h('input', { placeholder: L('Ana, Bruno', 'Ana, Bruno'), style: { width: '100%' } });
  const note = h('input', { placeholder: L('Opcional: “versão para a conferência”', 'Optional: “conference version”'), style: { width: '100%' } });
  const go = async () => {
    try {
      const meta = await call('sentMark', { root: S.project.root, doc, to: to.value, note: note.value });
      m.close();
      toast(
        meta.stale
          ? L('Versão marcada. O PDF é mais antigo que o texto: compile e marque de novo se for mandar o PDF, para as anotações dele baterem.', 'Version marked. The PDF is older than the text: compile and mark again if you send the PDF, so annotations on it line up.')
          : meta.pdf
            ? L(`Versão marcada${meta.to ? ` (para ${meta.to})` : ''}: texto, PDF e SyncTeX guardados.`, `Version marked${meta.to ? ` (for ${meta.to})` : ''}: text, PDF and SyncTeX kept.`)
            : L('Versão marcada (sem PDF: compile antes, se for mandar o PDF).', 'Version marked (no PDF: compile first if you send the PDF).'),
        meta.stale ? 'warn' : 'ok',
        8000,
      );
      await loadSent(app, S);
      app.refreshRevisao && app.refreshRevisao();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  to.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  const m = modal({
    title: [icon('papers'), ' ', L('Marcar a versão enviada', 'Mark the version you sent')],
    body: h(
      'div',
      {},
      h('p', { style: { marginTop: 0 } }, L('O TeXugo guarda o texto como está agora, com o PDF e o SyncTeX. Quando o retorno chegar, mesmo que você já tenha mudado o texto, ele é lido contra esta versão: aparecem só as mudanças de quem mandou.', 'TeXugo keeps the text as it is now, with the PDF and SyncTeX. When feedback comes back, even if you have changed the text since, it is read against this version: only that person’s changes show.')),
      h('div', { class: 'field' }, h('label', {}, L('Para quem', 'Sent to')), to),
      h('div', { class: 'field' }, h('label', {}, L('Nota', 'Note')), note),
      h('p', { class: 'faint', style: { fontSize: '12px' } }, L('Fica em .texugo/sent, só no seu computador (fora do Git).', 'Kept in .texugo/sent, on your computer only (outside Git).')),
    ),
    footer: [h('button', { class: 'btn primary', onclick: go }, L('Marcar', 'Mark'))],
  });
  setTimeout(() => to.focus(), 30);
}

// Unsaved editor texts, so "today" is what the user sees.
function buffers(app, S) {
  const out = {};
  for (const t of S.tabs) if (t.dirty && !t.binary && t.state) out[t.path] = (t.path === S.active ? app.view.state : t.state).doc.toString();
  return out;
}

export async function feedbackDialog(app, S, { markId = null } = {}) {
  const doc = docOf(app);
  if (!doc) return toast(L('Abra um arquivo do paper.', 'Open a file of the paper.'), 'warn');
  await loadSent(app, S);
  const marks = (S.sent.marks || []).filter((x) => x.doc === relPath(S.project.root, doc));
  const pathIn = h('input', { placeholder: L('O .tex, o ZIP ou a pasta que voltou', 'The .tex, ZIP or folder that came back'), style: { flex: 1 } });
  const pick = native && native.pickVersion ? h('button', { class: 'btn', onclick: async () => { const p = await native.pickVersion(); if (p) pathIn.value = p; } }, L('Escolher…', 'Choose…')) : null;
  const mk = marks.find((x) => x.id === markId);
  const from = h('input', { value: mk && mk.to ? mk.to : '', placeholder: L('Nome de quem mandou', 'Who sent it'), style: { width: '100%' } });
  const base = h(
    'select',
    { style: { width: '100%' } },
    h('option', { value: '' }, L('Descobrir sozinho (a versão enviada ou o commit mais parecido)', 'Find it (the sent version or commit closest to it)')),
    marks.map((x) => h('option', { value: x.id, selected: x.id === markId }, L(`Enviada${x.to ? ' a ' + x.to : ''} em ${day(x.date)}${x.note ? ' · ' + x.note : ''}`, `Sent${x.to ? ' to ' + x.to : ''} on ${day(x.date)}${x.note ? ' · ' + x.note : ''}`))),
  );
  // The newest ZIPs and .tex files in Downloads, where Overleaf's download
  // and e-mail attachments land. The newest one that arrived after the
  // version was sent is filled in.
  const found = h('div', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } });
  const fill = (f) => {
    pathIn.value = f.path;
    for (const b of found.querySelectorAll('button')) b.classList.toggle('primary', b.dataset.path === f.path);
  };
  call('recentDownloads', {})
    .then((files) => {
      if (!files.length) return;
      const since = mk ? Date.parse(mk.date) : (marks[0] && Date.parse(marks[0].date)) || 0;
      clear(found, L('No Downloads: ', 'In Downloads: '), files.slice(0, 4).map((f) => h('button', { class: 'btn sm', 'data-path': f.path, title: f.path, style: { margin: '2px 4px 2px 0' }, onclick: () => fill(f) }, f.name, h('span', { style: { opacity: 0.75 } }, ' · ' + ago(f.mtime)))));
      const fresh = files.find((f) => f.mtime > since && /\.zip$/i.test(f.name));
      if (fresh && since && !pathIn.value) fill(fresh);
    })
    .catch(() => {});
  const status = h('div');
  const go = h('button', { class: 'btn primary' }, icon('play'), L('Ler as sugestões', 'Read the suggestions'));
  go.onclick = async () => {
    const p = pathIn.value.trim();
    if (!p) return toast(L('Escolha o arquivo que voltou.', 'Choose the file that came back.'), 'warn');
    if (/\.pdf$/i.test(p)) {
      m.close();
      return fromSent(app, S, doc, p, base.value || (marks[0] && marks[0].id) || null, from.value.trim());
    }
    go.disabled = true;
    clear(status, h('div', { class: 'faint', style: { marginTop: '8px' } }, h('span', { class: 'status-dot building' }), ' ', L('Comparando…', 'Comparing…')));
    try {
      const fb = await call('sentFeedback', { root: S.project.root, doc, source: { kind: 'path', path: p }, base: base.value ? { kind: 'sent', id: base.value } : null, buffers: buffers(app, S), from: from.value.trim() });
      m.close();
      await loadSent(app, S);
      S.sent.current = fb.id;
      S.sent.fb = fb;
      app.bottom.show('sugestoes');
      app.refreshRevisao && app.refreshRevisao();
      if (!fb.items.length) toast(L('Nenhuma mudança no texto em relação à versão de base.', 'No text changes against the base version.'), 'info', 8000);
    } catch (err) {
      go.disabled = false;
      clear(status, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, err.message)));
    }
  };
  const m = modal({
    title: [icon('down'), ' ', L('Recebi um retorno', 'Feedback came back')],
    body: h(
      'div',
      {},
      h('div', { class: 'field' }, h('label', {}, L('O que voltou', 'What came back')), h('div', { class: 'row' }, pathIn, pick), found, h('p', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, L('Um .tex, um ZIP (do Overleaf, por exemplo) ou uma pasta. Para um PDF anotado, escolha o PDF: as notas são ligadas à versão enviada e achadas no texto de hoje.', 'A .tex, a ZIP (from Overleaf, say) or a folder. For an annotated PDF, choose the PDF: notes are tied to the sent version and found in today’s text.'))),
      h('div', { class: 'field' }, h('label', {}, L('De quem', 'From')), from),
      h('div', { class: 'field' }, h('label', {}, L('Comparar com', 'Compare with')), base),
      status,
    ),
    footer: [go],
  });
}

// ------------------------------------------------------------ applying

async function viewFor(app, file) {
  await app.openFile(file, { focus: false });
  return app.view;
}

async function apply(app, S, fb, s, { useArea = false } = {}) {
  const view = await viewFor(app, s.file);
  const text = view.state.doc.toString();
  const at = useArea ? locate(text, s.area.anchor) : locate(text, s.anchor);
  if (!at) return toast(L('O trecho mudou desde a leitura. Leia o retorno de novo.', 'The passage changed since it was read. Read the feedback again.'), 'warn', 7000), false;
  const insert = useArea ? s.area.theirs : s.theirs;
  view.dispatch({ changes: { from: at.from, to: at.to, insert }, selection: { anchor: at.from + insert.length }, scrollIntoView: true, userEvent: 'input.suggestion' });
  return true;
}

async function decide(app, S, fb, s, decision) {
  try {
    const next = await call('sentDecide', { root: S.project.root, id: fb.id, n: s.n, decision });
    S.sent.fb = next;
    const row = (S.sent.feedback || []).find((f) => f.id === fb.id);
    if (row) row.counts = next.counts;
  } catch (err) {
    toast(err.message, 'error');
  }
  app.bottom.show('sugestoes', { soft: true });
  app.refreshRevisao && app.refreshRevisao();
}

function askClaude(app, S, fb, s) {
  app.sidebar.show('claude');
  if (!app.agent) return;
  app.agent.input.value = L(
    `${fb.from || 'Um leitor'} sugeriu uma mudança num trecho que mudou desde que o paper foi enviado (${relPath(S.project.root, s.file)}, perto da linha ${s.line}).\n\nComo estava na versão enviada:\n${s.area.sent}\n\nComo está hoje:\n${s.mine}\n\nComo ${fb.from || 'o leitor'} sugeriu (sobre a versão enviada):\n${s.area.theirs}\n\nJunte as duas: mantenha o que mudou desde o envio e incorpore a sugestão, se ainda fizer sentido. Mostre a mudança antes de aplicar.`,
    `${fb.from || 'A reader'} suggested a change to a passage that has changed since the paper was sent (${relPath(S.project.root, s.file)}, near line ${s.line}).\n\nAs sent:\n${s.area.sent}\n\nAs it is today:\n${s.mine}\n\nAs ${fb.from || 'the reader'} suggested (on the sent version):\n${s.area.theirs}\n\nMerge them: keep what changed since sending and bring in the suggestion if it still makes sense. Show the change before applying it.`,
  );
  app.agent.input.focus();
}

const diffEl = (a, b) =>
  h(
    'div',
    { class: 'sug-diff' },
    pieces(a, b).map(([k, t]) => (k === 'eq' ? t : h('span', { class: k === 'ins' ? 'add' : 'del' }, t))),
  );

// ------------------------------------------------------------ the panel

export async function renderSentPanel(app, S, el) {
  const root = S.project && S.project.root;
  if (!root) return clear(el, h('div', { class: 'pad faint' }, L('Abra um projeto.', 'Open a project.')));
  if (!S.sent || S.sent.root !== root) await loadSent(app, S);
  const list = S.sent.feedback || [];
  if (!list.length)
    return clear(
      el,
      h('div', { class: 'pad muted' }, L('Nenhum retorno lido ainda. Na aba Revisão: “Marcar o envio” quando mandar o paper, e “Recebi o retorno” quando ele voltar.', 'No feedback read yet. In the Review tab: “Mark as sent” when you send the paper, and “Feedback came back” when it returns.')),
    );
  const cur = S.sent.current && list.find((f) => f.id === S.sent.current) ? S.sent.current : list[0].id;
  if (!S.sent.fb || S.sent.fb.id !== cur) {
    try {
      S.sent.fb = await call('sentFeedbackGet', { root, id: cur });
    } catch (err) {
      return clear(el, h('div', { class: 'pad' }, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, err.message))));
    }
  }
  S.sent.current = cur;
  const fb = S.sent.fb;
  const c = fb.counts;
  const rerender = () => app.bottom.show('sugestoes', { soft: true });

  const sel = h(
    'select',
    { class: 'sm', onchange: (e) => ((S.sent.current = e.target.value), rerender()) },
    list.map((f) => h('option', { value: f.id, selected: f.id === cur }, `${f.from || f.source} · ${day(f.date)} ${new Date(f.date).toTimeString().slice(0, 5)}${f.counts && f.counts.open ? ` · ${f.counts.open} ${L('em aberto', 'open')}` : ''}`)),
  );
  const applicable = fb.items.filter((s) => s.status === 'aplica' && !s.decision);
  const acceptAll = applicable.length
    ? h(
        'button',
        {
          class: 'btn sm primary',
          onclick: async () => {
            let ok = 0;
            // From the end of each file backwards, so earlier offsets stay valid.
            for (const s of [...applicable].sort((a, b) => (a.file === b.file ? b.line - a.line : a.file.localeCompare(b.file)))) {
              if (await apply(app, S, fb, s)) {
                ok++;
                await call('sentDecide', { root, id: fb.id, n: s.n, decision: 'aceita' }).catch(() => {});
              }
            }
            S.sent.fb = await call('sentFeedbackGet', { root, id: fb.id });
            await loadSent(app, S);
            toast(L(`${ok} sugestões aplicadas no editor. Revise e salve; ⌘Z desfaz.`, `${ok} suggestions applied in the editor. Review and save; ⌘Z undoes.`), 'ok', 7000);
            rerender();
            app.refreshRevisao && app.refreshRevisao();
          },
        },
        L(`Aceitar as ${applicable.length} que aplicam direto`, `Accept the ${applicable.length} that apply as is`),
      )
    : null;
  const commitBtn =
    S.git && S.git.repo && fb.items.some((s) => s.decision === 'aceita')
      ? h('button', { class: 'btn sm', onclick: () => ((S.commitDraft = L(`Sugestões de ${fb.from || fb.source}`, `Suggestions from ${fb.from || fb.source}`)), app.sidebar.show('git')) }, icon('commit'), L('Commit…', 'Commit…'))
      : null;
  const del = h(
    'button',
    {
      class: 'icon-btn',
      title: L('Esquecer este retorno (o texto não muda)', 'Forget this feedback (the text does not change)'),
      onclick: async () => {
        await call('sentFeedbackDelete', { root, id: fb.id });
        S.sent.fb = null;
        S.sent.current = null;
        await loadSent(app, S);
        rerender();
        app.refreshRevisao && app.refreshRevisao();
      },
    },
    icon('trash'),
  );
  const parts = [c.aplica && L(`${c.aplica} aplicam direto`, `${c.aplica} apply as is`), c.feita && L(`${c.feita} já no texto`, `${c.feita} already in`), c.conflito && L(`${c.conflito} em conflito`, `${c.conflito} in conflict`), c.sumiu && L(`${c.sumiu} em trechos que sumiram`, `${c.sumiu} on passages gone`)].filter(Boolean);
  const head = h(
    'div',
    { class: 'sug-head' },
    sel,
    acceptAll,
    commitBtn,
    h('span', { style: { flex: 1 } }),
    del,
  );
  const mk = fb.base.kind === 'sent' ? (S.sent.marks || []).find((x) => x.id === fb.base.id) : null;
  const baseName =
    fb.base.kind === 'sent'
      ? mk
        ? L(`a versão enviada${mk.to ? ' a ' + mk.to : ''} em ${day(mk.date)}`, `the version sent${mk.to ? ' to ' + mk.to : ''} on ${day(mk.date)}`)
        : L('a versão enviada', 'the sent version')
      : L(`o commit ${fb.base.rev.slice(0, 7)}`, `commit ${fb.base.rev.slice(0, 7)}`);
  const baseLine = h(
    'div',
    { class: 'faint sug-base' },
    L(`Lido contra ${baseName}`, `Read against ${baseName}`),
    fb.guessed ? L(' (a mais parecida com o que voltou)', ' (the closest to what came back)') : '',
    '. ',
    parts.length ? `${fb.items.length} ${L('sugestões', 'suggestions')}: ${parts.join(', ')}.` : L('Nenhuma mudança.', 'No changes.'),
  );

  const row = (s) => {
    const where = h('span', { class: 'sug-where click', title: L('Ir ao trecho', 'Go to the passage'), onclick: () => app.openFile(s.file, { line: s.line }) }, `${basename(s.file)}:${s.line}`);
    const chip = h('span', { class: `chip sug-${s.status}` }, STATUS[s.status]());
    const decided = s.decision ? h('span', { class: 'sug-decided' }, s.decision === 'aceita' ? L('aceita', 'accepted') : L('rejeitada', 'rejected'), ' · ', h('a', { href: '#', onclick: (e) => (e.preventDefault(), decide(app, S, fb, s, null)) }, L('reabrir', 'reopen'))) : null;
    let body;
    let actions = [];
    if (s.status === 'conflito') {
      body = h(
        'div',
        { class: 'sug-three' },
        h('div', {}, h('div', { class: 'sug-label' }, L('Hoje (já com o que mudou desde o envio)', 'Today (with what changed since sending)')), h('div', { class: 'sug-diff' }, s.mine)),
        h('div', {}, h('div', { class: 'sug-label' }, L(`Sugestão de ${fb.from || 'quem mandou'} (sobre a versão enviada)`, `${fb.from ? fb.from + '’s' : 'Their'} suggestion (on the sent version)`)), diffEl(s.area.sent, s.area.theirs)),
      );
      actions = [
        h('button', { class: 'btn sm', onclick: () => askClaude(app, S, fb, s) }, icon('claude'), L('Juntar com o Claude', 'Merge with Claude')),
        h('button', { class: 'btn sm', title: L('Troca o trecho de hoje pela sugestão: desfaz o que mudou ali desde o envio', 'Replaces today’s passage with the suggestion: undoes what changed there since sending'), onclick: async () => (await apply(app, S, fb, s, { useArea: true })) && decide(app, S, fb, s, 'aceita') }, L('Usar a sugestão', 'Use the suggestion')),
        h('button', { class: 'btn sm ghost', onclick: () => decide(app, S, fb, s, 'rejeitada') }, L('Ficar com a de hoje', 'Keep today’s')),
      ];
    } else if (s.status === 'aplica') {
      body = diffEl(s.sent, s.theirs);
      actions = [
        h('button', { class: 'btn sm primary', onclick: async () => (await apply(app, S, fb, s)) && decide(app, S, fb, s, 'aceita') }, L('Aceitar', 'Accept')),
        h('button', { class: 'btn sm ghost', onclick: () => decide(app, S, fb, s, 'rejeitada') }, L('Rejeitar', 'Reject')),
      ];
    } else if (s.status === 'sumiu') {
      body = h('div', {}, diffEl(s.sent, s.theirs), h('div', { class: 'faint sug-note' }, L('Este trecho foi cortado depois do envio. Fica para consulta: a ideia pode valer para o texto novo.', 'This passage was cut after sending. Kept for reference: the idea may still apply to the new text.')));
      actions = [h('button', { class: 'btn sm ghost', onclick: () => decide(app, S, fb, s, 'rejeitada') }, L('Ok', 'Ok'))];
    } else body = diffEl(s.sent, s.theirs);
    return h('div', { class: `sug-item ${s.status}` + (s.decision ? ' decided' : '') }, h('div', { class: 'sug-top' }, chip, where, decided, h('span', { style: { flex: 1 } }), s.decision ? null : actions), body);
  };

  const order = { conflito: 0, aplica: 1, sumiu: 2, feita: 3 };
  const items = [...fb.items].sort((a, b) => !!a.decision - !!b.decision || order[a.status] - order[b.status] || a.file.localeCompare(b.file) || a.line - b.line);
  clear(el, h('div', { class: 'sugs' }, head, baseLine, items.map(row)));
}
