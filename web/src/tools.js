// Document tools: submission ZIP, double-blind check, ChkTeX, word count.
import { call } from './api.js';
import { h, icon, basename, relPath, toast, modal, prompt } from './dom.js';

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
