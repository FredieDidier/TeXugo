// Claude panel: a chat with the user's own Claude Code about the project,
// in the sidebar. Claude reads and searches freely; every edit, new file or
// command arrives here as a card to approve (edits as a diff) before it
// happens. Messages carry the active file, the selection and the build
// errors, so "fix this" and "fix the build" work without copying anything.
import { Marked } from 'marked';
import { call, on } from './api.js';
import { h, clear, icon, toast, basename, relPath } from './dom.js';
import { fileDiff } from './ide.js';

const TOOL_PT = {
  Read: 'Leu', Grep: 'Buscou', Glob: 'Listou arquivos', LS: 'Listou', Edit: 'Editou', MultiEdit: 'Editou', Write: 'Escreveu', Bash: 'Rodou',
  WebSearch: 'Pesquisou na web', WebFetch: 'Abriu', Skill: 'Carregou a skill', TodoWrite: 'Atualizou a lista de tarefas', Task: 'Delegou uma tarefa',
};

// Model output is rendered as Markdown with raw HTML dropped.
const safe = new Marked({ gfm: true, breaks: true, renderer: { html: () => '' } });
const md = (text) => {
  const div = document.createElement('div');
  div.className = 'markdown-body agent-md';
  div.innerHTML = safe.parse(String(text));
  return div;
};

export class AgentPanel {
  constructor(app, S) {
    this.app = app;
    this.S = S;
    this.running = false;
    this.log = h('div', { class: 'agent-log' });
    this.input = h('textarea', {
      class: 'agent-input',
      rows: 3,
      placeholder: 'Peça ao Claude: corrija o erro de compilação, revise a seleção, explique esta seção…',
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          this.send();
        }
      },
    });
    this.withSel = h('input', { type: 'checkbox', checked: true });
    this.withErr = h('input', { type: 'checkbox', checked: true });
    this.sendBtn = h('button', { class: 'btn primary sm', onclick: () => (this.running ? this.stop() : this.send()) });
    this.el = h(
      'div',
      { class: 'agent-panel' },
      h(
        'div',
        { class: 'side-head agent-head' },
        h('span', { class: 'term-kind claude' }, '✻'),
        h('b', {}, 'Claude'),
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn sm ghost', title: 'Começa uma conversa nova', onclick: () => this.reset() }, icon('plus'), 'Nova'),
        h('button', { class: 'btn sm ghost', title: 'Abrir o Claude Code completo no terminal', onclick: () => app.terminals.open('claude') }, icon('command'), 'Terminal'),
      ),
      this.log,
      h(
        'div',
        { class: 'agent-compose' },
        this.input,
        h(
          'div',
          { class: 'agent-row' },
          h('label', { class: 'agent-chip', title: 'Envia junto o trecho selecionado no editor' }, this.withSel, 'seleção'),
          h('label', { class: 'agent-chip', title: 'Envia junto os erros e ?? da última compilação' }, this.withErr, 'erros'),
          h('span', { style: { flex: 1 } }),
          this.sendBtn,
        ),
      ),
    );
    this.empty();
    this.setRunning(false);
    on('agent:event', (e) => this.S.project && e.root === this.S.project.root && this.event(e));
  }

  empty() {
    clear(
      this.log,
      h(
        'div',
        { class: 'agent-hello muted' },
        h('p', {}, 'Converse com o seu Claude Code sobre este projeto. Ele lê e busca os arquivos sozinho; cada edição ou comando aparece aqui para você aceitar antes.'),
        h('p', {}, 'A mensagem leva o arquivo aberto, a seleção e os erros da última compilação.'),
      ),
    );
    this.lastText = null;
    this.tools = new Map();
  }

  setRunning(r) {
    this.running = r;
    clear(this.sendBtn, r ? [icon('stop'), 'Parar'] : [icon('up'), 'Enviar']);
    this.el.classList.toggle('busy', r);
    this.waiting = !!this.log.querySelector('.agent-perm:not(.allowed):not(.denied):not(.closed)');
    this.app.renderActivity && this.app.renderActivity();
  }

  add(node) {
    this.log.querySelector('.agent-hello')?.remove();
    this.log.append(node);
    this.log.scrollTop = this.log.scrollHeight;
    return node;
  }

  context() {
    const t = this.app.activeTab();
    const parts = [];
    if (t && !t.binary) {
      parts.push(`Active file: ${t.path}`);
      const sel = this.app.view.state.selection.main;
      const line = this.app.view.state.doc.lineAt(sel.head).number;
      if (this.withSel.checked && !sel.empty) {
        const a = this.app.view.state.doc.lineAt(sel.from).number;
        const b = this.app.view.state.doc.lineAt(sel.to).number;
        parts.push(`Selection (lines ${a}-${b}):\n"""\n${this.app.view.state.sliceDoc(sel.from, sel.to).slice(0, 6000)}\n"""`);
      } else parts.push(`Cursor at line ${line}.`);
    }
    if (this.withErr.checked && this.app.allProblems) {
      const probs = this.app.allProblems().filter((p) => p.severity === 'error' || p.severity === 'undefined').slice(0, 25);
      if (probs.length) parts.push('Last LaTeX build problems:\n' + probs.map((p) => `- ${p.file ? relPath(this.S.project.root, p.file) : '?'}:${p.line || '?'} ${p.message}`).join('\n'));
    }
    return parts.length ? `<texugo-context>\n${parts.join('\n')}\n</texugo-context>\n\n` : '';
  }

  async send() {
    const text = this.input.value.trim();
    if (!text || !this.S.project) return;
    this.input.value = '';
    const t = this.app.activeTab();
    const sel = t && !t.binary && !this.app.view.state.selection.main.empty && this.withSel.checked;
    this.add(h('div', { class: 'agent-msg user' }, document.createTextNode(text), sel ? h('div', { class: 'agent-attach' }, `+ seleção de ${basename(t.path)}`) : null));
    this.setRunning(true);
    this.thinking = this.add(h('div', { class: 'agent-thinking muted' }, h('span', { class: 'status-dot building' }), ' Claude está trabalhando…'));
    try {
      await call('agentSend', { root: this.S.project.root, text: this.context() + text });
    } catch (err) {
      this.setRunning(false);
      this.thinking?.remove();
      this.add(h('div', { class: 'agent-error' }, err.message));
    }
  }

  stop() {
    call('agentInterrupt', { root: this.S.project.root }).catch(() => {});
  }

  reset() {
    call('agentReset', { root: this.S.project.root }).catch(() => {});
    this.setRunning(false);
    this.empty();
  }

  event(e) {
    if (e.kind === 'status') {
      this.setRunning(e.running);
      if (!e.running) this.thinking?.remove();
      return;
    }
    if (e.kind === 'init') return;
    // Keep the "working" line at the bottom while Claude goes on.
    const keep = this.thinking && this.thinking.isConnected;
    if (keep) this.thinking.remove();
    if (e.kind === 'text') this.add(h('div', { class: 'agent-msg claude' }, md(e.text)));
    else if (e.kind === 'tool') {
      if (!['Edit', 'MultiEdit', 'Write', 'Bash'].includes(e.name)) this.tools.set(e.id, this.add(this.toolLine(e)));
    }
    else if (e.kind === 'tool-result') {
      const el = this.tools.get(e.id);
      if (el && e.error) el.classList.add('failed'), el.setAttribute('title', e.text);
    } else if (e.kind === 'permission') this.add(this.permissionCard(e));
    else if (e.kind === 'permission-closed') this.log.querySelector(`[data-req="${e.reqId}"]`)?.classList.add('closed');
    else if (e.kind === 'result') {
      if (!e.ok && e.text && !this.log.lastElementChild?.textContent.includes(e.text)) this.add(h('div', { class: 'agent-error' }, e.text));
    } else if (e.kind === 'error') this.add(h('div', { class: 'agent-error' }, e.text));
    if (keep && this.running) this.add(this.thinking);
  }

  toolLine(e) {
    const inp = e.input || {};
    const file = inp.file_path || inp.path || inp.notebook_path;
    const what = file ? relPath(this.S.project.root, file) : inp.pattern || inp.command || inp.skill || inp.url || inp.query || inp.description || '';
    return h(
      'div',
      { class: 'agent-tool', onclick: file && /\.\w+$/.test(file) ? () => this.app.openFile(file.startsWith('/') ? file : this.S.project.root + '/' + file) : null },
      icon(e.name === 'Bash' ? 'command' : /Edit|Write/.test(e.name) ? 'edit' : e.name === 'Grep' || e.name === 'WebSearch' ? 'search' : 'file'),
      h('span', {}, TOOL_PT[e.name] || e.name),
      what ? h('code', {}, document.createTextNode(String(what).slice(0, 90))) : null,
    );
  }

  permissionCard(e) {
    const root = this.S.project.root;
    let done = false;
    const card = h('div', { class: 'agent-perm', 'data-req': e.reqId });
    const answer = async (allow) => {
      if (done) return;
      // Unsaved changes in TeXugo would be overwritten: save them first, so
      // Claude's edit lands on what the user sees.
      if (allow && e.path) {
        const tab = this.S.tabs.find((x) => x.path === e.path);
        if (tab && tab.dirty && !(await this.app.saveTab(tab, { quiet: true }))) return toast('Não deu para salvar o arquivo antes da edição.', 'error');
      }
      done = true;
      const note = allow ? null : noteBox.value.trim() || null;
      await call('agentAnswer', { root, reqId: e.reqId, allow, note }).catch((err) => toast(err.message, 'error'));
      card.classList.add(allow ? 'allowed' : 'denied');
      clear(btns, h('span', { class: 'muted' }, allow ? 'Aceito.' : 'Recusado.'));
    };
    const noteBox = h('input', { class: 'agent-note', placeholder: 'Se recusar: o que prefere? (opcional)' });
    const btns = h(
      'div',
      { class: 'agent-perm-actions' },
      noteBox,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn sm', onclick: () => answer(false) }, 'Recusar'),
      h('button', { class: 'btn sm primary', onclick: () => answer(true) }, icon('check'), e.path ? 'Aceitar' : 'Permitir'),
    );
    let body;
    if (e.path) {
      body = [h('div', { class: 'agent-perm-title' }, icon('edit'), ` ${e.isNew ? 'Criar' : 'Editar'} `, h('b', {}, relPath(root, e.path))), fileDiff(e.oldText || '', e.newText || '')];
    } else if (e.tool === 'Bash') {
      body = [h('div', { class: 'agent-perm-title' }, icon('command'), ' Rodar um comando', e.description ? h('span', { class: 'muted' }, ` (${e.description})`) : null), h('pre', { class: 'agent-cmd' }, document.createTextNode(e.command || ''))];
    } else {
      body = [h('div', { class: 'agent-perm-title' }, icon('info'), ` Usar ${e.tool}`), h('pre', { class: 'agent-cmd' }, document.createTextNode(JSON.stringify(e.input, null, 1).slice(0, 800)))];
    }
    clear(card, body, btns);
    return card;
  }

  focus() {
    setTimeout(() => this.input.focus(), 0);
  }
}
