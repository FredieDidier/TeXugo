// Preferências → Corretor: the optional advanced English checking (n-gram
// data, server/ngrams.js). One line: state, size and one button whose label
// follows the state (Baixar, Pausar, Continuar, Remover).
import { call, on } from './api.js';
import { h, clear, toast, confirmBox } from './dom.js';
import { getLang } from './i18n.js';

const gb = (b) => {
  const n = (b / 1e9).toFixed(1);
  return `${getLang() === 'en' ? n : n.replace('.', ',')} GB`;
};

export function ngramsRow(app) {
  const box = h('div', { class: 'ngrams' });
  let st = null;
  let lastState = null;
  const btn = (label, fn, cls = 'btn sm') => h('button', { class: cls, onclick: fn }, label);
  const act = (name) => async () => {
    try {
      st = await call(name);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async () => {
    const ok = await confirmBox('Remover o corretor avançado de inglês?', 'Os n-gramas saem do disco. Para usar de novo, será preciso baixar tudo outra vez.', { ok: 'Remover', danger: true });
    if (ok) act('ngramsRemove')();
  };
  function render() {
    if (!st) return clear(box, h('div', { class: 'faint' }, 'Lendo o estado do corretor avançado…'));
    const size = st.zipBytes ? gb(st.zipBytes) : st.total ? gb(st.total) : '9 GB';
    const room = st.unzippedBytes ? gb(st.unzippedBytes) : '15 GB';
    const pct = st.total ? Math.floor((100 * (st.done || 0)) / st.total) : 0;
    let line;
    let buttons;
    if (st.state === 'ready') {
      line = `Instalado${st.bytes ? ` (${gb(st.bytes)} no disco)` : ''}. O corretor usa os n-gramas em textos em inglês.`;
      buttons = [btn('Remover', remove)];
    } else if (st.state === 'downloading') {
      line = `Baixando: ${pct}%${st.total ? ` de ${gb(st.total)}` : ''}.`;
      buttons = [btn('Pausar', act('ngramsPause'))];
    } else if (st.state === 'unpacking') {
      line = 'Descompactando… (alguns minutos)';
      buttons = [];
    } else if (st.state === 'paused') {
      line = `Pausado em ${pct}%${st.total ? ` de ${gb(st.total)}` : ''}.`;
      buttons = [btn('Continuar', act('ngramsStart'), 'btn sm primary'), btn('Remover', remove)];
    } else {
      line = `Não instalado. Download de ${size}; ocupa ${room} depois de descompactado.`;
      buttons = [btn(`Baixar (${size})`, act('ngramsStart'), 'btn sm primary')];
    }
    clear(
      box,
      h('div', { class: 'ngrams-head' }, h('b', {}, 'Corretor avançado de inglês'), h('span', { class: 'ngrams-actions' }, ...buttons)),
      h('div', { class: 'ngrams-state' }, line),
      st.state === 'downloading' || st.state === 'paused' ? h('div', { class: 'ngrams-bar', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { style: { width: pct + '%' } })) : null,
      st.error ? h('div', { class: 'ngrams-err' }, st.error) : null,
      h('p', { class: 'faint' }, 'Pega trocas que as regras não veem, como “their” no lugar de “there” ou “affect” no lugar de “effect”. Só para inglês: não existem n-gramas do LanguageTool para português. Funciona com o servidor no seu computador, de preferência num SSD.'),
    );
  }
  const off = on('ngrams', (e) => {
    if (!box.isConnected && st) return off();
    st = e;
    // The data became ready or was removed: check the text again with it.
    if (lastState && lastState !== e.state && (e.state === 'ready' || e.state === 'absent')) app.grammarChanged?.();
    lastState = e.state;
    render();
  });
  call('ngramsStatus')
    .then((s) => {
      st = s;
      lastState = s.state;
      render();
    })
    .catch(() => {});
  render();
  return box;
}
