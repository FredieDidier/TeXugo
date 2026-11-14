// What a screen reader gets from TeXugo, read from Chromium's accessibility
// tree (the same tree VoiceOver, NVDA and Orca read). Walks the window with
// Tab, opens the palette, a dialog and Preferences, compiles, and records at
// each step what would be announced: role, name and state of the focused
// element, and the text of live regions. Run with
//   npm run build:web && electron test/ui/screenreader.mjs
// It does not replace a session with VoiceOver itself: it cannot tell
// whether the reading order sounds right, only whether something is there.
import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'texugo-sr-'));
const PROJ = path.join(TMP, 'demo-paper');
fs.mkdirSync(path.join(TMP, 'profile'));
fs.writeFileSync(path.join(TMP, 'profile', 'state.json'), JSON.stringify({ settings: { grammar: false, lang: 'pt', reopenLast: false, onboarded: true }, recents: [] }));
app.setPath('userData', path.join(TMP, 'profile'));
const { createFromTemplate } = await import(pathToFileURL(path.join(REPO, 'server/templates.js')).href);
createFromTemplate('artigo-apendice', PROJ, { title: 'Bus Lanes and Commuting Time', author: 'A. Author' }, 'en');
let hasTex = true;
try {
  execFileSync('latexmk', ['-v'], { stdio: 'pipe' });
} catch {
  hasTex = false;
}
dialog.showMessageBoxSync = () => 2;
process.argv.push(PROJ);
await import(pathToFileURL(path.join(REPO, 'electron/main.js')).href);

const MOD = process.platform === 'darwin' ? 'meta' : 'control';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + JSON.stringify(detail).slice(0, 1500)}`);
};
// Roles that say nothing to a listener about what the control does.
const VAGUE = new Set(['generic', 'none', 'GenericContainer', 'StaticText', 'InlineTextBox', 'div', '']);

app.whenReady().then(async () => {
  let code = 1;
  try {
    await sleep(1500);
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.webContents;
    const cdp = wc.debugger;
    cdp.attach('1.3');
    await cdp.sendCommand('Accessibility.enable');
    const js = (body) => wc.executeJavaScript(`(async () => { ${body} })()`, true);
    const until = async (body, ms = 15000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await js(body).catch(() => false)) return true;
      return false;
    };
    const key = async (keyCode, modifiers = []) => {
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await sleep(150);
    };
    // What would be announced for the focused element. The status bar is
    // rebuilt when the word count or the Git state changes, and the app moves
    // the focus to the new copy of the item; if that happens between reading
    // the focused element and asking for its accessibility node, the node
    // belongs to an element no longer in the page, so the reading is redone.
    const focused = async () => {
      let n = {};
      for (let attempt = 0; attempt < 5; attempt++) {
        const { result } = await cdp.sendCommand('Runtime.evaluate', { expression: 'document.activeElement' });
        if (!result.objectId) return null;
        const { nodes } = await cdp.sendCommand('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
        n = nodes[0] || {};
        const { result: still } = await cdp.sendCommand('Runtime.callFunctionOn', { objectId: result.objectId, functionDeclaration: 'function () { return this.isConnected && this === document.activeElement; }', returnByValue: true });
        if (still.value) break;
        await sleep(100);
      }
      const props = Object.fromEntries((n.properties || []).map((p) => [p.name, p.value?.value]));
      const where = await js(`const e = document.activeElement; return (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/)[0] : e.tagName.toLowerCase()) + (e.closest('[role=dialog]') ? ' (dialog)' : '');`);
      return { role: n.role?.value || '', name: (n.name?.value || '').trim(), ignored: !!n.ignored, props, where };
    };
    const say = (f) => (f ? `${f.role} "${f.name}"${f.props.expanded != null ? ` expanded=${f.props.expanded}` : ''}${f.props.selected ? ' selected' : ''}${f.props.checked != null ? ` checked=${f.props.checked}` : ''}` : '(nothing)');
    const log = [];

    await until(`return document.title.startsWith('demo-paper') && !!document.querySelector('.tab.active');`);
    await sleep(800);

    // ---- 1. Tab through the whole window from the top.
    await js(`document.activeElement?.blur(); document.body.focus(); return true;`);
    const stops = [];
    for (let i = 0; i < 120; i++) {
      // Tab indents inside the editor; Esc and then Tab move on.
      if (stops.length && stops[stops.length - 1].where === '.cm-content') await key('Escape');
      await key('Tab');
      const f = await focused();
      const id = f && `${f.where}|${f.role}|${f.name}`;
      if (stops.length > 3 && id === stops[0].id) break; // came back around
      stops.push({ ...f, id });
    }
    log.push('## Tab order', ...stops.map((s, i) => `${i + 1}. ${say(s)}  [${s.where}]`));
    const unnamed = stops.filter((s) => !s.name && s.where !== '.cm-content');
    const vague = stops.filter((s) => VAGUE.has(s.role));
    check('every Tab stop has a name a screen reader can say', unnamed.length === 0, unnamed.map((s) => `${s.role} ${s.where}`));
    check('every Tab stop has a role (button, tab, link, textbox…)', vague.length === 0, vague.map((s) => `${s.role} "${s.name}" ${s.where}`));
    check('Tab reaches the editor', stops.some((s) => s.where === '.cm-content'));
    check('Tab goes around the window and comes back, without getting stuck', stops.length < 120, stops.length);

    // ---- 2. The editor itself.
    await js(`document.querySelector('.editor-host .cm-content').focus(); return true;`);
    const ed = await focused();
    log.push('', '## Editor', say(ed));
    check('the editor is announced as a text box with a name', /textbox/i.test(ed.role) && !!ed.name, say(ed));

    // ---- 3. The palette.
    await key('k', [MOD]);
    await sleep(400);
    const pal = await focused();
    const palOpt = await js(`const s = document.querySelector('.palette .item.sel'); return s ? { role: s.getAttribute('role'), sel: s.getAttribute('aria-selected'), active: document.activeElement.getAttribute('aria-activedescendant') === s.id && !!s.id } : null;`);
    log.push('', '## Palette', say(pal), JSON.stringify(palOpt));
    check('palette: the search field is announced with a name', !!pal && !!pal.name, say(pal));
    check('palette: the highlighted command is the active option (aria-activedescendant)', !!palOpt && palOpt.role === 'option' && palOpt.active, palOpt);
    await key('Escape');

    // ---- 4. A dialog: Preferences.
    await key(',', [MOD]);
    await until(`return !!document.querySelector('[role=dialog]');`, 4000);
    await sleep(300);
    const dlg = await js(`const d = document.querySelector('[role=dialog]'); const l = d && (d.getAttribute('aria-label') || document.getElementById(d.getAttribute('aria-labelledby') || '')?.innerText); return { name: l || '', modal: d?.getAttribute('aria-modal'), focusInside: d?.contains(document.activeElement) };`);
    const inPrefs = await focused();
    const prefTabs = await js(`return [...document.querySelectorAll('[role=dialog] [role=tab]')].map((t) => t.innerText.trim() + (t.getAttribute('aria-selected') === 'true' ? '*' : ''));`);
    log.push('', '## Preferences', JSON.stringify(dlg), say(inPrefs), 'tabs: ' + prefTabs.join(', '));
    check('dialog: it has a name and aria-modal, and the focus is inside', !!dlg.name && dlg.modal === 'true' && dlg.focusInside, dlg);
    check('Preferences: the sections are tabs, one of them selected', prefTabs.length >= 5 && prefTabs.filter((t) => t.endsWith('*')).length === 1, prefTabs);
    // Every pane, not only the open one: the name as the accessibility tree
    // computes it.
    const bare = [];
    for (let i = 0; i < prefTabs.length; i++) {
      await js(`document.querySelectorAll('[role=dialog] [role=tab]')[${i}].click(); return true;`);
      await sleep(200);
      const n = await js(`return [...document.querySelectorAll('[role=dialog] input, [role=dialog] select, [role=dialog] textarea')].filter((e) => e.offsetParent).length;`);
      for (let j = 0; j < n; j++) {
        const { result } = await cdp.sendCommand('Runtime.evaluate', { expression: `[...document.querySelectorAll('[role=dialog] input, [role=dialog] select, [role=dialog] textarea')].filter((e) => e.offsetParent)[${j}]` });
        const { nodes } = await cdp.sendCommand('Accessibility.getPartialAXTree', { objectId: result.objectId, fetchRelatives: false });
        const name = (nodes[0]?.name?.value || '').trim();
        if (!name) bare.push(`${prefTabs[i]} #${j + 1} ${nodes[0]?.role?.value}`);
      }
    }
    check('Preferences: every visible field has a label', bare.length === 0, bare);
    await key('Escape');
    await sleep(300);
    const back = await focused();
    check('closing the dialog gives the focus back', back && back.where !== 'body', say(back));

    // ---- 5. Compiling: is the result announced?
    if (hasTex) {
      await js(`document.querySelector('.editor-host .cm-content').focus(); return true;`);
      const live = `return [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')].filter((e) => e.offsetParent || e.closest('.toasts')).map((e) => e.innerText.trim()).filter(Boolean).join(' | ');`;
      const before = await js(live);
      await key('Enter', [MOD]);
      await until(`return !!document.querySelector('.pdf-view:not(.hidden) .page') && !document.querySelector('.status-dot.building');`, 90000);
      await sleep(800);
      const after = await js(live);
      log.push('', '## After compiling, live regions', `before: ${before || '(empty)'}`, `after: ${after || '(empty)'}`);
      check('the build result is announced in a live region', after !== before && /\?\?|compil|erro|PDF/i.test(after), { before, after });
    }

    // ---- 6. Landmarks: regions a reader can jump between.
    const marks = await js(`return [...document.querySelectorAll('[role=main], main, [role=navigation], nav, [role=region][aria-label], [role=complementary], aside, [role=toolbar], [role=banner], header, [role=contentinfo], footer')].filter((e) => e.offsetParent && !e.closest('[role=dialog]')).map((e) => (e.getAttribute('role') || e.tagName.toLowerCase()) + ':' + (e.getAttribute('aria-label') || ''));`);
    log.push('', '## Landmarks', ...marks);
    check('the window has landmarks to jump between (main area and others)', marks.some((m) => /^(main|region)/.test(m)) && marks.length >= 3, marks);

    const report = path.join(REPO, 'out', 'screenreader-report.md');
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, `# What a screen reader gets\n\n${log.join('\n')}\n`);
    console.log('\nReport:', report);
    code = results.every((r) => r.ok) ? 0 : 1;
  } catch (err) {
    console.error('FAIL (the script itself):', err);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {}
  app.exit(code);
});
