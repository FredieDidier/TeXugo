// Preferences dialog and theme handling.
import { h, icon, modal } from './dom.js';
import { EditorView } from './editor.js';

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

// Monospaced fonts worth offering; only the installed ones are listed.
const MONO_FONTS = ['SF Mono', 'Menlo', 'Monaco', 'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Source Code Pro', 'Cascadia Code', 'Roboto Mono', 'Courier New'];

function fontAvailable(name) {
  try {
    return document.fonts.check(`12px '${name}'`) && measure(name) !== measure('__none__');
  } catch {
    return false;
  }
}
function measure(name) {
  const c = measure.c || (measure.c = document.createElement('canvas').getContext('2d'));
  c.font = `20px '${name}', monospace`;
  const a = c.measureText('mmmmmmmmmmlli0O').width;
  c.font = `20px '${name}', serif`;
  return a + '/' + c.measureText('mmmmmmmmmmlli0O').width;
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
  const num = (key, { min, max, step, def, width = '80px' }) =>
    h('input', {
      type: 'number',
      min,
      max,
      step,
      value: st[key] ?? def,
      style: { width },
      oninput: (e) => {
        const v = Number(e.target.value);
        if (v >= min && v <= max) {
          st[key] = v;
          save();
          app.view.requestMeasure();
        }
      },
    });
  const fontSel = h(
    'select',
    { onchange: (e) => ((st.editorFont = e.target.value), save(), app.view.requestMeasure()) },
    [['', 'Padrão (SF Mono)'], ...MONO_FONTS.filter(fontAvailable).map((f) => [f, f])].map(([v, label]) => h('option', { value: v, selected: (st.editorFont || '') === v, style: v ? { fontFamily: `'${v}'` } : {} }, label)),
  );
  const row = (...items) => h('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' } }, ...items);
  const field = (label, el) => h('div', { class: 'field', style: { marginBottom: '10px' } }, h('label', {}, label), el);
  const preview = h('pre', { class: 'font-preview' }, '\\section{Introdução}\\label{sec:intro}\n$\\hat\\beta = 0{,}12$ ~ \\cite{smith2016spring} 0O1lI');
  modal({
    title: [icon('gear'), ' Preferências'],
    body: h(
      'div',
      {},
      h(
        'div',
        { style: { display: 'flex', gap: '14px' } },
        h(
          'div',
          { class: 'field' },
          h('label', {}, 'Idioma'),
          h(
            'select',
            {
              onchange: (e) => {
                st.lang = e.target.value;
                app.saveSettingsSoon();
                if (window.texugo && window.texugo.setLang) window.texugo.setLang(st.lang);
                // Re-render everything in the new language.
                setTimeout(() => location.reload(), 700);
              },
            },
            [['pt', 'Português'], ['en', 'English']].map(([v, l]) => h('option', { value: v, selected: (st.lang || 'pt') === v }, l)),
          ),
        ),
      ),
      h('div', { class: 'field' }, h('label', {}, 'Tema'), select('theme', [['system', 'Seguir o macOS'], ['light', 'Toca clara'], ['dark', 'Toca escura']])),
      h('h4', { class: 'set-h' }, 'Editor de código'),
      row(field('Fonte', fontSel), field('Tamanho', num('editorSize', { min: 9, max: 28, step: 0.5, def: 13.5 })), field('Espaçamento entre linhas', num('editorLineHeight', { min: 1, max: 2.5, step: 0.05, def: 1.6 }))),
      preview,
      h('h4', { class: 'set-h' }, 'Visualização de Markdown'),
      row(
        field('Fonte', select('mdFont', [['sans', 'Sem serifa (como o GitHub)'], ['serif', 'Com serifa (como um livro)'], ['mono', 'Monoespaçada']])),
        field('Tamanho', num('mdSize', { min: 11, max: 24, step: 0.5, def: 15 })),
        field('Espaçamento entre linhas', num('mdLineHeight', { min: 1.1, max: 2.4, step: 0.05, def: 1.65 })),
      ),
      h('h4', { class: 'set-h' }, 'Geral'),
      check('wrap', 'Quebrar linhas longas no editor', () => [app.view, app.split.view].forEach((v) => v.dispatch({ effects: app.wrapCompartment.reconfigure(st.wrap ? EditorView.lineWrapping : []) }))),
      check('autoCompile', 'Abas novas já vêm com "compilar ao salvar" ligado'),
      check('invertPdf', 'PDF escuro no tema escuro (só na tela; o arquivo não muda)'),
      check('showUnderfull', 'Mostrar caixas "underfull" em Problemas'),
      check('reopenLast', 'Reabrir o último projeto ao iniciar'),
      h('p', { class: 'faint', style: { marginTop: '14px', fontSize: '12px' } }, `TeXugo ${S.hello.version} · ${S.hello.tex || 'TeX não encontrado'}`),
    ),
  });
}
