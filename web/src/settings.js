// Preferences dialog and theme handling.
import { h, icon, modal } from './dom.js';
import { EditorView } from './editor.js';

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function openSettings(app, S) {
  const st = S.settings;
  const save = () => {
    app.applyLayoutSizes();
    applyTheme(st.theme);
    app.saveSettingsSoon();
    app.renderTopbar();
  };
  const select = (key, options) =>
    h(
      'select',
      { onchange: (e) => ((st[key] = e.target.value), save()) },
      options.map(([v, label]) => h('option', { value: v, selected: String(st[key]) === v }, label)),
    );
  const check = (key, label, after) =>
    h(
      'label',
      { class: 'toggle', style: { margin: '6px 0', display: 'flex' } },
      h('input', { type: 'checkbox', checked: !!st[key], onchange: (e) => ((st[key] = e.target.checked), save(), after && after()) }),
      h('span', { class: 'sw' }),
      label,
    );
  const size = h('input', {
    type: 'number',
    min: 10,
    max: 24,
    step: 0.5,
    value: st.editorSize,
    style: { width: '80px' },
    oninput: (e) => ((st.editorSize = Number(e.target.value) || 13.5), save(), app.view.requestMeasure()),
  });
  modal({
    title: [icon('gear'), ' Preferências'],
    body: h(
      'div',
      {},
      h('div', { class: 'field' }, h('label', {}, 'Tema'), select('theme', [['system', 'Seguir o macOS'], ['light', 'Toca clara'], ['dark', 'Toca escura']])),
      h('div', { class: 'field' }, h('label', {}, 'Tamanho da fonte do editor'), size),
      check('wrap', 'Quebrar linhas longas no editor', () => app.view.dispatch({ effects: app.wrapCompartment.reconfigure(st.wrap ? EditorView.lineWrapping : []) })),
      check('autoCompile', 'Abas novas já vêm com "compilar ao salvar" ligado'),
      check('invertPdf', 'PDF escuro no tema escuro (só na tela; o arquivo não muda)'),
      check('showUnderfull', 'Mostrar caixas "underfull" em Problemas'),
      check('reopenLast', 'Reabrir o último projeto ao iniciar'),
      h('p', { class: 'faint', style: { marginTop: '14px', fontSize: '12px' } }, `TeXugo ${S.hello.version} · ${S.hello.tex || 'TeX não encontrado'}`),
    ),
  });
}
