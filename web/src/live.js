// Live preview in the page: after a pause in typing, send the unsaved
// buffers to the server for one quick pass and swap the PDF tab of the
// document to the result, keeping the scroll position. Nothing is saved.
// See server/live.js for how the pass works.
import { call, on } from './api.js';

// Pause after the last key: 700 ms, or half the last pass when the paper is
// slow, so a 10 s document is not recompiled nonstop while you type.
const PAUSE_MS = 700;

export function setupLive(app, S) {
  S.live = new Map(); // doc -> { status: 'running'|'ok'|'error', ms, errors, at }
  const timers = new Map();

  const tabText = (t) => (t.path === S.active ? app.view.state : t.state).doc.toString();

  const pdfOf = (doc) => doc.replace(/\.tex$/, '.pdf');

  function run(doc) {
    if (!S.project || !doc) return;
    // A full build is on its way and will bring the real PDF.
    if (S.building) return;
    const buffers = S.tabs.filter((t) => t.dirty && !t.binary && t.state).map((t) => ({ path: t.path, text: tabText(t) }));
    const last = S.docState.get(doc)?.result;
    S.live.set(doc, { ...(S.live.get(doc) || {}), status: 'running' });
    app.renderDocBar();
    call('livePreview', { root: S.project.root, doc, buffers, tolerate: !!last && last.status === 'error' }).catch((err) => {
      S.live.set(doc, { status: 'error', errors: [{ message: err.message }] });
      app.renderDocBar();
    });
  }

  // Called on every edit of tab `t`.
  function changed(t) {
    if (!t || !t.livePreview || !t.root) return;
    const doc = t.root;
    clearTimeout(timers.get(doc));
    timers.set(doc, setTimeout(() => run(doc), Math.max(PAUSE_MS, ((S.live.get(doc) || {}).ms || 0) / 2)));
  }

  function setOn(t, val) {
    t.livePreview = !!val;
    if (val) run(t.root);
    else if (t.root && !S.tabs.some((x) => x !== t && x.livePreview && x.root === t.root)) off(t.root);
    app.renderDocBar();
    app.saveUiSoon && app.saveUiSoon();
  }

  // Back to the real PDF of the last full build.
  function off(doc) {
    clearTimeout(timers.get(doc));
    call('liveStop', { doc }).catch(() => {});
    S.live.delete(doc);
    const p = S.pdfTabs.find((x) => x.path === pdfOf(doc));
    if (p && p.live) {
      p.live = null;
      app.reloadPdf(p);
    }
  }

  on('live:done', (e) => {
    if (!S.project || e.root !== S.project.root) return;
    if (!S.tabs.some((t) => t.livePreview && t.root === e.doc)) return;
    const st = { status: e.ok ? 'ok' : 'error', ms: e.ms, errors: e.errors || [], at: Date.now(), shown: e.shown };
    S.live.set(e.doc, st);
    if (e.shown && e.pdf && !S.building) {
      const real = pdfOf(e.doc);
      let p = S.pdfTabs.find((x) => x.path === real);
      if (!p && !S.detached.has(real)) {
        app.openPdf(real, { doc: e.doc, activate: true, live: e.pdf });
        p = S.pdfTabs.find((x) => x.path === real);
      } else if (p) {
        p.live = e.pdf;
        app.reloadPdf(p);
      }
    }
    app.renderDocBar();
  });

  // A full build replaces whatever the live pass showed.
  on('build:done', (e) => {
    for (const d of e.docs || []) {
      const p = S.pdfTabs.find((x) => x.path === pdfOf(d.doc));
      if (p) p.live = null;
      S.live.delete(d.doc);
    }
  });

  return { changed, setOn, run, off };
}

// The PDF a viewer is showing right now (the live one while it is up).
export function shownPdf(S, pdf) {
  const p = S.pdfTabs.find((x) => x.path === pdf);
  return (p && p.live) || pdf;
}
