// One PDF viewer per open PDF tab. Each keeps its own scroll and zoom, and a
// reload after a build returns to the same place in the document.
import pdfjsLib from './pdfjs-setup.js';
import { EventBus, PDFLinkService, PDFViewer, ScrollMode, SpreadMode } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { h } from './dom.js';

export class PdfTab {
  constructor(path, { onInverse, onState }) {
    this.path = path;
    this.onInverse = onInverse;
    this.onState = onState || (() => {});
    this.el = h('div', { class: 'pdf-view' });
    this.inner = h('div', { class: 'pdfViewer' });
    this.el.append(this.inner);
    this.bus = new EventBus();
    this.links = new PDFLinkService({ eventBus: this.bus, externalLinkTarget: 2 });
    this.viewer = new PDFViewer({
      container: this.el,
      viewer: this.inner,
      eventBus: this.bus,
      linkService: this.links,
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
    });
    this.bus.on('pagechanging', () => this.onState(this));
    this.bus.on('scalechanging', () => this.onState(this));
    this.el.addEventListener('dblclick', (e) => this._inverse(e));
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
    this.viewer.setDocument(doc);
    this.links.setDocument(doc);
    if (old) old.destroy();
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

  _inverse(e) {
    const pageDiv = e.target.closest('.page');
    if (!pageDiv || !this.doc) return;
    const n = Number(pageDiv.dataset.pageNumber);
    const pv = this.viewer.getPageView(n - 1);
    const rect = pageDiv.getBoundingClientRect();
    const [px, py] = pv.viewport.convertToPdfPoint(e.clientX - rect.left, e.clientY - rect.top);
    const pageH = pv.viewport.viewBox[3] - pv.viewport.viewBox[1];
    this.onInverse && this.onInverse({ pdf: this.path, page: n, x: px, y: pageH - py });
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
    if (this.doc) this.doc.destroy();
    this.el.remove();
  }
}
