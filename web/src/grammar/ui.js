// Grammar checker around the editor: the status bar item, the list of the
// open file's flags, the one-click install and the settings plumbing.
import { call, on } from '../api.js';
import { tr } from '../i18n.js';
import { h, modal, toast, icon } from '../dom.js';
import { jumpTo } from '../editor.js';
import { grammarConfig, grammarOf, refreshGrammar, resetGrammarCache } from './cm.js';

export function setupGrammar(app, S) {
  const st = S.settings;
  const apply = () => {
    grammarConfig.enabled = st.grammar !== false;
    grammarConfig.server = st.grammarServer === 'online' ? 'online' : 'local';
    grammarConfig.level = st.grammarLevel === 'default' ? 'default' : 'picky';
    grammarConfig.words = Array.isArray(st.grammarWords) ? st.grammarWords : [];
    grammarConfig.disabledRules = Array.isArray(st.grammarRules) ? st.grammarRules : [];
  };
  apply();
  const refreshAll = () => [app.view, app.split && app.split.view].filter(Boolean).forEach(refreshGrammar);
  grammarConfig.onStatus = () => app.renderStatus();
  grammarConfig.onResult = (view) => view === app.view && app.renderStatus();
  grammarConfig.onAddWord = (word) => {
    st.grammarWords = [...new Set([...(st.grammarWords || []), word])];
    app.saveSettingsSoon();
    apply();
    refreshAll();
    toast(`“${word}” entrou no seu dicionário.`, 'ok');
  };
  grammarConfig.onDisableRule = (rule) => {
    st.grammarRules = [...new Set([...(st.grammarRules || []), rule])];
    app.saveSettingsSoon();
    apply();
    resetGrammarCache();
    refreshAll();
    toast('Essa regra não será mais apontada. Dá para voltar em Preferências.', 'ok');
  };
  // Settings changed in Preferências.
  app.grammarChanged = () => {
    apply();
    resetGrammarCache();
    if (grammarConfig.status === 'missing' || grammarConfig.status === 'error') grammarConfig.status = 'off';
    refreshAll();
    app.renderStatus();
  };
  app.grammarList = () => listDialog(app, S);
  app.grammarInstall = () => installDialog(app, S, refreshAll);
}

// Status bar item, or null when the file is not prose.
export function grammarItem(app, S) {
  if (!grammarConfig.enabled) return null;
  const s = grammarConfig.status;
  if (s === 'missing') return h('span', { class: 'item click grammar-item', onclick: () => app.grammarInstall(), title: 'O corretor gramatical usa o LanguageTool, que ainda não está instalado. Clique para instalar.' }, 'corretor: instalar');
  if (s === 'error') return h('span', { class: 'item click grammar-item is-err', onclick: () => app.grammarChanged(), title: (grammarConfig.error || '') + '\nClique para tentar de novo.' }, 'corretor: erro');
  if (s === 'starting') return h('span', { class: 'item grammar-item', title: 'Abrindo o LanguageTool (alguns segundos, só na primeira vez)' }, h('span', { class: 'status-dot building' }), 'corretor: ligando');
  const hits = grammarOf(app.view.state);
  const spell = hits.filter((x) => x.type === 'misspelling').length;
  const gram = hits.length - spell;
  const label = !hits.length ? 'sem erros' : [gram ? `${gram} gramática` : null, spell ? `${spell} ortografia` : null].filter(Boolean).join(' · ');
  return h(
    'span',
    { class: 'item click grammar-item' + (hits.length ? ' has-hits' : ''), onclick: () => app.grammarList(), title: 'Corretor gramatical (LanguageTool): clique para ver a lista deste arquivo.' },
    s === 'checking' ? h('span', { class: 'status-dot building' }) : null,
    label,
  );
}

function listDialog(app, S) {
  const t = app.activeTab();
  const hits = grammarOf(app.view.state);
  const doc = app.view.state.doc;
  let m;
  const rows = hits.map((x) => {
    const line = doc.lineAt(x.from);
    return h(
      'div',
      {
        class: 'grammar-row',
        onclick: () => {
          m.close();
          jumpTo(app.view, line.number, x.from - line.from);
          app.view.focus();
        },
      },
      h('span', { class: 'grammar-row-ln' }, String(line.number)),
      h('span', { class: 'grammar-row-word ' + (x.type === 'misspelling' ? 'is-spell' : 'is-grammar') }, doc.sliceString(x.from, x.to)),
      h('span', { class: 'grammar-row-msg' }, x.message, x.replacements.length ? h('span', { class: 'faint' }, ` → ${x.replacements.slice(0, 3).join(', ')}`) : null),
    );
  });
  m = modal({
    title: [icon('edit'), ` Corretor gramatical · ${t ? t.name : ''}`],
    wide: true,
    body: h(
      'div',
      {},
      h('p', { class: 'faint', style: { marginTop: 0 } }, 'Sublinhado vermelho: ortografia. Azul: gramática e estilo. Passe o mouse sobre o trecho no editor para ver as sugestões e trocar com um clique. Tudo roda no seu Mac (LanguageTool), a não ser que você escolha o servidor online em Preferências.'),
      rows.length ? h('div', { class: 'grammar-list' }, rows) : h('p', {}, 'Nada apontado neste arquivo.'),
    ),
  });
}

function installDialog(app, S, refreshAll) {
  const out = h('pre', { class: 'grammar-install-log hidden' });
  const btn = h('button', { class: 'btn primary', onclick: run }, 'Instalar o LanguageTool');
  let off = null;
  const m = modal({
    title: [icon('edit'), ' Corretor gramatical'],
    body: h(
      'div',
      {},
      h('p', {}, 'O TeXugo usa o LanguageTool, um corretor livre de ortografia e gramática em português e inglês. Ele roda no seu Mac: o texto não sai do computador.'),
      h('p', { class: 'faint' }, 'A instalação usa o Homebrew (brew install languagetool, uns 300 MB com o Java). Leva alguns minutos.'),
      out,
    ),
    footer: [h('span', { class: 'grow' }), btn],
    onClose: () => off && off(),
  });
  async function run() {
    btn.disabled = true;
    btn.textContent = tr('Instalando…');
    out.classList.remove('hidden');
    off = on('grammar:install', (e) => {
      out.textContent += e.text;
      out.scrollTop = out.scrollHeight;
    });
    try {
      await call('grammarInstall');
      toast('Corretor instalado.', 'ok');
      m.close();
      grammarConfig.status = 'off';
      refreshAll();
    } catch (err) {
      toast(err.message, 'error', 8000);
      btn.disabled = false;
      btn.textContent = tr('Tentar de novo');
    } finally {
      off && off();
      off = null;
    }
  }
  return m;
}
