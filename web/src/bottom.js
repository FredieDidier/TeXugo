// Bottom panel: build timeline (what is being compiled and why), problems
// (errors, ?? and warnings, with plain-language hints), and the raw log.
import { h, clear, icon, basename, relPath } from './dom.js';
import { renderReviewPanel } from './review.js';
import { renderAnnotationsPanel } from './annotations.js';
import { renderNewsPanel, newsCount } from './news.js';

export class BottomPanel {
  constructor(app, S) {
    this.app = app;
    this.S = S;
    this.view = 'build';
    this.logDoc = null;
    this.noteText = null;
    this.filter = { error: true, undefined: true, warning: true, badbox: false, lint: false };
    this.tabsEl = h('div', { class: 'bottom-tabs' });
    this.body = h('div', { class: 'bottom-body' });
    app.bottomEl.append(this.tabsEl, this.body);
    this.render();
  }

  // auto: the app opens the panel by itself (a build started or failed). It
  // never takes the user out of a terminal, where Claude may be working; the
  // Problems tab still shows the count.
  show(view, { soft = false, auto = false } = {}) {
    if (auto && this.view === 'terminal' && this.S.settings.bottomOpen) return this.render();
    if (!soft || !this.S.settings.bottomOpen) this.app.toggleBottom(true);
    if (!soft || this.view !== 'problems') this.view = view;
    this.render();
  }

  note(text) {
    this.noteText = text;
  }

  render() {
    const probs = this.app.allProblems ? this.app.allProblems() : [];
    const errs = probs.filter((p) => p.severity === 'error').length;
    const qq = probs.filter((p) => p.severity === 'undefined').length;
    const warns = probs.filter((p) => p.severity === 'warning').length;
    const tab = (id, label, count, cls) =>
      h('button', { class: 'bottom-tab' + (this.view === id ? ' active' : ''), onclick: () => ((this.view = id), this.render()) }, label, count ? h('span', { class: 'count ' + (cls || '') }, String(count)) : null);
    clear(
      this.tabsEl,
      tab('build', 'Compilação'),
      tab('problems', 'Problemas', errs + qq + warns, errs ? 'err' : qq ? 'warn' : ''),
      tab('log', 'Log'),
      tab('terminal', 'Terminal', this.app.terminals ? this.app.terminals.count : 0),
      this.S.annots || this.view === 'anotacoes' ? tab('anotacoes', 'Anotações', this.S.annots && this.S.annots.items ? this.S.annots.items.filter((a) => !a.done).length : 0) : null,
      this.app.comments && (this.app.comments.items.length || this.view === 'comentarios') ? tab('comentarios', 'Comentários', this.app.comments.count()) : null,
      newsCount(this.S) || this.view === 'novidades' ? tab('novidades', 'Novidades', newsCount(this.S)) : null,
      this.S.review || this.view === 'parecer' ? tab('parecer', 'Parecer', this.S.review && this.S.review.report ? this.S.review.report.points.filter((p) => !p.done).length : 0) : null,
      h('span', { style: { flex: 1 } }),
      this.view === 'terminal'
        ? h('button', { class: 'icon-btn', title: this.S.tallBottom ? 'Painel menor' : 'Painel maior (para o Claude Code)', onclick: () => this.app.toggleTallBottom() }, icon(this.S.tallBottom ? 'down' : 'up'))
        : null,
      h('button', { class: 'icon-btn', title: 'Fechar painel', onclick: () => ((this.S.bottomDismissed = true), this.app.toggleBottom(false)) }, icon('x')),
    );
    if (this.view === 'terminal') {
      if (this.app.terminals && this.app.terminals.el.parentNode !== this.body) {
        clear(this.body, this.app.terminals.el);
        requestAnimationFrame(() => this.app.terminals.fitActive());
      }
      return;
    }
    if (this.view === 'parecer') return renderReviewPanel(this.app, this.S, this.body);
    if (this.view === 'anotacoes') return renderAnnotationsPanel(this.app, this.S, this.body);
    if (this.view === 'novidades') return renderNewsPanel(this.app, this.S, this.body);
    if (this.view === 'comentarios') return this.app.comments.render(this.body);
    if (this.view === 'build') this.renderBuild(true);
    else if (this.view === 'problems') this.renderProblems(true);
    else this.renderLog();
  }

  // ------------------------------------------------------------ build
  renderBuild(force) {
    if (this.view !== 'build') return force ? null : this.renderTabsOnly();
    const S = this.S;
    const docs = [...S.docState.entries()].filter(([, st]) => st.status || st.result);
    if (!docs.length) {
      return clear(
        this.body,
        h(
          'div',
          { class: 'pad muted' },
          'Nada compilado ainda. Use ',
          h('kbd', {}, '⌘↵'),
          ' para compilar o documento da aba, ou ',
          h('kbd', {}, '⌘⇧↵'),
          ' para compilar todos os abertos. Quando um documento usa \\externaldocument, o TeXugo compila o outro junto e repete até os rótulos baterem: é isso que evita o ?? no PDF.',
        ),
      );
    }
    const sum = S.lastSummary;
    const building = !!S.building;
    const summary = building
      ? h('div', { class: 'tl-summary' }, h('span', { class: 'status-dot building' }), h('span', { class: 'big' }, 'Compilando…'), h('span', { class: 'muted' }, S.building.order.map(basename).join(' → ')))
      : sum
        ? h(
            'div',
            { class: 'tl-summary' },
            icon(sum.ok ? 'checkCircle' : 'alert'),
            h('span', { class: 'big', style: { color: sum.ok ? 'var(--ok)' : sum.cancelled ? 'var(--muted)' : 'var(--err)' } }, sum.cancelled ? 'Interrompida' : sum.ok ? 'Tudo certo' : 'Atenção'),
            h('span', { class: 'muted' }, `${(sum.docs || []).length} documento${(sum.docs || []).length > 1 ? 's' : ''} · ${sum.passes || 1} passada${sum.passes > 1 ? 's' : ''} · ${(sum.duration / 1000).toFixed(1)} s`),
          )
        : null;
    const cards = docs.map(([doc, st]) => {
      const r = st.result;
      const status = st.status === 'waiting' ? 'na fila' : st.status === 'building' ? 'compilando' : null;
      const q = r ? r.undefinedRefs.length + r.undefinedCites.length : 0;
      return h(
        'div',
        { class: 'tl-doc ' + (st.status || '') },
        h(
          'div',
          { class: 'head' },
          h('span', { class: 'status-dot ' + (st.status === 'waiting' || st.status === 'building' ? 'building' : st.status || '') }),
          h('span', { class: 'name' }, relPath(S.project.root, doc)),
          status ? h('span', { class: 'chip building' }, status) : r ? this.chipFor(r) : null,
        ),
        st.steps && st.steps.length
          ? h('div', { class: 'steps' }, st.steps.map((s, i) => h('span', { class: 'step' + (st.status === 'building' && i === st.steps.length - 1 ? ' now' : '') }, s.rule)))
          : null,
        st.passes && st.passes.length > 1 ? h('div', { class: 'why' }, 'Recompilado porque ', st.passes.slice(1).map((p) => p.reason).join('; '), '.') : null,
        r && !status
          ? h(
              'div',
              { class: 'meta' },
              r.pages ? h('span', { class: 'chip' }, `${r.pages} páginas`) : null,
              h('span', { class: 'chip' }, r.engine),
              r.externals.length ? h('span', { class: 'chip', title: r.externals.join('\n') }, 'importa ' + r.externals.map(basename).join(', ')) : null,
              r.warnings.length ? h('span', { class: 'chip warn', style: { cursor: 'pointer' }, onclick: () => this.show('problems') }, `${r.warnings.length} avisos`) : null,
              h('button', { class: 'btn sm ghost', onclick: () => ((this.logDoc = doc), this.show('log')) }, 'ver log'),
              r.pdf ? h('button', { class: 'btn sm ghost', onclick: () => this.app.openPdf(r.pdf, { doc, activate: true }) }, icon('pdf'), 'PDF') : null,
            )
          : null,
        r && q && !status ? h('div', { class: 'why', style: { color: 'var(--warn)' } }, `${q} referência${q > 1 ? 's saem' : ' sai'} como ?? no PDF.`) : null,
      );
    });
    clear(this.body, h('div', { class: 'timeline' }, summary, this.noteText && building ? h('div', { class: 'muted', style: { fontSize: '12px' } }, icon('info'), ' ', this.noteText) : null, h('div', { class: 'tl-docs' }, cards)));
    this.renderTabsOnly();
  }

  chipFor(r) {
    const q = r.undefinedRefs.length + r.undefinedCites.length;
    if (r.status === 'error') return h('span', { class: 'chip error' }, `${r.errors.length || 1} erro${r.errors.length > 1 ? 's' : ''}`);
    if (q) return h('span', { class: 'chip undefined' }, `${q} ??`);
    return h('span', { class: 'chip ok' }, icon('check'), 'zero ??');
  }

  renderTabsOnly() {
    // Refresh counts without rebuilding the body.
    const probs = this.app.allProblems ? this.app.allProblems() : [];
    const btns = this.tabsEl.querySelectorAll('.bottom-tab');
    if (btns[1]) {
      const errs = probs.filter((p) => p.severity === 'error').length;
      const qq = probs.filter((p) => p.severity === 'undefined').length;
      const warns = probs.filter((p) => p.severity === 'warning').length;
      const n = errs + qq + warns;
      let c = btns[1].querySelector('.count');
      if (!n) c && c.remove();
      else {
        if (!c) btns[1].append((c = h('span', { class: 'count' })));
        c.textContent = String(n);
        c.className = 'count ' + (errs ? 'err' : qq ? 'warn' : '');
      }
    }
  }

  // ------------------------------------------------------------ problems
  renderProblems(force) {
    if (this.view !== 'problems') return force ? null : this.renderTabsOnly();
    const all = this.app.allProblems();
    const S = this.S;
    const counts = { error: 0, undefined: 0, warning: 0, badbox: 0, lint: 0 };
    all.forEach((p) => counts[p.severity]++);
    const shown = all.filter((p) => this.filter[p.severity]);
    const chip = (k, label, cls) =>
      h(
        'button',
        { class: 'btn sm' + (this.filter[k] ? '' : ' ghost'), style: { opacity: this.filter[k] ? 1 : 0.6 }, onclick: () => ((this.filter[k] = !this.filter[k]), this.renderProblems(true)) },
        h('span', { class: 'status-dot ' + cls }),
        `${label} ${counts[k]}`,
      );
    const anyResult = [...S.docState.values()].some((s) => s.result);
    const byDoc = new Map();
    for (const p of shown) {
      if (!byDoc.has(p.doc)) byDoc.set(p.doc, []);
      byDoc.get(p.doc).push(p);
    }
    const order = { error: 0, undefined: 1, warning: 2, badbox: 3, lint: 4 };
    const ico = { error: 'error', undefined: 'warn', warning: 'warn', badbox: 'info', lint: 'info' };
    clear(
      this.body,
      h('div', { style: { display: 'flex', gap: '6px', padding: '4px 0', flexWrap: 'wrap' } }, chip('error', 'Erros', 'error'), chip('undefined', '??', 'undefined'), chip('warning', 'Avisos', 'warn'), chip('badbox', 'Caixas', ''), counts.lint ? chip('lint', 'Estilo', '') : null),
      counts.undefined
        ? h(
            'div',
            { class: 'qq-banner' },
            h('span', { class: 'qq' }, '??'),
            h('div', {}, h('b', {}, `${counts.undefined} referência${counts.undefined > 1 ? 's' : ''} ou citação${counts.undefined > 1 ? 'ões' : ''} sem destino.`), ' No PDF elas aparecem como ??. Abaixo, cada uma diz o motivo provável.'),
          )
        : anyResult && !counts.error
          ? h('div', { class: 'pad', style: { color: 'var(--ok)', fontWeight: 600 } }, icon('checkCircle'), ' Zero ?? e nenhum erro na última compilação.')
          : null,
      !anyResult ? h('div', { class: 'pad muted' }, 'Compile um documento para ver os problemas aqui.') : null,
      [...byDoc].map(([doc, list]) =>
        h(
          'div',
          { class: 'prob-group' },
          h('h4', {}, icon('tex'), relPath(S.project.root, doc)),
          list
            .sort((a, b) => order[a.severity] - order[b.severity])
            .slice(0, 400)
            .map((p) =>
              h(
                'div',
                { class: 'prob ' + p.severity, onclick: () => p.file && this.app.openFile(p.file, { line: p.line || 1 }) },
                h('span', { class: 'ico' }, icon(ico[p.severity])),
                h(
                  'div',
                  {},
                  h('div', { class: 'msg' }, p.message),
                  p.context ? h('div', { class: 'sub', style: { fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap' } }, p.context.split('\n').slice(0, 3).join('\n')) : null,
                  p.hint ? h('div', { class: 'hint' }, p.hint) : null,
                  p.missing ? h('button', { class: 'btn sm primary', style: { marginTop: '6px' }, onclick: (e) => (e.stopPropagation(), this.app.tools.texDoctor(this.app, this.S, { files: [p.missing] })) }, icon('down'), `Instalar o pacote que tem ${p.missing}`) : null,
                ),
                h('span', { class: 'where' }, p.file ? relPath(S.project.root, p.file) + (p.line ? ':' + p.line : '') : ''),
              ),
            ),
        ),
      ),
    );
    this.renderTabsOnly();
  }

  // ------------------------------------------------------------ log
  renderLog() {
    const S = this.S;
    const docs = [...S.logs.keys()];
    if (!this.logDoc || !S.logs.has(this.logDoc)) this.logDoc = docs[docs.length - 1] || null;
    this.pre = h('pre', {}, this.logDoc ? S.logs.get(this.logDoc) : 'Sem log ainda.');
    clear(
      this.body,
      docs.length > 1
        ? h(
            'div',
            { style: { display: 'flex', gap: '4px', padding: '4px 0 8px' } },
            docs.map((d) => h('button', { class: 'btn sm' + (d === this.logDoc ? '' : ' ghost'), onclick: () => ((this.logDoc = d), this.renderLog()) }, basename(d))),
          )
        : null,
      this.pre,
    );
    this.body.scrollTop = this.body.scrollHeight;
  }

  appendLog(doc, text) {
    if (this.view !== 'log') return;
    if (this.logDoc !== doc) {
      this.logDoc = doc;
      return this.renderLog();
    }
    if (this.pre) {
      const atEnd = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 30;
      this.pre.append(text);
      if (atEnd) this.body.scrollTop = this.body.scrollHeight;
    }
  }
}
