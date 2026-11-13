// Interface regression test in the real Electron app: npm run test:ui
// Opens a project made from a template in a temporary folder, with its own
// profile, and checks the interactions that have no unit test: nothing cut
// off at any window size, the palette, the outline, renaming a folder, and
// the three ways of not losing work (B1, B2, B3 of PRE-LAUNCH-AUDIT.md).
// Native dialogs are answered by code. Needs a display; compiling is
// skipped when latexmk is missing.
import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-ui-'));
const PROJ = path.join(TMP, 'demo-paper');
const OTHER = path.join(TMP, 'second-letter');
fs.mkdirSync(path.join(TMP, 'profile'));
// No grammar server (it would outlive the test) and a fixed language.
fs.writeFileSync(path.join(TMP, 'profile', 'state.json'), JSON.stringify({ settings: { grammar: false, lang: 'pt', reopenLast: false }, recents: [OTHER] }));
app.setPath('userData', path.join(TMP, 'profile'));

const { createFromTemplate } = await import(pathToFileURL(path.join(REPO, 'server/templates.js')).href);
createFromTemplate('artigo-apendice', PROJ, { title: 'Bus Lanes and Commuting Time', author: 'A. Author' }, 'en');
createFromTemplate('carta', OTHER, { title: 'A letter', author: 'A. Author' }, 'en');
const git = (...a) => execFileSync('git', a, { cwd: PROJ, stdio: 'pipe' });
let hasGit = true;
try {
  git('init', '-b', 'main');
  git('-c', 'user.name=A. Author', '-c', 'user.email=author@example.org', 'add', '-A');
  git('-c', 'user.name=A. Author', '-c', 'user.email=author@example.org', 'commit', '-m', 'First draft');
} catch {
  hasGit = false;
}
let hasTex = true;
try {
  execFileSync('latexmk', ['-v'], { stdio: 'pipe' });
} catch {
  hasTex = false;
}

const dialogs = [];
let nextChoice = 2; // Cancelar
dialog.showMessageBoxSync = (...a) => (dialogs.push(a[a.length - 1]), nextChoice);
const events = [];
app.on('will-quit', () => events.push('will-quit'));

process.argv.push(PROJ);
await import(pathToFileURL(path.join(REPO, 'electron/main.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + JSON.stringify(detail)}`);
};
// ⌘ on the Mac, Ctrl elsewhere, as the menu accelerators (CmdOrCtrl).
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let code = 1;
  try {
    await sleep(1500);
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.webContents;
    const js = (body) => wc.executeJavaScript(`(async () => { ${body} })()`, true).catch((err) => { throw new Error(err.message + " in: " + body.slice(0, 160)); });
    const until = async (body, ms = 15000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await js(body).catch(() => false)) return true;
      return false;
    };
    const key = async (keyCode, modifiers = []) => {
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode.length === 1 && !modifiers.length) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(120);
    };
    const type = async (text) => (wc.focus(), await wc.insertText(text), sleep(150));
    const focusEditor = () => js(`document.querySelector('.editor-host .cm-content').focus(); return true;`);
    const clickBtn = (scope, text) => js(`const b = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (b) b.click(); return !!b;`);
    const activity = (prefix) => js(`[...document.querySelectorAll('.activitybar > *')].find((e) => (e.title || '').startsWith(${JSON.stringify(prefix)})).click(); await new Promise((r) => setTimeout(r, 900)); return true;`);
    const CLIPPED = `return ['.doc-bar', '.pdf-tools', '.topbar', '.statusbar', '.bottom-tabs'].flatMap((sel) => { const bar = document.querySelector(sel); if (!bar || !bar.offsetParent) return []; const r = bar.getBoundingClientRect(); return [...bar.children].filter((c) => c.offsetParent && c.getBoundingClientRect().right > r.right + 0.5).map((c) => sel + ' ' + (c.title || c.className)); });`;

    check('project opens with its main document', await until(`return document.title.startsWith('demo-paper') && !!document.querySelector('.tab.active');`));
    check('status bar: singular for one change, no "1 alterações"', !/\b1 (alterações|palavras|páginas|avisos)\b/.test(await js(`return document.querySelector('.statusbar').innerText;`)));

    // ---- a file of the document: the bar with the most controls
    await focusEditor();
    await key('p', [MOD]);
    await type('body');
    check('⌘P finds the file', (await js(`return document.querySelector('.palette .item.sel')?.innerText || '';`)).includes('body.tex'));
    await key('Enter');
    check('the file opens and the editor has the focus', await until(`return document.querySelector('.tab.active .label')?.textContent === 'body.tex' && document.activeElement.classList.contains('cm-content');`, 4000), await js(`return { tabs: [...document.querySelectorAll('.tab .label')].map((e) => e.textContent), active: document.activeElement?.className, palette: !!document.querySelector('.palette-ov') };`));

    // ---- palette: one search for files and commands, no scattered matches
    await key('k', [MOD]);
    await type('body');
    const pal = await js(`return [...document.querySelectorAll('.palette .item')].map((e) => e.innerText);`);
    check('⌘K also finds files', pal.some((t) => /sections[\\/]body\.tex/.test(t)), pal);
    check('palette: "body" does not match unrelated commands', !pal.some((t) => /Biblioteca|Zotero/.test(t)), pal);
    await key('Escape');
    check('Esc gives the focus back to the editor', await js(`return document.activeElement.classList.contains('cm-content');`));

    // ---- compile, then nothing is cut off at any size
    if (hasTex) {
      await key('Enter', [MOD]);
      check('compiles to a PDF', await until(`return !!document.querySelector('.pdf-view:not(.hidden) .page') && !document.querySelector('.status-dot.building');`, 90000));
      await sleep(800);
    }
    for (const [w, h] of [[1480, 870], [1200, 760], [1000, 640], [900, 560]]) {
      win.setContentSize(w, h);
      await sleep(900);
      const cut = await js(CLIPPED);
      check(`${w}×${h}: no control is cut off`, cut.length === 0, cut);
      if (hasTex) {
        const fit = await js(`const v = document.querySelector('.pdf-view:not(.hidden)'); const p = v.querySelector('.page'); return [Math.round(p.getBoundingClientRect().width), v.clientWidth];`);
        check(`${w}×${h}: the PDF follows the width of its pane`, Math.abs(fit[0] - fit[1]) <= 24, fit);
      }
    }
    win.setContentSize(1480, 870);
    await sleep(500);

    // ---- outline of the whole document, from the main file
    await js(`[...document.querySelectorAll('.tab')].find((t) => t.innerText.includes('paper.tex')).click(); return true;`);
    await activity('Estrutura');
    const outline = await js(`return document.querySelector('.sidebar').innerText;`);
    check('outline shows the sections of the files the document inputs', /Introduction/.test(outline) && /Results/.test(outline), outline);

    // ---- accessibility: every control has a name; PDF tabs are tabs
    const unnamed = await js(`return [...document.querySelectorAll('button, input, select, textarea, [role=button], [role=tab]')].filter((e) => e.offsetParent && !e.closest('.cm-editor, .xterm') && !(e.innerText || '').trim() && !e.title && !e.getAttribute('aria-label') && !e.closest('label') && !e.placeholder).map((e) => e.tagName + '.' + e.className);`);
    check('every visible control has an accessible name', unnamed.length === 0, unnamed);
    if (hasTex) check('PDF tabs have role=tab', await js(`return [...document.querySelectorAll('.pdf-group .tab')].every((t) => t.getAttribute('role') === 'tab');`));
    await focusEditor();
    const regions = [];
    for (let i = 0; i < 4; i++) {
      await key('F6');
      regions.push(await js(`const a = document.activeElement; return a.closest('.sidebar') ? 'sidebar' : a.closest('.pdf-group') ? 'pdf' : a.closest('.bottom') ? 'bottom' : a.closest('.editor-group') ? 'editor' : '?';`));
    }
    check('F6 walks the regions and comes back to the editor', regions.includes('sidebar') && regions.includes('editor') && !regions.includes('?'), regions);

    // ---- I14: renaming a folder moves the tabs inside it
    await activity('Arquivos');
    await js(`[...document.querySelectorAll('.tab')].find((t) => t.innerText.includes('body.tex')).click(); return true;`);
    await js(`const row = [...document.querySelectorAll('.tree-row')].find((r) => r.innerText.trim() === 'sections'); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 90 })); await new Promise((r) => setTimeout(r, 200)); [...document.querySelectorAll('.menu .mi')].find((m) => m.innerText.includes('Renomear')).click(); await new Promise((r) => setTimeout(r, 300)); const i = document.querySelector('.modal input'); i.value = 'parts'; return true;`);
    await clickBtn('.modal footer', 'Renomear');
    check('I14: the tab follows the renamed folder', await until(`return document.querySelector('.tab.active')?.title.replace(/\\\\/g, '/').startsWith('parts/body.tex');`, 4000), await js(`return document.querySelector('.tab.active')?.title;`));
    fs.writeFileSync(path.join(PROJ, 'paper.tex'), fs.readFileSync(path.join(PROJ, 'paper.tex'), 'utf8').replace('sections/body', 'parts/body'));
    await sleep(1200);
    await focusEditor();
    await type(' EDITED-AFTER-RENAME');
    await key('s', [MOD]);
    check('I14: saving after the rename writes to the new path', await until(`return !document.querySelector('.tab.dirty');`, 4000) && fs.readFileSync(path.join(PROJ, 'parts', 'body.tex'), 'utf8').includes('EDITED-AFTER-RENAME'));

    // ---- D6: an error stays until closed
    await js(`const row = [...document.querySelectorAll('.tree-row')].find((r) => r.innerText.trim() === 'notes.md') || [...document.querySelectorAll('.tree-row')].find((r) => r.innerText.includes('preamble.tex')); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 90 })); await new Promise((r) => setTimeout(r, 200)); [...document.querySelectorAll('.menu .mi')].find((m) => m.innerText.includes('Renomear')).click(); await new Promise((r) => setTimeout(r, 300)); document.querySelector('.modal input').value = 'paper.tex'; return true;`);
    await clickBtn('.modal footer', 'Renomear');
    await sleep(600);
    check('D6: an error notice has role=alert', await js(`return !!document.querySelector('.toast.error[role=alert]');`));
    await sleep(6500);
    check('D6: the error is still there after 6 s, and its × closes it', (await js(`const t = document.querySelector('.toast.error'); if (!t) return false; t.querySelector('.toast-x').click(); return !document.querySelector('.toast.error');`)) === true);

    // ---- I7: raw HTML in a Markdown file renders as text only
    fs.writeFileSync(path.join(PROJ, 'evil.md'), '# Notes\n\n<script>window.__pwned = 1</script>\n<img src="x" onerror="window.__pwned = 2">\n<base href="https://example.org/">\n<style>body { display: none }</style>\n<form action="https://example.org"><input name="q"></form>\n<a href="javascript:window.__pwned=3">link</a> <details><summary>More</summary>kept</details>\n');
    await sleep(1200);
    await until(`return [...document.querySelectorAll('.tree-row')].some((r) => r.innerText.trim() === 'evil.md');`, 5000);
    await js(`[...document.querySelectorAll('.tree-row')].find((r) => r.innerText.trim() === 'evil.md').click(); return true;`);
    check('I7: the Markdown preview opens', await until(`return document.querySelector('.markdown-body')?.innerText.includes('Notes');`, 5000));
    await sleep(500);
    check('I7: no script, handler, base, style or form survives', await js(`const b = document.querySelector('.markdown-body'); return !window.__pwned && !b.querySelector('script, style, base, form, [onerror]') && !b.querySelector('a[href^="javascript"]') && !!b.querySelector('details summary');`));
    await js(`[...document.querySelectorAll('.tab')].find((t) => t.innerText.includes('body.tex')).click(); return true;`);
    await sleep(400);

    // ---- B3: the file changes on disk under unsaved edits
    await focusEditor();
    await type(' MINE');
    fs.appendFileSync(path.join(PROJ, 'parts', 'body.tex'), '\n% from a coauthor\n');
    await sleep(1500);
    await key('s', [MOD]);
    check('B3: saving over a changed file opens the conflict dialog', await until(`return document.querySelector('.modal-title')?.innerText === 'O arquivo mudou no disco';`, 4000));
    check('B3: the focus is not on the destructive button', await js(`return !document.activeElement.classList.contains('danger');`));
    await clickBtn('.modal', 'Ver diferenças');
    check('B3: the differences show what came from outside', (await js(`return [...document.querySelectorAll('.modal del')].map((d) => d.innerText).join(' ');`)).includes('from a coauthor'));
    await clickBtn('.modal footer', 'Ficar com a do disco');
    check('B3: keeping the disk version reloads the tab', await until(`return !document.querySelector('.tab.dirty') && document.querySelector('.editor-host .cm-content').innerText.includes('from a coauthor');`, 4000));
    if (hasGit) {
      await focusEditor();
      await type(' BEFORE-COMMIT');
      await activity('Git');
      await sleep(600);
      await js(`[...document.querySelectorAll('.sidebar .btn')].find((b) => b.innerText.includes('Commit')).click(); return true;`);
      // The tab is clean as soon as it is saved; the commit lands a moment later.
      const committed = async () => {
        for (let k = 0; k < 40; k++) {
          try {
            if (execFileSync('git', ['show', 'HEAD:parts/body.tex'], { cwd: PROJ, stdio: 'pipe' }).toString().includes('BEFORE-COMMIT')) return true;
          } catch {}
          await sleep(150);
        }
        return false;
      };
      check('B3: commit saves the open tabs first', (await until(`return !document.querySelector('.tab.dirty');`, 6000)) && (await committed()));
    }

    // ---- Claude panel: attach files with the button or by dragging them in
    await activity('Claude');
    check('Claude panel has an attach-files button', await js(`return !!document.querySelector('.agent-panel .agent-files-btn');`));
    check('Claude panel: the send button fits inside the panel', await js(`const p = document.querySelector('.agent-panel').getBoundingClientRect(); return [...document.querySelectorAll('.agent-compose .agent-row > *')].every((c) => c.getBoundingClientRect().right <= p.right + 0.5);`));
    const dropped = path.join(TMP, 'dados de campo.csv');
    fs.writeFileSync(dropped, 'a,b\n1,2\n');
    const box = await js(`const r = document.querySelector('.agent-log').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };`);
    wc.debugger.attach('1.3');
    const data = { items: [], files: [dropped], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await wc.debugger.sendCommand('Input.dispatchDragEvent', { type, x: box.x, y: box.y, data });
    wc.debugger.detach();
    check('a file dragged from the computer becomes an attachment', await until(`return [...document.querySelectorAll('.agent-attach-chip')].some((c) => c.title === ${JSON.stringify(dropped)});`, 3000));
    check('dropping does not leave the page', await js(`return !!document.querySelector('.agent-panel') && !document.querySelector('.agent-panel.drop');`));
    await js(`[...document.querySelectorAll('.agent-attach-chip')].forEach((c) => c.querySelector('.close').click()); return true;`);

    // ---- B2: another project with unsaved edits
    await focusEditor();
    await type(' UNSAVED');
    await js(`document.querySelector('.brand').click(); return true;`);
    check('start screen lists the recent projects of this session', await until(`return [...document.querySelectorAll('.recent')].some((r) => r.title.includes('second-letter'));`, 4000));
    check('start screen offers the language by its own name', await js(`return /Português/.test(document.querySelector('.lang-switch')?.innerText || '') && /English/.test(document.querySelector('.lang-switch').innerText);`));
    await js(`[...document.querySelectorAll('.recent')].find((r) => r.title.includes('second-letter')).click(); return true;`);
    check('B2: opening another project asks first', await until(`return document.querySelector('.modal-title')?.innerText === 'Alterações não salvas';`, 4000));
    await clickBtn('.modal footer', 'Cancelar');
    await sleep(400);
    check('B2: Cancel keeps the project and the unsaved tab', await js(`return document.title.startsWith('demo-paper') && !!document.querySelector('.tab.dirty');`));
    await js(`document.querySelector('.welcome .hero button')?.click(); return true;`);

    // ---- B1: closing and quitting with unsaved edits
    nextChoice = 2;
    win.close();
    await sleep(700);
    check('B1: closing asks, and Cancel keeps the window', dialogs.length === 1 && dialogs[0].buttons.length === 3 && !win.isDestroyed(), dialogs);
    app.quit();
    await sleep(900);
    const alive = await js(`const r = await fetch('/api/hello', { method: 'POST', body: '{}' }).catch(() => null); return r ? r.status : 0;`);
    check('B1: after a cancelled quit the server still answers', alive > 0 && !events.includes('will-quit') && !win.isDestroyed(), { alive, events });
    await focusEditor();
    await key('s', [MOD]);
    check('B1: and saving still works', await until(`return !document.querySelector('.tab.dirty');`, 4000) && fs.readFileSync(path.join(PROJ, 'parts', 'body.tex'), 'utf8').includes('UNSAVED'));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? ': ' + failed.map((f) => f.name).join('; ') : ''}`);
    code = failed.length ? 1 : 0;
  } catch (err) {
    console.error('FAIL (the script itself):', err);
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {}
  app.exit(code);
});
