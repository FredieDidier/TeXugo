// A coauthor on Overleaf's free plan, without Git: "Mandar para o Overleaf"
// builds the ZIP to upload there, tests it as Overleaf compiles it, and
// marks the version as sent; the ZIP that comes back is read in "Recebi o
// retorno" (web/src/sent.js), which finds it in Downloads.
import { call } from './api.js';
import { h, clear, icon, toast, modal, basename, relPath, REVEAL } from './dom.js';
import { getLang } from './i18n.js';
import { loadSent } from './sent.js';

const L = (pt, en) => (getLang() === 'en' ? en : pt);
const mono = { fontFamily: 'var(--mono)', fontSize: '12px' };

function checkView(c) {
  if (!c) return null;
  if (c.fatal) return h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, h('b', {}, L('Não deu para testar o ZIP. ', 'Could not test the ZIP. ')), c.fatal));
  if (c.ok)
    return h(
      'p',
      { style: { color: 'var(--ok)' } },
      icon('checkCircle'),
      ' ',
      L(`Testado como o Overleaf compila (latexmk, com a bibliografia): o ZIP compila sozinho${c.pages ? `, ${c.pages} página${c.pages > 1 ? 's' : ''}` : ''}.`, `Tested the way Overleaf compiles (latexmk, with the bibliography): the ZIP compiles on its own${c.pages ? `, ${c.pages} page${c.pages > 1 ? 's' : ''}` : ''}.`),
    );
  const items = [
    ...c.errors.map((e) => `${e.file ? e.file + (e.line ? ':' + e.line : '') + ': ' : ''}${e.message}`),
    ...c.missingFiles.map((f) => L(`Arquivo não encontrado: ${f}`, `File not found: ${f}`)),
    ...c.leaks.map((f) => L(`Lido de fora do ZIP: ${f}`, `Read from outside the ZIP: ${f}`)),
    ...c.undefinedRefs.map((k) => L(`Referência indefinida: ${k}`, `Undefined reference: ${k}`)),
    ...c.undefinedCites.map((k) => L(`Citação indefinida: ${k}`, `Undefined citation: ${k}`)),
  ];
  if (!c.pdf && !items.length) items.push(L('Nenhum PDF gerado.', 'No PDF produced.'));
  return h(
    'div',
    { class: 'qq-banner' },
    icon('warn'),
    h('div', {}, h('b', {}, L('No Overleaf, o ZIP vai dar problema', 'On Overleaf, the ZIP will have problems')), L(' (testado numa pasta vazia, como o Overleaf compila):', ' (tested in an empty folder, the way Overleaf compiles):'), h('ul', {}, items.slice(0, 12).map((t) => h('li', { style: mono }, t)))),
  );
}

const step = (...body) => h('li', { style: { marginBottom: '6px' } }, ...body);

function resultView(S, r, to) {
  const who = to || L('o coautor', 'your coauthor');
  return h(
    'div',
    {},
    h('p', { style: { marginTop: 0 } }, h('b', {}, basename(r.zip)), L(` (${(r.size / 1024).toFixed(0)} KB, ${r.files.length} arquivos).`, ` (${(r.size / 1024).toFixed(0)} KB, ${r.files.length} files).`)),
    checkView(r.check),
    r.tooMany
      ? h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, L(`O Overleaf aceita até 180 arquivos por envio, e este ZIP tem ${r.files.length}: o que passar disso fica de fora. Depois de criar o projeto, suba o resto pelo botão Upload dentro dele.`, `Overleaf takes up to 180 files per upload, and this ZIP has ${r.files.length}: the rest is left out. After creating the project, upload the rest with the Upload button inside it.`)))
      : null,
    r.moved.length
      ? h(
          'details',
          {},
          h('summary', { class: 'muted' }, L(`${r.moved.length} arquivo${r.moved.length > 1 ? 's' : ''} de fora da pasta do documento, com os caminhos ajustados só nas cópias`, `${r.moved.length} file${r.moved.length > 1 ? 's' : ''} from outside the document folder, with paths fixed in the copies only`)),
          h('ul', {}, r.moved.slice(0, 12).map((m) => h('li', { style: mono }, `${relPath(S.project.root, m.from)} → ${m.to}`))),
        )
      : null,
    h('p', { style: { marginBottom: '6px' } }, h('b', {}, L('No Overleaf', 'On Overleaf'))),
    h(
      'ol',
      { style: { paddingLeft: '20px', marginTop: 0 } },
      step(L('Na lista de projetos: ', 'In the project list: '), h('b', {}, 'New project → Existing project (.zip)'), L(' (em versões antigas, Upload Project). Arraste o ZIP.', ' (Upload Project in older versions). Drop the ZIP.')),
      step(h('b', {}, 'Share'), L(`: convide ${who} pelo e-mail, ou mande o link de edição.`, `: invite ${who} by e-mail, or send the edit link.`)),
      step(L(`Quando ${who} terminar: `, `When ${who} is done: `), h('b', {}, 'File → Download → Download as source (.zip)'), L('. O ZIP vai para a pasta Downloads.', '. The ZIP lands in Downloads.')),
      step(L('Aqui: ', 'Here: '), h('b', {}, L('Recebi do Overleaf', 'Back from Overleaf')), L(` (aba Revisão). O TeXugo acha o ZIP no Downloads e mostra só as mudanças de ${who}, mesmo que o texto daqui tenha mudado nesse meio-tempo.`, ` (Review tab). TeXugo finds the ZIP in Downloads and shows only ${who}’s changes, even if the text here changed in the meantime.`)),
    ),
    h('p', { class: 'faint', style: { fontSize: '12px' } }, L('Esta versão ficou marcada como enviada (Versões enviadas). O ZIP fica em .texugo/overleaf, fora do Git.', 'This version is marked as sent (Sent versions). The ZIP is kept in .texugo/overleaf, outside Git.')),
  );
}

// The Revisão row's status after a ZIP went out.
export const overleafSent = (mark, date) =>
  L(`ZIP enviado${mark.to ? ' a ' + mark.to : ''} em ${date}. Quando ele voltar, “Recebi do Overleaf”.`, `ZIP sent${mark.to ? ' to ' + mark.to : ''} on ${date}. When it comes back, “Back from Overleaf”.`);

export function overleafSendDialog(app, S) {
  const t = app.activeTab();
  const doc = t && t.root;
  if (!doc) return toast(L('Abra um arquivo do paper.', 'Open a file of the paper.'), 'warn');
  const to = h('input', { placeholder: L('Ana', 'Ana'), style: { width: '100%' } });
  const status = h('div');
  const body = h(
    'div',
    {},
    h('p', { style: { marginTop: 0 } }, L('Para um coautor que usa o Overleaf sem Git: o TeXugo monta um ZIP pronto para virar um projeto lá, com a bibliografia e as figuras, e testa se ele compila como o Overleaf compila. A versão fica marcada como enviada: quando o ZIP voltar, aparecem só as mudanças do coautor.', 'For a coauthor who uses Overleaf without Git: TeXugo builds a ZIP ready to become a project there, with the bibliography and figures, and tests that it compiles the way Overleaf compiles. The version is marked as sent: when the ZIP comes back, only the coauthor’s changes show.')),
    h('div', { class: 'field' }, h('label', {}, L('Para quem', 'Sent to')), to),
    status,
  );
  const go = h('button', { class: 'btn primary' }, icon('down'), L('Montar o ZIP', 'Build the ZIP'));
  const m = modal({ title: [icon('papers'), ' ', L('Mandar para o Overleaf', 'Send to Overleaf')], body, footer: [go] });
  go.onclick = async () => {
    go.disabled = true;
    clear(status, h('div', { class: 'faint', style: { marginTop: '8px' } }, h('span', { class: 'status-dot building' }), ' ', L('Montando o ZIP e compilando como o Overleaf…', 'Building the ZIP and compiling it as Overleaf does…')));
    try {
      const r = await call('overleafZip', { root: S.project.root, doc, to: to.value.trim() });
      m.close();
      await loadSent(app, S);
      app.refreshRevisao && app.refreshRevisao();
      modal({
        title: [icon('check'), ' ', L('ZIP para o Overleaf', 'ZIP for Overleaf')],
        body: resultView(S, r, to.value.trim()),
        footer: [
          h('button', { class: 'btn', onclick: () => call('reveal', { path: r.zip }) }, icon('folder'), REVEAL),
          h('button', { class: 'btn primary', onclick: () => call('openUrl', { url: 'https://www.overleaf.com/project' }).catch((e) => toast(e.message, 'error')) }, icon('external'), L('Abrir o Overleaf', 'Open Overleaf')),
        ],
      });
    } catch (err) {
      go.disabled = false;
      clear(status, h('div', { class: 'qq-banner' }, icon('warn'), h('div', {}, err.message)));
    }
  };
  setTimeout(() => to.focus(), 30);
}
