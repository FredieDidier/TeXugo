// "Comentários no texto": select a passage, comment; coauthors reply and
// resolve. Threads live in .texugo-comments/ (server/comments.js) and travel
// with Git. Open threads are marked in the editor (hover shows the thread),
// listed in the "Comentários" tab of the bottom panel and counted in the
// Revisão view.
import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, hoverTooltip } from '@codemirror/view';
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal, confirmBox } from './dom.js';
import { authorColor, initials } from './blame.js';
import { anchorAt, locate } from '../../server/anchor.js';

export const setCommentMarks = StateEffect.define();

const relOf = (root, p) => relPath(root, p).split('\\').join('/');
const when = (iso) => {
  const d = new Date(iso);
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  if (m < 60 * 24) return `há ${Math.round(m / 60)} h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const isMine = (me, x) => !!me && ((me.email && x.email === me.email) || (!me.email && x.author === me.name));
const avatar = (me, x) => h('span', { class: 'cm-avatar', style: { '--c': authorColor({ author: x.author, email: x.email, me: isMine(me, x) }) }, title: x.author }, initials(x.author));

// Decorations: the open threads of this file, and where each one is.
export const commentsField = StateField.define({
  create: () => ({ deco: Decoration.none }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setCommentMarks)) return build(tr.state, e.value);
    return tr.docChanged ? { deco: v.deco.map(tr.changes) } : v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function build(state, threads) {
  const text = state.doc.toString();
  const marks = [];
  for (const c of threads) {
    const at = locate(text, c.anchor);
    if (!at || at.to <= at.from) continue;
    marks.push(Decoration.mark({ class: 'cm-comment', attributes: { 'data-cid': c.id } }).range(at.from, at.to));
  }
  return { deco: Decoration.set(marks, true) };
}

// Where each thread's passage is in a state, after edits since the marks.
export function rangesOf(state) {
  const f = state.field(commentsField, false);
  const out = new Map();
  if (!f) return out;
  f.deco.between(0, state.doc.length, (from, to, d) => {
    out.set(d.spec.attributes['data-cid'], { from, to });
  });
  return out;
}

let ctl = null;
// Hovering a marked passage shows its thread.
export const commentHover = hoverTooltip((view, pos) => {
  if (!ctl) return null;
  const ids = [];
  view.state.field(commentsField).deco.between(pos, pos, (from, to, d) => {
    if (pos >= from && pos <= to) ids.push(d.spec.attributes['data-cid']);
  });
  const threads = ids.map((id) => ctl.byId(id)).filter(Boolean);
  if (!threads.length) return null;
  return {
    pos,
    above: true,
    create: () => ({ dom: h('div', { class: 'cm-comment-tip' }, threads.map((c) => ctl.threadEl(c, { compact: true }))) }),
  };
});

export const commentExtension = [commentsField, commentHover];

export function setupComments(app, S) {
  ctl = {
    items: [],
    me: null,
    filter: 'open',
    focus: null,
    byId: (id) => ctl.items.find((c) => c.id === id),
    open: () => ctl.items.filter((c) => !c.resolved),
    count: () => ctl.open().length,
    async load() {
      if (!S.project) return;
      const root = S.project.root;
      try {
        const r = await call('commentsList', { root });
        if (!S.project || S.project.root !== root) return;
        ctl.items = r.items;
        ctl.me = r.me;
      } catch {
        ctl.items = [];
      }
      ctl.applyAll();
      app.bottom.render();
      app.refreshRevisao && app.refreshRevisao();
    },
    // Marks for the views on screen; other tabs get theirs when shown.
    applyAll() {
      const t = app.activeTab();
      if (t && !t.binary) ctl.apply(app.view, t);
      if (app.split && app.split.open && app.split.view && app.split.tab) ctl.apply(app.split.view, app.split.tab);
    },
    apply(view, t) {
      if (!S.project || !view.state.field(commentsField, false)) return;
      const rel = relOf(S.project.root, t.path);
      view.dispatch({ effects: setCommentMarks.of(ctl.open().filter((c) => c.file === rel)) });
    },
    // After a save: comments whose passage was edited follow the new text.
    async saved(t) {
      if (!S.project || !t.state) return;
      const rel = relOf(S.project.root, t.path);
      const ranges = rangesOf(t.state);
      const text = t.state.doc.toString();
      let changed = 0;
      for (const c of ctl.open()) {
        if (c.file !== rel) continue;
        const r = ranges.get(c.id);
        if (!r || r.to <= r.from) continue;
        const quote = text.slice(r.from, r.to);
        if (quote === c.anchor.quote) continue;
        await call('commentReanchor', { root: S.project.root, id: c.id, anchor: anchorAt(text, r.from, r.to) }).catch(() => {});
        changed++;
      }
      if (changed) ctl.load();
    },
    // New comment on the selection of a view.
    add(view, t) {
      const sel = view && view.state.selection.main;
      if (!t || !sel || sel.empty) return toast('Selecione o trecho que quer comentar.', 'warn');
      if (!S.project) return;
      const text = view.state.doc.toString();
      const anchor = anchorAt(text, sel.from, sel.to);
      const box = h('textarea', { rows: 5, placeholder: 'O seu comentário (os coautores veem depois do commit e do pull)', style: { width: '100%' } });
      const save = async () => {
        if (!box.value.trim()) return box.focus();
        try {
          const saved = t.dirty && app.saveTab ? await app.saveTab(t, { quiet: true }) : true;
          if (saved === false) return;
          // Saving may have changed nothing; the anchor is on the buffer text,
          // which is now the file.
          await call('commentAdd', { root: S.project.root, path: t.path, anchor, text: box.value });
          m.close();
          toast('Comentário salvo. Ele vai para os coautores no próximo commit.', 'ok');
          await ctl.load();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save());
      });
      const quote = anchor.quote.length > 300 ? anchor.quote.slice(0, 300) + '…' : anchor.quote;
      const m = modal({
        title: [icon('comment'), ' Comentar o trecho'],
        body: h('div', {}, h('blockquote', { class: 'cm-quote' }, quote), box, h('p', { class: 'faint', style: { fontSize: '12px', marginTop: '6px' } }, `${relOf(S.project.root, t.path)}, linha ${anchor.line} · ⌘↵ salva`)),
        footer: [h('button', { class: 'btn', onclick: () => m.close() }, 'Cancelar'), h('button', { class: 'btn primary', onclick: save }, 'Comentar')],
      });
      setTimeout(() => box.focus(), 0);
    },
    async reply(c, text) {
      await call('commentReply', { root: S.project.root, id: c.id, text });
      await ctl.load();
    },
    async resolve(c, done) {
      await call('commentResolve', { root: S.project.root, id: c.id, done });
      await ctl.load();
    },
    async remove(c) {
      if (!(await confirmBox('Apagar o comentário?', 'Apaga o comentário e as respostas, para todos depois do próximo commit. Para encerrar a conversa sem apagar, use Resolver.', { ok: 'Apagar', danger: true }))) return;
      await call('commentDelete', { root: S.project.root, id: c.id });
      await ctl.load();
    },
    goTo(c) {
      ctl.focus = c.id;
      app.openFile(c.path, { line: (c.at && c.at.line) || c.anchor.line || 1 });
    },
    show(id) {
      ctl.focus = id || null;
      app.bottom.show('comentarios');
    },
    // One thread: the passage, the comment, the replies, the actions.
    threadEl(c, { compact = false } = {}) {
      const me = ctl.me;
      const msg = (x, first) =>
        h('div', { class: 'cm-msg' + (first ? ' first' : '') }, avatar(me, x), h('div', { class: 'cm-body' }, h('div', { class: 'cm-who' }, h('b', {}, isMine(me, x) ? 'Você' : x.author), h('span', { class: 'faint' }, ' · ' + when(x.date))), h('div', { class: 'cm-text' }, x.text)));
      const replyBox = h('textarea', { rows: 2, placeholder: 'Responder…', style: { width: '100%' } });
      const sendReply = async () => {
        if (!replyBox.value.trim()) return;
        try {
          await ctl.reply(c, replyBox.value);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      replyBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), sendReply());
      });
      const where = c.at ? `${c.file}:${c.at.line}` : c.file;
      const quote = c.anchor.quote.length > 160 ? c.anchor.quote.slice(0, 160) + '…' : c.anchor.quote;
      return h(
        'div',
        { class: 'cm-thread' + (c.resolved ? ' resolved' : '') + (ctl.focus === c.id && !compact ? ' focus' : ''), 'data-cid': c.id },
        compact
          ? null
          : h(
              'div',
              { class: 'cm-where' },
              h('span', { class: 'click', title: 'Ir para o trecho', onclick: () => ctl.goTo(c) }, icon('file'), where),
              c.at ? null : h('span', { class: 'chip warn', title: 'O texto comentado foi reescrito ou apagado; o comentário mostra como ele era.' }, 'trecho mudou'),
              c.resolved ? h('span', { class: 'chip ok' }, `resolvido por ${isMine(me, c.resolved) ? 'você' : c.resolved.author}`) : null,
            ),
        compact ? null : h('blockquote', { class: 'cm-quote' }, quote),
        msg(c, true),
        (c.replies || []).map((r) => msg(r)),
        c.resolved || compact ? null : replyBox,
        h(
          'div',
          { class: 'cm-actions' },
          compact ? h('button', { class: 'btn sm', onclick: () => ctl.show(c.id) }, 'Responder') : c.resolved ? null : h('button', { class: 'btn sm primary', onclick: sendReply }, 'Responder'),
          h('button', { class: 'btn sm', onclick: () => ctl.resolve(c, !c.resolved) }, c.resolved ? 'Reabrir' : 'Resolver'),
          compact ? null : h('button', { class: 'icon-btn', title: 'Apagar o comentário', onclick: () => ctl.remove(c) }, icon('trash')),
        ),
      );
    },
    render(el) {
      if (!S.project) return clear(el, h('div', { class: 'pad faint' }, 'Abra um projeto.'));
      const all = ctl.items;
      const shown = all.filter((c) => (ctl.filter === 'open' ? !c.resolved : ctl.filter === 'done' ? !!c.resolved : true));
      const seg = (id, label, n) => h('button', { class: 'btn sm' + (ctl.filter === id ? ' primary' : ''), onclick: () => ((ctl.filter = id), ctl.render(el)) }, label, n != null ? ` ${n}` : '');
      const t = app.activeTab();
      const head = h(
        'div',
        { class: 'news-head' },
        h('div', { class: 'split-btn seg' }, seg('open', 'Em aberto', ctl.open().length), seg('done', 'Resolvidos', all.length - ctl.open().length), seg('all', 'Todos')),
        h('button', { class: 'btn sm', title: 'Selecione um trecho no editor e comente (⌥⌘M)', onclick: () => ctl.add(app.view, t) }, icon('plus'), 'Comentar o trecho selecionado'),
        h('span', { class: 'faint news-since' }, 'Ficam em .texugo-comments/ e vão para os coautores com o commit.'),
      );
      const body = shown.length
        ? shown.map((c) => ctl.threadEl(c))
        : h('div', { class: 'pad muted' }, all.length ? (ctl.filter === 'open' ? 'Nenhum comentário em aberto.' : 'Nada aqui.') : 'Nenhum comentário ainda. Selecione um trecho e clique em Comentar na barra que aparece, ou use ⌥⌘M.');
      clear(el, h('div', { class: 'news cm-panel' }, head, body));
      if (ctl.focus) {
        const f = el.querySelector(`.cm-thread[data-cid="${ctl.focus}"]`);
        if (f) f.scrollIntoView({ block: 'nearest' });
      }
    },
  };
  return ctl;
}
