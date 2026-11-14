// CodeMirror 6 setup for LaTeX (and plain text, BibTeX, Markdown files).
import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import { showTooltip, hoverTooltip } from '@codemirror/view';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars, Decoration } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { markdown } from '@codemirror/lang-markdown';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippetCompletion } from '@codemirror/autocomplete';
import { linter, lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { viciosExtension } from './vicios/cm.js';
import { grammarExtension } from './grammar/cm.js';
import { changesField } from './changes.js';
import { blameCompartment } from './blame.js';
import { commentExtension } from './comments.js';
import { insertGrid } from './table.js';
import { mathPreviewExtension } from './mathpreview.js';
import { basename, dirname, joinPath } from './dom.js';
import { tr } from './i18n.js';

const latex = StreamLanguage.define(stex);

// Hovering a key inside \cite{...} shows the reference from the .bib.
const stripBraces = (s) => String(s || '').replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/--/g, '–');
function citeHover(hooks) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const re = /\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(line.text))) {
      const open = line.from + m.index + m[0].length - m[1].length - 1;
      if (pos <= open || pos > open + 1 + m[1].length) continue;
      let at = open + 1;
      for (const raw of m[1].split(',')) {
        const end = at + raw.length;
        if (pos >= at && pos <= end && raw.trim()) {
          const key = raw.trim();
          const lead = raw.length - raw.trimStart().length;
          return { pos: at + lead, end: at + lead + key.length, above: true, create: () => ({ dom: citeCard(key, hooks) }) };
        }
        at = end + 1;
      }
    }
    return null;
  });
}
function citeCard(key, hooks) {
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const dom = el('div', 'cite-tip');
  const b = symbols.bibKeys.find((x) => x.key === key);
  if (!b) {
    dom.append(el('div', 'cite-tip-missing', `“${key}” não está em nenhum .bib do projeto.`));
    if (hooks.addRef) {
      const a = el('a', 'cite-tip-link', 'Adicionar referência…');
      a.href = '#';
      a.onmousedown = (e) => (e.preventDefault(), hooks.addRef());
      dom.append(a);
    }
    return dom;
  }
  const authors = stripBraces(b.author).split(/\s+and\s+/).filter(Boolean).map((a) => (a.includes(',') ? a.split(',')[0] : a.split(' ').pop()).trim());
  dom.append(el('div', 'cite-tip-title', stripBraces(b.title) || key));
  dom.append(el('div', 'cite-tip-meta', [authors.length > 3 ? authors[0] + ' et al.' : authors.join(', '), b.year, stripBraces(b.venue)].filter(Boolean).join(' · ')));
  const links = el('div', 'cite-tip-links');
  const link = (text, href) => {
    const a = el('a', 'cite-tip-link', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    links.append(a);
  };
  if (b.doi) link('DOI', 'https://doi.org/' + b.doi);
  if (b.eprint && /^\d{4}\.\d{4,5}/.test(b.eprint)) link('arXiv', 'https://arxiv.org/abs/' + b.eprint);
  else if (b.url) link('Link', b.url);
  link('Scholar', 'https://scholar.google.com/scholar?q=' + encodeURIComponent(stripBraces(b.title) || key));
  if (hooks.openAt) {
    const a = el('a', 'cite-tip-link', 'Ver no .bib');
    a.href = '#';
    a.onmousedown = (e) => (e.preventDefault(), hooks.openAt(b.file, b.line));
    links.append(a);
  }
  dom.append(links);
  return dom;
}


const style = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--hl-cmd)' },
  { tag: t.tagName, color: 'var(--hl-cmd)' },
  { tag: t.atom, color: 'var(--hl-cmd)' },
  { tag: t.bracket, color: 'var(--hl-bracket)' },
  { tag: t.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: t.string, color: 'var(--hl-math)' },
  { tag: t.keyword, color: 'var(--hl-cmd)' },
  { tag: t.number, color: 'var(--hl-num)' },
  { tag: t.variableName, color: 'var(--hl-arg)' },
  { tag: t.meta, color: 'var(--hl-env)' },
  { tag: t.invalid, color: 'var(--err)' },
  { tag: t.heading, fontWeight: '700' },
]);

const COMMANDS = [
  'section', 'subsection', 'subsubsection', 'paragraph', 'chapter', 'part', 'label', 'ref', 'eqref', 'cref', 'Cref', 'autoref', 'pageref',
  'cite', 'citet', 'citep', 'citeauthor', 'citeyear', 'textcite', 'parencite', 'emph', 'textbf', 'textit', 'texttt', 'textsc', 'underline',
  'footnote', 'caption', 'includegraphics', 'input', 'include', 'usepackage', 'documentclass', 'newcommand', 'renewcommand',
  'item', 'centering', 'hline', 'toprule', 'midrule', 'bottomrule', 'cmidrule', 'multicolumn', 'multirow', 'frametitle', 'framesubtitle',
  'pause', 'alert', 'url', 'href', 'today', 'maketitle', 'tableofcontents', 'bibliography', 'bibliographystyle', 'printbibliography',
  'addbibresource', 'externaldocument', 'vspace', 'hspace', 'medskip', 'bigskip', 'smallskip', 'noindent', 'newpage', 'clearpage',
  'frac', 'sqrt', 'sum', 'prod', 'int', 'alpha', 'beta', 'gamma', 'delta', 'varepsilon', 'epsilon', 'theta', 'lambda', 'mu', 'sigma',
  'tau', 'phi', 'rho', 'omega', 'Delta', 'mathbb', 'mathbf', 'mathrm', 'mathcal', 'hat', 'bar', 'tilde', 'left', 'right', 'times',
  'cdot', 'ldots', 'leq', 'geq', 'neq', 'approx', 'infty', 'partial', 'mathbb{E}', 'text', 'quad', 'qquad', 'thanks', 'appendix',
];
const ENVS = ['figure', 'table', 'tabular', 'itemize', 'enumerate', 'description', 'equation', 'equation*', 'align', 'align*', 'frame', 'columns', 'column', 'block', 'alertblock', 'exampleblock', 'abstract', 'center', 'minipage', 'threeparttable', 'tablenotes', 'longtable', 'quote', 'proof', 'theorem', 'lemma', 'verbatim', 'tikzpicture', 'document'];

// Supplies labels and bib keys (refreshed by the app from the server).
export const symbols = { labels: [], bibKeys: [] };

function latexCompletions(ctx) {
  // \ref{..}, \cref{..}, \eqref{..}: labels
  let m = ctx.matchBefore(/\\(?:[cC]ref|ref|eqref|autoref|pageref|vref|nameref|labelcref)\{[^}]*$/);
  if (m) {
    const brace = m.text.lastIndexOf('{') + 1;
    const part = m.text.slice(brace);
    const comma = part.lastIndexOf(',') + 1;
    return {
      from: m.from + brace + comma,
      options: dedupe(symbols.labels.map((l) => l.key)).map((k) => ({ label: k, type: 'variable', detail: labelDetail(k) })),
      validFor: /^[^},]*$/,
    };
  }
  m = ctx.matchBefore(/\\(?:cite[a-zA-Z]*|[pP]arencite|[tT]extcite|footcite|autocite|nocite)\*?(?:\[[^\]]*\])*\{[^}]*$/);
  if (m) {
    const brace = m.text.lastIndexOf('{') + 1;
    const part = m.text.slice(brace);
    const comma = part.lastIndexOf(',') + 1;
    return {
      from: m.from + brace + comma,
      options: symbols.bibKeys.map((b) => ({ label: b.key, type: 'text', detail: [b.author && b.author.split(' and ')[0].split(',')[0], b.year].filter(Boolean).join(' '), info: b.title || '' })),
      validFor: /^[^},]*$/,
    };
  }
  m = ctx.matchBefore(/\\(?:begin|end)\{[^}]*$/);
  if (m) {
    const brace = m.text.indexOf('{') + 1;
    return { from: m.from + brace, options: ENVS.map((e) => ({ label: e, type: 'type' })), validFor: /^[^}]*$/ };
  }
  m = ctx.matchBefore(/\\[a-zA-Z]*$/);
  if (m && (m.text.length > 1 || ctx.explicit)) {
    const opts = COMMANDS.map((c) => ({ label: '\\' + c, type: 'keyword' }));
    opts.push(
      snippetCompletion('\\begin{${env}}\n\t${}\n\\end{${env}}', { label: '\\begin{…}', type: 'keyword', detail: 'ambiente' }),
      snippetCompletion('\\begin{figure}[t]\n\t\\centering\n\t\\includegraphics[width=\\linewidth]{${arquivo}}\n\t\\caption{${legenda}}\\label{fig:${rótulo}}\n\\end{figure}', { label: '\\figure', type: 'keyword', detail: 'figura completa' }),
      snippetCompletion('\\begin{table}[t]\n\t\\centering\n\t\\caption{${legenda}}\\label{tab:${rótulo}}\n\t\\begin{tabular}{lcc}\n\t\t\\toprule\n\t\t& (1) & (2) \\\\\\\\\n\t\t\\midrule\n\t\t${} \\\\\\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}', { label: '\\table', type: 'keyword', detail: 'tabela booktabs' }),
      snippetCompletion('\\begin{frame}{${título}}\n\t\\begin{itemize}\n\t\t\\item ${}\n\t\\end{itemize}\n\\end{frame}', { label: '\\frame', type: 'keyword', detail: 'slide Beamer' }),
      snippetCompletion('\\begin{itemize}\n\t\\item ${}\n\\end{itemize}', { label: '\\itemize', type: 'keyword', detail: 'lista' }),
      snippetCompletion('\\begin{equation}\\label{eq:${rótulo}}\n\t${}\n\\end{equation}', { label: '\\equation', type: 'keyword', detail: 'equação numerada' }),
    );
    return { from: m.from, options: opts, validFor: /^\\[a-zA-Z]*$/ };
  }
  return null;
}

function labelDetail(k) {
  const l = symbols.labels.find((x) => x.key === k);
  return l ? basename(l.file) + ':' + l.line : '';
}
function dedupe(a) {
  return [...new Set(a)];
}

// Auto-close \begin{env} with \end{env} when Enter is pressed right after it.
const autoEnd = keymap.of([
  {
    key: 'Enter',
    run(view) {
      const { state } = view;
      const sel = state.selection.main;
      if (!sel.empty) return false;
      const line = state.doc.lineAt(sel.head);
      const before = line.text.slice(0, sel.head - line.from);
      const m = before.match(/\\begin\{([^}]+)\}(\[[^\]]*\]|\{[^}]*\})*\s*$/);
      if (!m) return false;
      const env = m[1];
      const rest = state.doc.sliceString(sel.head, Math.min(state.doc.length, sel.head + 4000));
      const opens = (rest.match(new RegExp(`\\\\begin\\{${escapeRe(env)}\\}`, 'g')) || []).length;
      const closes = (rest.match(new RegExp(`\\\\end\\{${escapeRe(env)}\\}`, 'g')) || []).length;
      if (closes > opens) return false;
      const indent = line.text.match(/^\s*/)[0];
      const insert = `\n${indent}  \n${indent}\\end{${env}}`;
      view.dispatch({ changes: { from: sel.head, insert }, selection: { anchor: sel.head + indent.length + 3 } });
      return true;
    },
  },
]);
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Flash a line after a jump (from the PDF, a problem or the outline).
const flashEffect = StateEffect.define();
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(flashEffect)) deco = e.value == null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-flash-line' }).range(e.value)]);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function wrapSelection(before, after) {
  return (view) => {
    const changes = view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      return {
        changes: { from: range.from, to: range.to, insert: before + text + after },
        range: range.empty ? { anchor: range.from + before.length } : { anchor: range.from + before.length, head: range.to + before.length },
      };
    });
    view.dispatch(view.state.update(changes, { scrollIntoView: true }));
    return true;
  };
}

// Floating bar over a selection: bold, italic, comment, ask Claude, AI
// actions. Buttons keep the selection (mousedown does not take focus).
function selectionBar(path, hooks) {
  const tex = /\.(tex|sty|cls|ltx)$/i.test(path);
  const md = /\.(md|markdown)$/i.test(path);
  if (!tex && !md) return [];
  const bar = (state) => {
    const r = state.selection.main;
    if (r.empty || state.selection.ranges.length > 1 || r.to - r.from < 2) return [];
    return [
      {
        pos: r.from,
        above: true,
        arrow: false,
        create(view) {
          const dom = document.createElement('div');
          dom.className = 'cm-selbar';
          const btn = (label, title, run, cls = '') => {
            const b = document.createElement('button');
            b.className = 'selbar-btn ' + cls;
            b.textContent = label;
            b.title = title;
            b.addEventListener('mousedown', (e) => e.preventDefault());
            b.addEventListener('click', (e) => run(view, e));
            dom.append(b);
          };
          btn('B', tex ? 'Negrito: \\textbf{} (⌘B)' : 'Negrito (⌘B)', (v) => wrapSelection(tex ? '\\textbf{' : '**', tex ? '}' : '**')(v), 'b');
          btn('I', tex ? 'Itálico: \\emph{} (⌘I)' : 'Itálico (⌘I)', (v) => wrapSelection(tex ? '\\emph{' : '*', tex ? '}' : '*')(v), 'i');
          if (tex) btn('%', 'Comentar ou descomentar as linhas (⌘/)', (v) => toggleComment(v));
          if (hooks.comment) btn('💬', 'Deixar um comentário neste trecho para os coautores (⌥⌘M)', (v) => hooks.comment(v), 'note');
          // One Claude button: ask about the passage, or rewrite it.
          if (hooks.ai) btn('✻ Claude ▾', 'Perguntar ao Claude sobre o trecho, ou revisar, humanizar, encurtar, traduzir…', (v, e) => {
            const r = e.currentTarget.getBoundingClientRect();
            hooks.ai(v, r.left, r.bottom + 4);
          }, 'claude');
          return { dom };
        },
      },
    ];
  };
  const field = StateField.define({
    create: bar,
    update: (v, tr) => (tr.docChanged || tr.selection ? bar(tr.state) : v),
    provide: (f) => showTooltip.computeN([f], (s) => s.field(f)),
  });
  return field;
}

export const wrapCompartment = new Compartment();
export const sizeCompartment = new Compartment();

export function languageFor(path) {
  if (/\.(tex|sty|cls|ltx|bib|dtx|ins)$/i.test(path)) return [latex];
  if (/\.(md|markdown|qmd|rmd)$/i.test(path)) return [markdown()];
  return [];
}

// Creates the state for a file. `hooks` carries app callbacks: save,
// compile, compileAll, syncForward, onChange.
export function createState(doc, path, hooks, settings = {}) {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(style),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [latexCompletions], activateOnTyping: true, maxRenderedOptions: 80 }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      lintGutter(),
      linter(null),
      flashField,
      wrapCompartment.of(settings.wrap === false ? [] : EditorView.lineWrapping),
      languageFor(path),
      autoEnd,
      viciosExtension(path),
      grammarExtension(path),
      mathPreviewExtension(path),
      // ⌘-click on "file.tex:123" (in a comment, a log, a response letter)
      // opens that line.
      EditorView.domEventHandlers({
        mousedown(e, view) {
          if (!(e.metaKey || e.ctrlKey) || !hooks.openAt) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos);
          const re = /([\w./-]+\.(?:tex|bib|sty|cls|md|R|py|do)):(\d+)/g;
          let m;
          while ((m = re.exec(line.text))) {
            const a = line.from + m.index;
            if (pos >= a && pos <= a + m[0].length) {
              e.preventDefault();
              hooks.openAt(joinPath(dirname(path), m[1]), Number(m[2]));
              return true;
            }
          }
          return false;
        },
      }),
      /\.(tex|ltx)$/i.test(path) ? citeHover(hooks) : [],
      /\.(tex|ltx)$/i.test(path)
        ? EditorView.domEventHandlers({
            // Cells copied from a spreadsheet become a booktabs table.
            paste(e, view) {
              const text = e.clipboardData && e.clipboardData.getData('text/plain');
              if (!text || !text.includes('\t')) return false;
              const r = insertGrid(view, text);
              if (!r) return false;
              e.preventDefault();
              hooks.tablePasted && hooks.tablePasted(r);
              return true;
            },
          })
        : [],
      changesField,
      blameCompartment.of([]),
      commentExtension,
      selectionBar(path, hooks),
      // The name a screen reader says on entering the editor, with the way
      // out: Tab indents here, so Esc and then Tab move on.
      EditorView.contentAttributes.of({ 'aria-label': tr(`Editor de ${basename(path)}. Esc e depois Tab saem do editor.`) }),
      keymap.of([
        { key: 'Mod-s', preventDefault: true, run: () => (hooks.save(), true) },
        { key: 'Mod-Enter', preventDefault: true, run: () => (hooks.compile(), true) },
        { key: 'Mod-Shift-Enter', preventDefault: true, run: () => (hooks.compileAll(), true) },
        { key: 'Mod-j', preventDefault: true, run: (v) => (hooks.syncForward(v), true) },
        { key: 'Mod-Alt-r', preventDefault: true, run: () => (hooks.addRef && hooks.addRef(), true) },
        { key: 'Mod-Alt-m', preventDefault: true, run: (v) => (hooks.comment && hooks.comment(v), true) },
        { key: 'Shift-Alt-f', preventDefault: true, run: () => (hooks.format && hooks.format(), true) },
        { key: 'Mod-b', run: wrapSelection('\\textbf{', '}') },
        { key: 'Mod-i', run: wrapSelection('\\emph{', '}') },
        { key: 'Mod-/', run: toggleComment },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) hooks.onChange(u);
        if (u.selectionSet || u.docChanged) hooks.onCursor && hooks.onCursor(u.state);
      }),
      EditorState.languageData.of(() => [{ commentTokens: { line: '%' } }]),
    ],
  });
}

export function createView(parent) {
  return new EditorView({ parent, state: EditorState.create({ doc: '' }) });
}

export function jumpTo(view, line, col = 0) {
  const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
  const pos = Math.min(l.from + col, l.to);
  view.dispatch({ selection: { anchor: pos }, effects: [EditorView.scrollIntoView(pos, { y: 'center' }), flashEffect.of(l.from)], scrollIntoView: false });
  view.focus();
  setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 1700);
}

export function showDiagnostics(view, diags) {
  const doc = view.state.doc;
  const list = diags
    .filter((d) => d.line && d.line <= doc.lines)
    .map((d) => {
      const l = doc.line(d.line);
      return { from: l.from, to: Math.max(l.from, l.to), severity: d.severity, message: d.message, source: d.source };
    });
  view.dispatch(setDiagnostics(view.state, list));
}

export { EditorView, EditorState, wrapSelection };
