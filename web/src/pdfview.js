// One PDF viewer per open PDF tab. Each keeps its own scroll and zoom, and a
// reload after a build returns to the same place in the document.
import pdfjsLib from './pdfjs-setup.js';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer, ScrollMode, SpreadMode } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { h } from './dom.js';

export class PdfTab {
  constructor(path, { onInverse, onState, find = false }) {
    this.path = path;
    this.onInverse = onInverse;
    this.onState = onState || (() => {});
    this.el = h('div', { class: 'pdf-view' });
    this.inner = h('div', { class: 'pdfViewer' });
    this.el.append(this.inner);
    this.bus = new EventBus();
    this.links = new PDFLinkService({ eventBus: this.bus, externalLinkTarget: 2 });
    // Find with highlights, for the paper library's reader.
    this.finder = find ? new PDFFindController({ linkService: this.links, eventBus: this.bus }) : null;
    this.onMatches = null;
    this.ready = false;
    this._readyFns = [];
    this.viewer = new PDFViewer({
      container: this.el,
      viewer: this.inner,
      eventBus: this.bus,
      linkService: this.links,
      findController: this.finder || undefined,
      textLayerMode: 1,
      annotationMode: 1,
      removePageBorders: true,
      maxCanvasPixels: 16777216 * 2,
    });
    this.links.setViewer(this.viewer);
    this.scale = 'page-width';
    this.doc = null;
    this.loading = null;
    this.bus.on('pagesinit', () => {
      this.viewer.currentScaleValue = this.scale;
      if (this.pendingRestore) {
        const r = this.pendingRestore;
        this.pendingRestore = null;
        requestAnimationFrame(() => {
          this.el.scrollTop = r.top * this.el.scrollHeight;
          this.el.scrollLeft = r.left;
        });
      }
      this.onState(this);
      this.ready = true;
      for (const fn of this._readyFns.splice(0)) requestAnimationFrame(fn);
    });
    if (this.finder) {
      const tell = (e) => e.matchesCount && this.onMatches && this.onMatches(e.matchesCount);
      this.bus.on('updatefindmatchescount', tell);
      this.bus.on('updatefindcontrolstate', tell);
    }
    this.bus.on('pagechanging', () => this.onState(this));
    this.bus.on('scalechanging', () => this.onState(this));
    this.el.addEventListener('dblclick', (e) => this._inverse(e));
    // "Page width" and "whole page" follow the pane: dragging a divider,
    // resizing the window or opening a side panel refits the page.
    if (typeof ResizeObserver !== 'undefined') {
      let w = 0;
      let timer = null;
      this.resizer = new ResizeObserver(() => {
        const now = this.el.clientWidth;
        if (!now || Math.abs(now - w) < 2) return;
        w = now;
        clearTimeout(timer);
        timer = setTimeout(() => this.refit(), 120);
      });
      this.resizer.observe(this.el);
    }
    // Pinch / ctrl+wheel zoom.
    this.el.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const f = Math.exp(-e.deltaY / 200);
        this.setScale(Math.min(6, Math.max(0.25, this.viewer.currentScale * f)));
      },
      { passive: false },
    );
  }

  async load(url) {
    const restore = this.doc ? { top: this.el.scrollTop / Math.max(1, this.el.scrollHeight), left: this.el.scrollLeft } : null;
    const task = pdfjsLib.getDocument({ url, cMapUrl: './cmaps/', cMapPacked: true, standardFontDataUrl: './standard_fonts/', isEvalSupported: false });
    this.loading = task;
    let doc;
    try {
      doc = await task.promise;
    } catch (err) {
      if (this.loading === task) this.loading = null;
      throw err;
    }
    if (this.loading !== task) {
      doc.destroy();
      return;
    }
    this.loading = null;
    if (restore) this.pendingRestore = restore;
    const old = this.doc;
    this.doc = doc;
    this._textCache = null;
    this.viewer.setDocument(doc);
    this.links.setDocument(doc);
    if (old) old.destroy();
  }

  // Runs fn once the pages are laid out (now, if they already are).
  whenReady(fn) {
    if (this.ready) fn();
    else this._readyFns.push(fn);
  }

  // Highlights every term (case and accents ignored) and moves to the next
  // match from the current page; `again` steps, `previous` goes back.
  find(terms, { again = false, previous = false } = {}) {
    if (!this.finder) return;
    this.bus.dispatch('find', { source: this, type: again ? 'again' : '', query: terms.length === 1 ? terms[0] : terms, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }

  get pages() {
    return this.doc ? this.doc.numPages : 0;
  }
  get page() {
    return this.viewer.currentPageNumber || 1;
  }
  set page(n) {
    if (this.doc) this.viewer.currentPageNumber = Math.max(1, Math.min(this.pages, n));
  }
  refit() {
    if (!this.doc || !this.ready || typeof this.scale !== 'string' || this.el.classList.contains('presenting')) return;
    const top = this.el.scrollTop / Math.max(1, this.el.scrollHeight);
    this.viewer.currentScaleValue = this.scale;
    requestAnimationFrame(() => (this.el.scrollTop = top * this.el.scrollHeight));
  }

  setScale(v) {
    this.scale = v;
    if (this.doc) this.viewer.currentScaleValue = String(v);
    this.onState(this);
  }
  zoom(f) {
    this.setScale(Math.min(6, Math.max(0.25, (this.viewer.currentScale || 1) * f)));
  }

  // Scroll to a SyncTeX hit and outline it briefly. Coordinates are PDF
  // points from the top-left of the page.
  showSync(hit) {
    const pv = this.viewer.getPageView(hit.page - 1);
    if (!pv) return;
    const vp = pv.viewport;
    const pageH = vp.viewBox[3] - vp.viewBox[1];
    // Convert top-left PDF points to viewport pixels.
    const [x1, y1] = vp.convertToViewportPoint(hit.h, pageH - (hit.v - hit.H));
    const [x2, y2] = vp.convertToViewportPoint(hit.h + Math.max(hit.W, 20), pageH - hit.v);
    const top = pv.div.offsetTop + Math.min(y1, y2);
    this.el.scrollTo({ top: Math.max(0, top - this.el.clientHeight / 3), behavior: 'smooth' });
    const mark = h('div', { class: 'sync-mark' });
    Object.assign(mark.style, { left: pv.div.offsetLeft + Math.min(x1, x2) - 3 + 'px', top: top - 3 + 'px', width: Math.abs(x2 - x1) + 6 + 'px', height: Math.max(14, Math.abs(y2 - y1)) + 6 + 'px' });
    this.inner.style.position = 'relative';
    this.inner.append(mark);
    setTimeout(() => mark.remove(), 2600);
  }

  // Text items of a page with their boxes in top-left PDF points.
  async _items(n) {
    this._textCache = this._textCache || new Map();
    if (this._textCache.has(n)) return this._textCache.get(n);
    const page = await this.doc.getPage(n);
    const tc = await page.getTextContent();
    const H = page.view[3] - page.view[1];
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ str: it.str, x: it.transform[4], y: H - it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) || 10 }));
    this._textCache.set(n, items);
    return items;
  }

  // The printed line under a point, plus the lines around it, for SyncTeX
  // by text.
  async textAt(n, x, y) {
    const items = await this._items(n);
    const lines = [];
    for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const l = lines.find((L) => Math.abs(L.y - it.y) < 3);
      if (l) l.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    if (!lines.length) return '';
    let i = lines.findIndex((L) => L.y >= y - 2);
    if (i < 0) i = lines.length - 1;
    const text = (L) => (L ? L.items.sort((a, b) => a.x - b.x).map((it) => it.str).join(' ') : '');
    return [text(lines[i - 1]), text(lines[i]), text(lines[i + 1])].join(' ').replace(/-\s+/g, '');
  }

  // Where a run of words prints: the best page and box, or null.
  async findWords(words) {
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    for (let k = Math.min(6, words.length); k >= 3; k--) {
      for (let s = 0; s + k <= words.length; s++) {
        const needle = words.slice(s, s + k).join(' ');
        for (let n = 1; n <= this.doc.numPages; n++) {
          const items = await this._items(n);
          const ws = [];
          for (const it of items) for (const w of norm(it.str)) ws.push({ w, it });
          const hay = ws.map((x) => x.w).join(' ');
          const at = (' ' + hay + ' ').indexOf(' ' + needle + ' ');
          if (at < 0) continue;
          const idx = hay.slice(0, at).split(' ').filter(Boolean).length;
          const it = ws[Math.min(idx, ws.length - 1)].it;
          return { page: n, h: it.x, v: it.y, W: Math.max(it.w, 40), H: it.h };
        }
      }
    }
    return null;
  }

  _inverse(e) {
    const pageDiv = e.target.closest('.page');
    if (!pageDiv || !this.doc) return;
    const n = Number(pageDiv.dataset.pageNumber);
    const pv = this.viewer.getPageView(n - 1);
    const rect = pageDiv.getBoundingClientRect();
    const [px, py] = pv.viewport.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top);
    const pageH = pv.viewport.viewBox[3] - pv.viewport.viewBox[1];
    this.onInverse && this.onInverse({ pdf: this.path, page: n, x: px, y: pageH - py, viewer: this });
  }

  // Full-screen presentation: one page at a time, arrows/space/clicks to move.
  async present() {
    if (!this.doc) return;
    const prev = { scale: this.scale, scroll: this.viewer.scrollMode, page: this.page };
    const onKey = (e) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) this.viewer.nextPage();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) this.viewer.previousPage();
      else if (e.key === 'Home') this.page = 1;
      else if (e.key === 'End') this.page = this.pages;
      else return;
      e.preventDefault();
    };
    const onClick = (e) => (e.shiftKey ? this.viewer.previousPage() : this.viewer.nextPage());
    const exit = () => {
      if (document.fullscreenElement) return;
      document.removeEventListener('fullscreenchange', exit);
      document.removeEventListener('keydown', onKey, true);
      this.el.removeEventListener('click', onClick);
      this.el.classList.remove('presenting');
      this.viewer.scrollMode = prev.scroll;
      this.setScale(prev.scale);
    };
    this.el.classList.add('presenting');
    await this.el.requestFullscreen();
    this.viewer.scrollMode = ScrollMode.PAGE;
    this.viewer.spreadMode = SpreadMode.NONE;
    this.page = prev.page;
    setTimeout(() => (this.viewer.currentScaleValue = 'page-fit'), 60);
    document.addEventListener('fullscreenchange', exit);
    document.addEventListener('keydown', onKey, true);
    this.el.addEventListener('click', onClick);
  }

  destroy() {
    if (this.resizer) this.resizer.disconnect();
    if (this.doc) this.doc.destroy();
    this.el.remove();
  }
}
