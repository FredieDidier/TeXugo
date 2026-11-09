// Document tools: submission ZIP, double-blind check, ChkTeX, word count.
import { call } from './api.js';
import { h, clear, icon, basename, relPath, toast, modal, prompt } from './dom.js';

function docOf(app) {
  const t = app.activeTab();
  if (!t || !t.root) {
    toast('Abra um arquivo que pertença a um documento.', 'warn');
    return null;
  }
  return t.root;
}

export async function exportZip(app, S) {
  const doc = docOf(app);
  if (!doc) return;
  try {
    const r = await call('exportZip', { doc });
    modal({
      title: [icon('check'), ' ZIP para submissão'],
      body: h(
        'div',
        {},
        h('p', {}, h('b', {}, basename(r.zip)), ` (${(r.size / 1024).toFixed(0)} KB, ${r.files.length} arquivos), na pasta do documento. Leva o .bbl no lugar do .bib, como o arXiv pede.`),
        r.outside.length
          ? h(
              'div',
              { class: 'qq-banner' },
              icon('warn'),
              h(
                'div',
                {},
                h('b', {}, `${r.outside.length} arquivo${r.outside.length > 1 ? 's' : ''} fora da pasta do documento ficou de fora`),
                ' (o ZIP não compila sozinho sem eles). Copie para dentro da pasta e ajuste o caminho:',
                h('ul', {}, r.outside.slice(0, 12).map((f) => h('li', { style: { fontFamily: 'var(--mono)', fontSize: '11.5px' } }, relPath(S.project.root, f)))),
              ),
            )
          : h('p', { style: { color: 'var(--ok)' } }, icon('checkCircle'), ' Todos os arquivos usados estão dentro do ZIP.'),
        h('details', {}, h('summary', { class: 'muted' }, 'Arquivos incluídos'), h('pre', { style: { fontSize: '11.5px' } }, r.files.join('\n'))),
      ),
      footer: [h('button', { class: 'btn', onclick: () => call('reveal', { path: r.zip }) }, icon('folder'), 'Mostrar no Finder')],
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function blindCheck(app, S) {
  const doc = docOf(app);
  if (!doc) return;
  let names = S.settings.blindNames;
  if (!names) {
    names = await prompt('Checagem double-blind', { label: 'Nomes e instituições a procurar (separados por vírgula)', value: [S.settings.author, S.settings.institution].filter(Boolean).join(', '), ok: 'Checar' });
    if (names == null) return;
    S.settings.blindNames = names;
    app.saveSettingsSoon();
  }
  try {
    const list = await call('blindCheck', { doc, names: names.split(',') });
    modal({
      title: [icon('eye'), ` Anonimato de ${basename(doc)}`],
      wide: true,
      body: h(
        'div',
        {},
        list.length
          ? h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, h('b', {}, `${list.length} possível${list.length > 1 ? 'is' : ''} pista${list.length > 1 ? 's' : ''} de autoria.`), ' Clique para ir à linha.'))
          : h('p', { style: { color: 'var(--ok)', fontWeight: 600 } }, icon('checkCircle'), ' Nada encontrado: sem nomes, e-mails, \\thanks, agradecimentos ou metadados de autor.'),
        list.map((f) =>
          h(
            'div',
            { class: 'prob warning', onclick: () => (document.querySelector('.overlay')?.remove(), f.file && app.openFile(f.file, { line: f.line || 1 })) },
            h('span', { class: 'ico' }, icon('warn')),
            h('div', { class: 'msg' }, f.message),
            h('span', { class: 'where' }, f.file ? relPath(S.project.root, f.file) + (f.line ? ':' + f.line : '') : ''),
          ),
        ),
        h('p', { class: 'faint', style: { fontSize: '12px', marginTop: '12px' } }, `Procurando: ${names}. `, h('a', { href: '#', onclick: (e) => (e.preventDefault(), (S.settings.blindNames = ''), document.querySelector('.overlay')?.remove(), blindCheck(app, S)) }, 'mudar nomes')),
      ),
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function chktex(app, S) {
  const t = app.activeTab();
  if (!t || !t.path.endsWith('.tex')) return toast('Abra um arquivo .tex.', 'warn');
  if (t.dirty) await app.saveTab(t, { quiet: true });
  try {
    const list = await call('chktex', { path: t.path });
    S.lint = { file: t.path, items: list };
    app.applyDiagnostics();
    app.bottom.filter.lint = true;
    app.bottom.show('problems');
    toast(list.length ? `ChkTeX: ${list.length} sugest${list.length > 1 ? 'ões' : 'ão'} de estilo em ${t.name}.` : 'ChkTeX: nada a sugerir.', list.length ? 'info' : 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function wordCount(app) {
  const doc = docOf(app);
  if (!doc) return;
  try {
    const r = await call('wordCount', { doc });
    if (r.text == null) return toast('texcount não respondeu: ' + (r.raw || '').slice(0, 200), 'error');
    modal({
      title: [icon('outline'), ` Palavras em ${basename(doc)}`],
      body: h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', textAlign: 'center' } },
        [
          ['Texto', r.text],
          ['Títulos', r.headers],
          ['Legendas', r.captions],
        ].map(([k, v]) => h('div', { class: 'tl-doc' }, h('div', { style: { fontSize: '24px', fontWeight: 700 } }, v.toLocaleString('pt-BR')), h('div', { class: 'muted' }, k))),
        h('p', { class: 'faint', style: { gridColumn: '1 / -1', fontSize: '12px' } }, 'Conta o documento inteiro, seguindo \\input e \\include (texcount). Não conta matemática nem comandos.'),
      ),
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Formats the active .tex file with latexindent, as one undoable edit that
// only touches the lines that changed.
export async function formatDoc(app) {
  const t = app.activeTab();
  if (!t || t.binary || !/\.(tex|sty|cls)$/.test(t.path)) return toast('Abra um arquivo .tex para formatar.', 'warn');
  const view = app.view;
  const before = view.state.doc.toString();
  let r;
  try {
    r = await call('format', { path: t.path, text: before });
  } catch (err) {
    return toast(err.message, 'error', 8000);
  }
  if (view.state.doc.toString() !== before) return toast('O texto mudou durante a formatação; tente de novo.', 'warn');
  const after = r.text;
  if (after === before) return toast('Já estava formatado.', 'ok', 2000);
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  let b = 0;
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  view.dispatch({ changes: { from: a, to: before.length - b, insert: after.slice(a, after.length - b) }, userEvent: 'format' });
  toast(r.settings ? `Formatado com as regras de ${r.settings}. ⌘Z desfaz.` : 'Formatado. ⌘Z desfaz.', 'ok', 3000);
}

// TeX doctor: the state of the TeX installation and one-click installs of
// the packages a build reported missing.
export async function texDoctor(app, S, { files = [] } = {}) {
  const missing = new Set(files);
  for (const [, st] of S.docState) for (const f of (st.result && st.result.missingFiles) || []) if (/\.(sty|cls|def|bst|cfg|fd)$/.test(f)) missing.add(f);
  const body = h('div', {}, h('p', { class: 'muted' }, 'Examinando o TeX…'));
  const m = modal({ title: [icon('info'), ' Médico do TeX'], wide: true, body });
  let info;
  try {
    info = await call('texDoctor');
  } catch (err) {
    clear(body, h('p', { style: { color: 'var(--err)' } }, err.message));
    return;
  }
  const tools = S.hello.tools || {};
  const manual = h('input', { placeholder: 'tikzducks.sty', style: { flex: 1 } });
  const results = h('div', {});
  const lookup = async (list) => {
    if (!list.length) return;
    clear(results, h('p', { class: 'muted' }, `Procurando no TeX Live ${list.join(', ')}… (pode levar até um minuto na primeira vez)`));
    let found;
    try {
      found = await call('findPackages', { files: list });
    } catch (err) {
      clear(results, h('p', { style: { color: 'var(--err)' } }, err.message));
      return;
    }
    const pkgs = [...new Set(found.filter((f) => f.package).map((f) => f.package))];
    const btn = h('button', { class: 'btn primary', disabled: !pkgs.length }, icon('down'), pkgs.length ? `Instalar ${pkgs.join(', ')}` : 'Nada para instalar');
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = info.writable ? 'Instalando…' : 'Instalando… (digite sua senha na janela do macOS)';
      const r = await call('installPackages', { pkgs }).catch((err) => ({ ok: false, output: err.message }));
      if (r.cancelled) {
        btn.disabled = false;
        btn.textContent = `Instalar ${pkgs.join(', ')}`;
        return toast('Instalação cancelada.', 'warn');
      }
      clear(
        results,
        r.ok
          ? h('p', { style: { color: 'var(--ok)', fontWeight: 600 } }, icon('checkCircle'), ` Instalado: ${pkgs.join(', ')}. Compile de novo.`)
          : h('p', { style: { color: 'var(--err)' } }, 'A instalação não terminou bem. Veja a saída abaixo.'),
        h('details', { open: !r.ok }, h('summary', { class: 'muted' }, 'Saída do tlmgr'), h('pre', { style: { fontSize: '11px', whiteSpace: 'pre-wrap' } }, r.output || '')),
        r.ok ? h('button', { class: 'btn', onclick: () => (m.close(), app.compileAll()) }, icon('playAll'), 'Compilar tudo agora') : null,
      );
    };
    clear(
      results,
      found.map((f) => h('div', { class: 'prob ' + (f.package ? 'warning' : 'error') }, h('span', { class: 'ico' }, icon(f.package ? 'down' : 'error')), h('div', { class: 'msg' }, f.package ? `${f.file} vem no pacote ` : `${f.file}: nenhum pacote do TeX Live tem este arquivo (erro de digitação?)`, f.package ? h('b', {}, f.package) : null), h('span'))),
      h('div', { style: { marginTop: '10px' } }, btn),
    );
  };
  clear(
    body,
    h('h4', { class: 'set-h' }, 'Instalação'),
    h(
      'div',
      { class: 'tools-check', style: { marginTop: 0 } },
      info.year ? h('span', { class: 'chip ' + (info.frozen ? 'warn' : 'ok') }, `TeX Live ${info.year}${info.frozen ? ' (congelado)' : ''}`) : h('span', { class: 'chip error' }, 'TeX Live não encontrado'),
      ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'synctex'].map((k) => h('span', { class: 'chip ' + (tools[k] ? 'ok' : 'error') }, tools[k] ? icon('check') : icon('x'), k)),
      h('span', { class: 'chip ' + (info.latexindent.ok ? 'ok' : 'error'), title: info.latexindent.reason || info.latexindent.version }, info.latexindent.ok ? icon('check') : icon('x'), 'latexindent'),
    ),
    info.frozen
      ? h(
          'p',
          { class: 'muted', style: { fontSize: '12.5px' } },
          `O TeX Live ${info.year} não recebe mais atualizações. O TeXugo instala pacotes do arquivo final de ${info.year}, que continua no ar. Para pacotes novos, instale o MacTeX deste ano: `,
          h('a', { href: '#', onclick: (e) => (e.preventDefault(), call('openUrl', { url: 'https://tug.org/mactex/' })) }, 'tug.org/mactex'),
          '.',
        )
      : null,
    h('h4', { class: 'set-h' }, 'Pacotes que faltam'),
    missing.size ? h('p', {}, `A última compilação não achou: ${[...missing].join(', ')}.`) : h('p', { class: 'muted' }, 'Nenhuma compilação desta sessão reclamou de pacote faltando.'),
    h('div', { class: 'field' }, h('label', {}, 'Ou procure pelo nome do arquivo'), h('div', { class: 'row' }, manual, h('button', { class: 'btn', onclick: () => manual.value.trim() && lookup([manual.value.trim()]) }, icon('search'), 'Procurar'))),
    results,
  );
  manual.addEventListener('keydown', (e) => e.key === 'Enter' && manual.value.trim() && lookup([manual.value.trim()]));
  if (missing.size) lookup([...missing]);
}
