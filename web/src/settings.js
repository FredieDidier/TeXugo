// Preferences dialog and theme handling.
import { h, icon, modal, IS_MAC } from './dom.js';
import { ngramsRow } from './ngrams.js';
import { getLang } from './i18n.js';
import { EditorView } from './editor.js';
import { viciosConfig, refreshVicios } from './vicios/cm.js';
import { mathPreview } from './mathpreview.js';

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
  // A sample in the UI language (the decimal comma only in Portuguese).
  const en = getLang() === 'en';
  const preview = h('pre', { class: 'font-preview' }, `\\section{${en ? 'Introduction' : 'Introdução'}}\\label{sec:intro}\n$\\hat\\beta = ${en ? '0.12' : '0{,}12'}$ ~ \\cite{card1994minimum} 0O1lI`);
  // Five tabs instead of one long column, and a search that looks in all of
  // them at once (PRE-LAUNCH-AUDIT.md, design pass).
  const TABS = [
    ['aparencia', 'Aparência', [
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
    ]],
    ['escrita', 'Escrita', [
      check('vicios', 'Sublinhar vícios de escrita (tiques de IA), em português e inglês', () => {
        viciosConfig.enabled = st.vicios !== false;
        [app.view, app.split.view].forEach(refreshVicios);
        app.renderStatus();
      }),
      check('mathPreview', 'Mostrar a equação desenhada acima da fórmula enquanto você edita', () => (mathPreview.on = st.mathPreview !== false)),
      check('changeMarks', 'Marcar na margem as linhas alteradas desde a última compilação', () => document.body.classList.toggle('no-change-marks', !st.changeMarks)),
      check('wrap', 'Quebrar linhas longas no editor', () => [app.view, app.split.view].forEach((v) => v.dispatch({ effects: app.wrapCompartment.reconfigure(st.wrap ? EditorView.lineWrapping : []) }))),
    ]],
    ['corretor', 'Corretor', [
      check('grammar', 'Sublinhar erros de ortografia (vermelho) e de gramática (azul) com o LanguageTool', () => app.grammarChanged()),
      row(
        field('Rigor', h('select', { onchange: (e) => ((st.grammarLevel = e.target.value), save(), app.grammarChanged()) }, [['picky', 'Rigoroso: aponta o máximo possível (padrão)'], ['default', 'Normal: só o que o LanguageTool tem certeza']].map(([v, l]) => h('option', { value: v, selected: (st.grammarLevel || 'picky') === v }, l)))),
        field('Onde corrigir', h('select', { onchange: (e) => ((st.grammarServer = e.target.value), save(), app.grammarChanged()) }, [['local', IS_MAC ? 'No seu Mac (o texto não sai do computador)' : 'No seu computador (o texto não sai dele)'], ['online', 'Servidor online do LanguageTool (envia o texto)']].map(([v, l]) => h('option', { value: v, selected: (st.grammarServer || 'local') === v }, l)))),
      ),
      h(
        'p',
        { class: 'faint', style: { fontSize: '12px', margin: '2px 0 0' } },
        `Seu dicionário: ${(st.grammarWords || []).length} palavra(s). Regras que você mandou não apontar: ${(st.grammarRules || []).length}. `,
        (st.grammarWords || []).length || (st.grammarRules || []).length
          ? h('button', { class: 'link', onclick: (e) => ((st.grammarWords = []), (st.grammarRules = []), save(), app.grammarChanged(), (e.target.parentElement.textContent = 'Dicionário e regras zerados.')) }, 'Zerar')
          : null,
      ),
      ngramsRow(app),
    ]],
    ['compilacao', 'Compilação', [
      check('autoCompile', 'Abas novas já vêm com "compilar ao salvar" ligado'),
      check('livePreview', 'Abas novas já vêm com a prévia ao vivo ligada (o PDF segue o que você digita)'),
      check('invertPdf', 'PDF escuro no tema escuro (só na tela; o arquivo não muda)'),
      row(field('Parar uma compilação que fica sem progresso por (segundos)', num('stallSeconds', { min: 30, max: 3600, step: 30, def: 180, width: '90px' }))),
      check('showUnderfull', 'Mostrar caixas "underfull" em Problemas'),
    ]],
    ['geral', 'Geral', [
      check('reopenLast', 'Reabrir o último projeto ao iniciar'),
      h('p', { class: 'faint', style: { marginTop: '14px', fontSize: '12px' } }, `TeXugo ${S.hello.version} · ${S.hello.tex || 'TeX não encontrado'}`),
    ]],
  ];
  let current = 'aparencia';
  try {
    current = localStorage.getItem('texugo-settings-tab') || current;
  } catch {}
  if (!TABS.some((t) => t[0] === current)) current = 'aparencia';
  const panes = TABS.map(([id, , kids]) => h('div', { class: 'set-pane', role: 'tabpanel', id: 'set-pane-' + id, 'aria-labelledby': 'set-tab-' + id }, ...kids));
  const tabs = TABS.map(([id, label], i) =>
    h('button', { class: 'set-tab', role: 'tab', id: 'set-tab-' + id, 'aria-controls': 'set-pane-' + id, onclick: () => show(id), onkeydown: (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = TABS[(i + d + TABS.length) % TABS.length][0];
      show(next);
      tabs.find((t) => t.id === 'set-tab-' + next).focus();
    } }, label),
  );
  const empty = h('p', { class: 'faint set-empty', hidden: true }, 'Nenhuma preferência com esse nome.');
  const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const search = h('input', { class: 'set-search', type: 'search', placeholder: 'Buscar preferência…', 'aria-label': 'Buscar preferência', oninput: () => filter() });
  function show(id) {
    current = id;
    try {
      localStorage.setItem('texugo-settings-tab', id);
    } catch {}
    search.value = '';
    filter();
  }
  function filter() {
    const q = fold(search.value.trim());
    let any = false;
    tabs.forEach((t, i) => {
      const on = !q && TABS[i][0] === current;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on || (q && i === 0) ? 0 : -1;
      t.classList.toggle('on', on);
    });
    panes.forEach((p, i) => {
      if (!q) {
        p.hidden = TABS[i][0] !== current;
        for (const c of p.children) c.hidden = false;
        return;
      }
      // Searching: every tab at once, each row shown when its text (labels
      // and option names) matches; a heading stays when a row under it does.
      let shown = 0;
      let heading = null;
      for (const c of p.children) {
        if (c.matches('h4')) {
          heading = c;
          c.hidden = true;
          continue;
        }
        const hit = fold(c.textContent + ' ' + [...c.querySelectorAll('option')].map((o) => o.textContent).join(' ')).includes(q);
        c.hidden = !hit;
        if (hit) {
          shown++;
          if (heading) heading.hidden = false;
        }
      }
      p.hidden = !shown;
      if (shown) any = true;
    });
    empty.hidden = !q || any;
  }
  filter();
  modal({
    title: [icon('gear'), ' Preferências'],
    body: h('div', { class: 'settings' }, h('div', { class: 'set-top' }, h('div', { class: 'set-tabs', role: 'tablist', 'aria-label': 'Seções das preferências' }, ...tabs), search), ...panes, empty),
  });
}
