// Crash recovery (PRE-LAUNCH-AUDIT.md I2): every 20 s, and whenever the
// window loses focus, the unsaved tabs are copied to the app's data folder
// (server/recovery.js). When a project opens with copies that differ from
// the disk, the app offers them back with the differences. Nothing is ever
// written to the user's file until they save.
import { call } from './api.js';
import { h, toast, modal, relPath } from './dom.js';
import { fileDiff } from './ide.js';

export function installRecovery(app, S) {
  let last = '';
  let busy = false;
  const textOf = (t) => (t.path === S.active ? app.view.state : t.state).doc.toString();
  async function snapshot(force = false) {
    if (!S.project || busy) return;
    const dirty = S.tabs.filter((t) => t.dirty && !t.binary && t.state);
    const sig = S.project.root + '|' + dirty.map((t) => t.path + ':' + (t.version || 0)).join('|');
    if (!force && sig === last) return;
    busy = true;
    try {
      await call('recoverySync', { root: S.project.root, files: dirty.map((t) => ({ path: t.path, text: textOf(t) })) });
      last = sig;
    } catch {
      // A failed copy is retried on the next tick.
    } finally {
      busy = false;
    }
  }
  setInterval(() => snapshot(), 20000);
  window.addEventListener('blur', () => snapshot());
  document.addEventListener('visibilitychange', () => document.hidden && snapshot());

  // The user chose to discard: the copies go too, so they are not offered
  // back at the next opening.
  async function clear() {
    if (!S.project) return;
    last = '';
    try {
      await call('recoverySync', { root: S.project.root, files: [] });
    } catch {}
  }

  async function offer() {
    if (!S.project) return;
    let copies = [];
    try {
      copies = await call('recoveryList', { root: S.project.root });
    } catch {
      return;
    }
    if (!copies.length) return;
    const root = S.project.root;
    const when = (ms) => new Date(ms).toLocaleString(S.settings.lang === 'en' ? 'en-GB' : 'pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const body = h(
      'div',
      { class: 'recovery' },
      h('p', { style: { marginTop: 0 } }, copies.length === 1 ? 'O TeXugo fechou sem que este arquivo fosse salvo. Há uma cópia do que estava na aba:' : `O TeXugo fechou sem que estes ${copies.length} arquivos fossem salvos. Há uma cópia do que estava em cada aba:`),
      ...copies.map((c) =>
        h(
          'details',
          { class: 'recovery-file', open: copies.length === 1 },
          h('summary', {}, h('b', {}, relPath(root, c.path)), h('span', { class: 'faint' }, ` · cópia de ${when(c.at)}${c.missing ? ' · o arquivo não existe mais no disco' : ''}`)),
          fileDiff(c.disk || '', c.text),
        ),
      ),
      h('p', { class: 'faint', style: { marginBottom: 0 } }, 'Recuperar põe esse texto de volta nas abas, como alteração não salva; o arquivo só muda quando você salvar.'),
    );
    const choice = await new Promise((resolve) => {
      let done = false;
      const pick = (v) => {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const m = modal({
        title: 'Recuperar alterações não salvas',
        body,
        footer: [h('button', { class: 'btn danger', onclick: () => pick('drop') }, 'Descartar as cópias'), h('span', { style: { flex: 1 } }), h('button', { class: 'btn', onclick: () => pick('later') }, 'Depois'), h('button', { class: 'btn primary', onclick: () => pick('restore') }, 'Recuperar')],
        onClose: () => pick('later'),
      });
    });
    if (choice === 'drop') return call('recoveryDrop', { root, paths: copies.map((c) => c.path) }).catch(() => {});
    if (choice !== 'restore') return;
    let n = 0;
    for (const c of copies) {
      try {
        if (c.missing) await call('createFile', { path: c.path, text: '' });
        await app.openFile(c.path);
        const t = app.tabByPath(c.path);
        if (!t || t.binary || t.path !== S.active) continue;
        app.view.dispatch({ changes: { from: 0, to: app.view.state.doc.length, insert: c.text } });
        n++;
      } catch (err) {
        toast(`Não recuperou ${relPath(root, c.path)}: ${err.message}`, 'error');
      }
    }
    if (n) toast(n === 1 ? 'Texto recuperado. Salve para gravar no arquivo.' : `${n} arquivos recuperados. Salve para gravar.`, 'ok', 6000);
    snapshot(true);
  }

  return { snapshot, clear, offer };
}
