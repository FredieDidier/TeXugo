// Item 6 of PRE-LAUNCH-AUDIT.md: a quiet notice when GitHub Releases has a
// newer TeXugo. The app is not signed (no paid Apple or Microsoft
// certificate), so it never installs anything by itself: *Baixar* opens the
// installer for this system in the browser, and the dialog says how to get
// past the system's warning on the first open.
import { call } from './api.js';
import { h, modal, toast, IS_MAC } from './dom.js';
import { tr } from './i18n.js';

const IS_WIN = typeof navigator !== 'undefined' && /Win/.test(navigator.platform || '');

export function startUpdateChecks(app, S) {
  const run = async () => {
    try {
      const r = await call('updateCheck');
      S.update = r && r.newer ? r : null;
    } catch {
      return;
    }
    fillSlots(app, S);
    try {
      app.renderStatus();
    } catch {}
  };
  // A few seconds after opening, then every six hours (the server asks
  // GitHub at most once a day).
  setTimeout(run, 4000);
  setInterval(run, 6 * 60 * 60 * 1000);
}

// The start screen has no status bar: it gets a button in its own row.
export function updateSlot(app, S) {
  const el = h('span', { class: 'update-slot' });
  fill(el, app, S);
  return el;
}
function fill(el, app, S) {
  el.replaceChildren(...(S.update ? [h('button', { class: 'btn ghost update-on', title: tr('Há uma versão nova do TeXugo. Clique para ver.'), onclick: () => updateDialog(app, S) }, tr(`Versão ${S.update.latest} disponível`))] : []));
}
function fillSlots(app, S) {
  document.querySelectorAll('.update-slot').forEach((el) => fill(el, app, S));
}

export function updateItem(app, S) {
  if (!S.update) return null;
  return h('span', { class: 'item click update-on', onclick: () => updateDialog(app, S), title: tr('Há uma versão nova do TeXugo. Clique para ver.') }, tr(`Versão ${S.update.latest} disponível`));
}

const firstOpenNote = () =>
  IS_MAC
    ? 'O TeXugo não é assinado pela Apple. Na primeira vez que abrir a versão nova, o macOS vai recusar: abra Ajustes do Sistema → Privacidade e Segurança e clique em "Abrir mesmo assim". Só é preciso uma vez por versão.'
    : IS_WIN
      ? 'O TeXugo não é assinado pela Microsoft. Se o Windows mostrar "O Windows protegeu o computador", clique em "Mais informações" e depois em "Executar assim mesmo".'
      : 'Baixe o AppImage novo, marque como executável (chmod +x) e use no lugar do antigo.';

// From the status bar, the palette or Ajuda → Procurar atualizações. When
// called by hand it asks GitHub now, even with the check turned off.
export async function updateDialog(app, S, { force = false } = {}) {
  let r = S.update;
  if (!r || force) {
    try {
      r = await call('updateCheck', { force: true });
    } catch (err) {
      return toast(err.message, 'error');
    }
    if (r.error) return toast(tr('Não consegui falar com o GitHub agora. Tente de novo mais tarde.'), 'error');
    S.update = r.newer ? r : null;
    app.renderStatus();
    fillSlots(app, S);
    if (!r.newer) return toast(r.latest ? tr(`Você já está na versão mais recente (${r.current}).`) : tr('Ainda não há nenhuma versão publicada.'));
  }
  const open = (url) => call('openUrl', { url }).catch((err) => toast(err.message, 'error'));
  const mb = r.asset && r.asset.size ? ` (${Math.round(r.asset.size / 1e6)} MB)` : '';
  const m = modal({
    title: tr(`TeXugo ${r.latest} disponível`),
    body: h(
      'div',
      {},
      h('p', {}, tr(`Você está na versão ${r.current}. Baixe a nova e instale por cima da antiga; seus projetos e preferências continuam onde estão.`)),
      r.notes ? h('pre', { class: 'update-notes' }, r.notes) : null,
      h('p', { class: 'faint' }, tr(firstOpenNote())),
    ),
    footer: [
      r.page ? h('button', { class: 'btn', onclick: () => open(r.page) }, tr('Notas da versão')) : null,
      h('button', { class: 'btn', onclick: () => m.close() }, tr('Depois')),
      h('button', { class: 'btn primary', onclick: () => (open((r.asset && r.asset.url) || r.page), m.close()) }, tr('Baixar') + mb),
    ],
  });
}
