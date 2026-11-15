// Agent panel: a chat with the user's own agent (Claude Code, Codex, Gemini
// CLI or OpenCode) about the project, in the sidebar. The agent reads and
// searches freely; by default every edit, new file or command arrives here
// as a card to approve (edits as a diff) before it happens, and Claude Code
// and Codex offer permission modes that ask less (AGENT_MODES). Messages
// carry the active file, the selection and the build errors, so "fix this"
// and "fix the build" work without copying anything.
import { Marked } from 'marked';
import { call, on, native } from './api.js';
import { h, clear, icon, toast, basename, relPath, joinPath, modal, confirmBox } from './dom.js';
import { fileDiff } from './ide.js';
import { tr } from './i18n.js';

// Claude's models: the list lives in server/agents/claude.js and arrives
// with `hello` (setClaudeModels); this is only the fallback before it does.
export const CLAUDE_MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }];
export function setClaudeModels(list) {
  if (Array.isArray(list) && list.length) CLAUDE_MODELS.splice(0, CLAUDE_MODELS.length, ...list);
}
export const CLAUDE_EFFORTS = [
  { id: 'low', label: 'Baixo' },
  { id: 'medium', label: 'Médio' },
  { id: 'high', label: 'Alto' },
  { id: 'xhigh', label: 'Extra' },
  { id: 'max', label: 'Máximo' },
];

// Permission modes of the panel (server/agents/modes.js), for the agents
// that offer them; each agent maps them to its own setting.
export const AGENT_MODES = [
  { id: 'ask', label: 'Perguntar antes', hint: 'Pede a sua aprovação antes de cada edição, arquivo novo ou comando.' },
  { id: 'edits', label: 'Editar sem perguntar', hint: 'Edita os arquivos do projeto sem perguntar; pede aprovação para o que vai além disso.' },
  { id: 'auto', label: 'Automático', hint: 'O agente julga o que é seguro e só pede aprovação para o que parecer arriscado.' },
  { id: 'full', label: 'Acesso total', hint: 'Nunca pergunta: edita qualquer arquivo do computador, roda qualquer comando e acessa a internet.' },
];

// The agents and what each offers, from the server (agentList). Until it
// answers, only Claude. The other agents' models and efforts are known once
// a conversation with them has opened.
export const AGENTS = [{ id: 'claude', name: 'Claude', product: 'Claude Code', installed: true, panel: true, oneShot: true, models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS, modes: AGENT_MODES.map((m) => m.id) }];
export async function loadAgents() {
  const list = await call('agentList').catch(() => null);
  if (!Array.isArray(list)) return AGENTS;
  const claude = list.find((a) => a.id === 'claude');
  if (claude && Array.isArray(claude.models) && claude.models.length) setClaudeModels(claude.models);
  AGENTS.splice(0, AGENTS.length, ...list.map((a) => (a.id === 'claude' ? { ...a, models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS } : a)));
  return AGENTS;
}
export const agentInfo = (id) => AGENTS.find((a) => a.id === id) || AGENTS.find((a) => a.id === 'claude') || AGENTS[0];
export const modelsOf = (id) => agentInfo(id).models || [];
export const effortsOf = (id) => agentInfo(id).efforts || [];
export const modesOf = (id) => AGENT_MODES.filter((m) => (agentInfo(id).modes || []).includes(m.id));
export const agentName = (S) => agentInfo(agentChoice(S).agent).name;

// What the panel, the agent's terminal and the actions on the text run
// with. Claude: Opus 5.5, medium by default. Another agent: what was picked
// for it, or its own default. The permission mode is the one picked for the
// agent, "ask" by default; only the panel uses it (the actions on the text
// are always read-only). `only` asks for one agent's choice (the Claude Code
// terminal is Claude's whatever the panel shows).
export function agentChoice(S, only) {
  const st = S.settings || {};
  const want = only || st.agent;
  // An agent no longer installed falls back to Claude. One with only the
  // one-shot run (Codex without codex-acp) serves the actions on the text.
  const agent = want && want !== 'claude' && AGENTS.some((a) => a.id === want && (a.panel || a.oneShot)) ? want : 'claude';
  const m = (st.agentModes || {})[agent];
  const mode = modesOf(agent).some((x) => x.id === m) ? m : 'ask';
  if (agent === 'claude')
    return {
      agent,
      model: CLAUDE_MODELS.some((m) => m.id === st.claudeModel) ? st.claudeModel : 'claude-opus-5-5',
      effort: CLAUDE_EFFORTS.some((e) => e.id === st.claudeEffort) ? st.claudeEffort : 'medium',
      mode,
    };
  const pickOf = (list, v) => (v && (!list.length || list.some((x) => x.id === v)) ? v : null);
  return { agent, model: pickOf(modelsOf(agent), (st.agentModels || {})[agent]), effort: pickOf(effortsOf(agent), (st.agentEfforts || {})[agent]), mode };
}

// Where to get the agents that are not installed.
export function installDialog() {
  const missing = AGENTS.filter((a) => !a.installed || !a.panel);
  // An agent already installed (Codex in the ChatGPT app) lacks only its panel program.
  const cmd = (a) => (a.installed && a.panelInstall ? a.panelInstall : a.install);
  modal({
    title: 'Instalar outro agente',
    body: h(
      'div',
      {},
      h('p', { class: 'muted', style: { marginTop: 0 } }, 'Cada agente usa a sua própria conta. Instale pelo terminal e entre na conta uma vez; depois ele aparece no painel.'),
      missing.length
        ? missing.map((a) =>
            h(
              'div',
              { style: { marginBottom: '14px' } },
              h('b', {}, a.product),
              h('pre', { class: 'agent-cmd' }, document.createTextNode(cmd(a))),
              h(
                'div',
                { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
                h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(cmd(a)).then(() => toast('Comando copiado.', 'ok')) }, 'Copiar o comando'),
                a.site ? h('a', { href: a.site, target: '_blank', rel: 'noopener' }, 'Site') : null,
              ),
            ),
          )
        : h('p', {}, 'Todos os agentes que o TeXugo conhece já estão instalados.'),
    ),
  });
}

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
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          this.send();
        }
      },
    });
    this.attachments = [];
    this.attachEl = h('div', { class: 'agent-attachments' });
    this.withSel = h('input', { type: 'checkbox', checked: true });
    this.withErr = h('input', { type: 'checkbox', checked: true });
    // Agent, model and effort; the model and effort lists are the chosen
    // agent's, and the effort menu is gone for an agent without one.
    this.agentSel = h('select', { class: 'agent-pick agent-which', 'aria-label': 'Agente', onchange: () => this.pickAgent(this.agentSel.value) });
    this.picksEl = h('div', { class: 'agent-row agent-picks' });
    // One pinned line per Claude Code mod (jev-model-router says here what it chose).
    this.modStatus = new Map();
    this.modEl = h('div', { class: 'agent-mods' });
    this.sendBtn = h('button', { class: 'btn primary sm', onclick: () => (this.running ? this.stop() : this.send()) });
    this.termBtn = h('button', { class: 'btn sm ghost', onclick: () => app.terminals.open(agentChoice(S).agent === 'claude' ? 'claude' : 'agent') }, icon('command'), 'Terminal');
    this.el = h(
      'div',
      { class: 'agent-panel' },
      h(
        'div',
        { class: 'side-head agent-head' },
        h('span', { class: 'term-kind claude' }, '✻'),
        this.agentSel,
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'icon-btn', title: 'Começa uma conversa nova', 'aria-label': 'Nova conversa', onclick: () => this.reset() }, icon('plus')),
        this.termBtn,
      ),
      this.log,
      this.modEl,
      h(
        'div',
        { class: 'agent-compose' },
        this.attachEl,
        this.picksEl,
        this.input,
        h(
          'div',
          { class: 'agent-row' },
          h('label', { class: 'agent-chip', title: 'Envia junto o trecho selecionado no editor' }, this.withSel, 'seleção'),
          h('label', { class: 'agent-chip', title: 'Envia junto os erros e ?? da última compilação' }, this.withErr, 'erros'),
          h('button', { class: 'icon-btn agent-files-btn', title: 'Anexar arquivos do computador (ou arraste-os para o painel)', 'aria-label': 'Anexar arquivos', onclick: () => this.pickFiles() }, icon('clip')),
          h('span', { style: { flex: 1 } }),
          this.sendBtn,
        ),
      ),
    );
    this.dropZone();
    this.renderAgent();
    this.empty();
    this.setRunning(false);
    on('agent:event', (e) => this.S.project && e.root === this.S.project.root && this.event(e));
    loadAgents().then(() => this.renderAgent());
  }

  get info() {
    return agentInfo(agentChoice(this.S).agent);
  }

  // The picker of agents and the model and effort menus of the chosen one.
  renderAgent() {
    const S = this.S;
    const choice = agentChoice(S);
    const a = this.info;
    clear(
      this.agentSel,
      AGENTS.map((x) => h('option', { value: x.id, selected: x.id === choice.agent, disabled: !x.panel && !x.oneShot }, x.panel ? x.name : x.oneShot ? `${x.name} (sem o painel)` : `${x.name} (não instalado)`)),
      AGENTS.some((x) => !x.panel) ? h('option', { value: '' }, 'Instalar outro agente…') : null,
    );
    const save = () => this.app.saveSettingsSoon && this.app.saveSettingsSoon();
    const select = (list, value, title, set) =>
      h('select', { class: 'agent-pick', title, onchange: (e) => (set(e.target.value), save()) }, list.map((x) => h('option', { value: x.id, selected: x.id === value }, x.label)));
    const claude = choice.agent === 'claude';
    const models = modelsOf(choice.agent);
    const efforts = effortsOf(choice.agent);
    const perAgent = (key) => (v) => (S.settings[key] = { ...(S.settings[key] || {}), [choice.agent]: v || null });
    clear(
      this.picksEl,
      models.length
        ? select(claude ? models : [{ id: '', label: 'Modelo padrão' }, ...models], choice.model || '', `Modelo do ${a.name} (vale para o painel e o terminal do ${a.name})`, claude ? (v) => (S.settings.claudeModel = v) : perAgent('agentModels'))
        : h('span', { class: 'muted agent-pick-none' }, 'Modelo padrão do agente'),
      efforts.length ? select(claude ? efforts : [{ id: '', label: 'Esforço padrão' }, ...efforts], choice.effort || '', `Esforço de raciocínio: quanto o ${a.name} pensa antes de responder`, claude ? (v) => (S.settings.claudeEffort = v) : perAgent('agentEfforts')) : null,
      this.modeSelect(choice, save),
    );
    // Set as properties, so translated here (h() translates only what it builds).
    this.input.placeholder = tr(`Peça ao ${a.name}: corrija o erro de compilação, revise a seleção, explique esta seção…`);
    this.termBtn.title = tr(`Abrir o ${a.product} completo no terminal`);
    this.el.querySelector('.term-kind').style.visibility = claude ? '' : 'hidden';
    if (this.log.querySelector('.agent-hello')) this.empty();
  }

  // The permission mode of the chosen agent. "Acesso total" asks once more,
  // since nothing will be asked after it.
  modeSelect(choice, save) {
    const S = this.S;
    const modes = modesOf(choice.agent);
    if (!modes.length || !this.info.panel) return null;
    const hint = (id) => (modes.find((m) => m.id === id) || modes[0]).hint;
    const sel = h(
      'select',
      {
        class: 'agent-pick agent-mode' + (choice.mode === 'ask' ? '' : ' loose'),
        'aria-label': 'Permissões do agente',
        title: tr('Permissões: ') + tr(hint(choice.mode)),
        onchange: async () => {
          const v = sel.value;
          if (v === 'full' && !(await confirmBox('Acesso total', `O ${this.info.name} vai editar qualquer arquivo do computador, rodar qualquer comando e acessar a internet sem perguntar nada. Use só em projetos seus, que você conhece. Para voltar, escolha "Perguntar antes".`, { ok: 'Dar acesso total', danger: true }))) {
            sel.value = agentChoice(S).mode;
            return;
          }
          S.settings.agentModes = { ...(S.settings.agentModes || {}), [choice.agent]: v };
          save();
          this.renderAgent();
        },
      },
      modes.map((m) => h('option', { value: m.id, selected: m.id === choice.mode }, m.label)),
    );
    return sel;
  }

  pickAgent(id) {
    if (!id) {
      this.agentSel.value = agentChoice(this.S).agent;
      return installDialog();
    }
    this.S.settings.agent = id;
    this.app.saveSettingsSoon && this.app.saveSettingsSoon();
    // Another agent is another conversation.
    if (!this.log.querySelector('.agent-hello')) this.reset();
    this.renderAgent();
    this.app.renderActivity && this.app.renderActivity();
  }

  empty() {
    const a = this.info;
    // An agent installed without its panel program: the actions on the text
    // use it; the conversation here needs one more install.
    if (!a.panel)
      return clear(
        this.log,
        h(
          'div',
          { class: 'agent-hello muted' },
          h('p', {}, `As ações de IA no texto, o parecer e a resposta aos pareceristas já usam o seu ${a.product}. Para conversar com ele aqui no painel, falta um programa que liga o ${a.product} ao TeXugo. Instale pelo terminal:`),
          h('pre', { class: 'agent-cmd' }, document.createTextNode(a.panelInstall || a.install)),
          h('p', {}, 'Depois, abra uma conversa nova (+).'),
        ),
      );
    clear(
      this.log,
      h(
        'div',
        { class: 'agent-hello muted' },
        agentChoice(this.S).mode === 'ask'
          ? h('p', {}, `Converse com o seu ${this.info.product} sobre este projeto. Ele lê e busca os arquivos sozinho; cada edição ou comando aparece aqui para você aceitar antes.`)
          : h('p', {}, `Converse com o seu ${this.info.product} sobre este projeto. No modo "${tr(AGENT_MODES.find((m) => m.id === agentChoice(this.S).mode).label)}", o que ele fizer sem perguntar aparece aqui na conversa; o que precisar da sua aprovação vem num cartão.`),
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
    this.agentSel.disabled = r;
    this.waiting = !!this.log.querySelector('.agent-perm:not(.allowed):not(.denied):not(.closed)');
    this.app.renderActivity && this.app.renderActivity();
  }

  add(node) {
    this.log.querySelector('.agent-hello')?.remove();
    this.log.append(node);
    this.log.scrollTop = this.log.scrollHeight;
    return node;
  }

  // A passage sent here with "Mencionar no Claude".
  attach(x) {
    if (this.attachments.some((y) => y.path === x.path && y.a === x.a && y.b === x.b)) return this.focus();
    this.attachments.push(x);
    this.renderAttachments();
    this.focus();
  }

  // Files from the computer: Claude reads them from where they are (a PDF,
  // an image, a .tex), nothing is copied into the project.
  attachFiles(paths) {
    const fresh = paths.filter((p) => p && !this.attachments.some((y) => y.file && y.path === p));
    if (!fresh.length) return this.focus();
    for (const p of fresh) this.attachments.push({ file: true, path: p });
    this.renderAttachments();
    this.focus();
  }

  async pickFiles() {
    if (!native || !native.pickFiles) return toast('Anexar arquivos só funciona no app.', 'warn');
    this.attachFiles(await native.pickFiles());
  }

  dropZone() {
    const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    let depth = 0;
    this.el.addEventListener('dragenter', (e) => {
      if (!has(e)) return;
      e.preventDefault();
      depth++;
      this.el.classList.add('drop');
    });
    this.el.addEventListener('dragover', (e) => {
      if (!has(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    this.el.addEventListener('dragleave', () => {
      if (--depth <= 0) (depth = 0), this.el.classList.remove('drop');
    });
    this.el.addEventListener('drop', (e) => {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0;
      this.el.classList.remove('drop');
      const paths = [...e.dataTransfer.files].map((f) => (native && native.pathOf ? native.pathOf(f) : '')).filter(Boolean);
      if (!paths.length) return toast('Arraste arquivos do computador; no navegador isso não funciona.', 'warn');
      this.attachFiles(paths);
    });
  }

  renderAttachments() {
    clear(
      this.attachEl,
      this.attachments.map((x, k) =>
        h(
          'span',
          { class: 'agent-attach-chip', title: x.file ? x.path : x.text.slice(0, 300) },
          x.file ? [icon('file'), basename(x.path)] : `${basename(x.path)} ${x.a === x.b ? 'linha ' + x.a : `linhas ${x.a}–${x.b}`}`,
          h('span', { class: 'close', title: 'Tirar', onclick: () => (this.attachments.splice(k, 1), this.renderAttachments()) }, icon('x')),
        ),
      ),
    );
  }

  context() {
    const t = this.app.activeTab();
    const parts = [];
    const files = this.attachments.filter((x) => x.file);
    if (files.length) parts.push('Files the user attached from their computer (read them with the Read tool; they may be outside the project):\n' + files.map((x) => `- ${x.path}`).join('\n'));
    for (const x of this.attachments.filter((y) => !y.file)) parts.push(`Excerpt the user points to: ${x.path}, lines ${x.a}-${x.b}:\n"""\n${x.text.slice(0, 8000)}\n"""`);
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
    if (!this.info.panel) return this.empty();
    // An agent that edits without asking would find the files as they are on
    // disk: what is unsaved in TeXugo is saved first, as a card does before
    // an edit it allows.
    if (agentChoice(this.S).mode !== 'ask' && this.S.tabs.some((t) => t.dirty) && !(await this.app.saveAll())) return toast('Não deu para salvar os arquivos abertos; a mensagem não foi enviada.', 'error');
    this.input.value = '';
    const t = this.app.activeTab();
    const sel = t && !t.binary && !this.app.view.state.selection.main.empty && this.withSel.checked;
    const ctx = this.context();
    const att = this.attachments.map((x) => `${basename(x.path)} ${x.a}–${x.b}`);
    if (sel) att.push(`seleção de ${basename(t.path)}`);
    this.attachments = [];
    this.renderAttachments();
    this.add(h('div', { class: 'agent-msg user' }, document.createTextNode(text), att.length ? h('div', { class: 'agent-attach' }, '+ ' + att.join(', ')) : null));
    this.setRunning(true);
    this.thinking = this.add(h('div', { class: 'agent-thinking muted' }, h('span', { class: 'status-dot building' }), ` ${this.info.name} está trabalhando…`));
    try {
      await call('agentSend', { root: this.S.project.root, text: ctx + text, ...agentChoice(this.S) });
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
    if (e.kind === 'init') {
      // An ACP agent says which models and efforts it offers.
      const a = AGENTS.find((x) => x.id === e.agent);
      if (a && e.agent !== 'claude' && Array.isArray(e.models)) {
        a.models = e.models;
        a.efforts = e.efforts || [];
        this.renderAgent();
      }
      return;
    }
    if (e.kind === 'mod-status') {
      if (e.text) this.modStatus.set(e.plugin, e.text);
      else this.modStatus.delete(e.plugin);
      clear(this.modEl, [...this.modStatus].map(([p, t]) => h('div', { class: 'agent-mod', title: p }, t)));
      return;
    }
    // Keep the "working" line at the bottom while Claude goes on.
    const keep = this.thinking && this.thinking.isConnected;
    if (keep) this.thinking.remove();
    if (e.kind === 'text') this.add(h('div', { class: 'agent-msg claude' }, md(e.text)));
    else if (e.kind === 'tool') {
      // Claude Code's edits and commands come as cards when it asks; in a
      // mode that does not ask, the line is what the user sees of them.
      if (!['Edit', 'MultiEdit', 'Write', 'Bash'].includes(e.name) || agentChoice(this.S).mode !== 'ask') this.tools.set(e.id, this.add(this.toolLine(e)));
    }
    else if (e.kind === 'tool-result') {
      const el = this.tools.get(e.id);
      if (el && e.error) el.classList.add('failed'), el.setAttribute('title', e.text);
    } else if (e.kind === 'permission') this.add(this.permissionCard(e));
    else if (e.kind === 'mod-log') this.add(h('div', { class: 'agent-modlog', title: e.plugin }, e.text.replace(/^\[[\w@.-]+\]\s*/, '')));
    else if (e.kind === 'permission-closed') this.log.querySelector(`[data-req="${e.reqId}"]`)?.classList.add('closed');
    else if (e.kind === 'result') {
      if (!e.ok && e.text && !this.log.lastElementChild?.textContent.includes(e.text)) this.add(h('div', { class: 'agent-error' }, e.text));
    } else if (e.kind === 'error') this.add(h('div', { class: 'agent-error' }, e.text));
    if (keep && this.running) this.add(this.thinking);
  }

  toolLine(e) {
    const inp = e.input || {};
    const file = inp.file_path || inp.path || inp.notebook_path;
    // A file outside the project shows its name; the whole path is the title.
    const rel = file ? relPath(this.S.project.root, file) : '';
    const what = file ? (rel === file ? basename(file) : rel) : inp.pattern || inp.command || inp.skill || inp.url || inp.query || inp.description || '';
    return h(
      'div',
      { class: 'agent-tool', onclick: file && /\.\w+$/.test(file) ? () => this.app.openFile(joinPath(this.S.project.root, file)) : null },
      icon(e.icon || (e.name === 'Bash' ? 'command' : /Edit|Write/.test(e.name) ? 'edit' : e.name === 'Grep' || e.name === 'WebSearch' ? 'search' : 'file')),
      h('span', {}, e.label || TOOL_PT[e.name] || e.name),
      what ? h('code', { title: String(file || what) }, document.createTextNode(String(what).slice(0, 90))) : null,
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
      e.noteable === false ? null : noteBox,
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
      body = [h('div', { class: 'agent-perm-title' }, icon('info'), ` Usar ${e.tool}`), h('pre', { class: 'agent-cmd' }, document.createTextNode(JSON.stringify(e.input, null, 1)))];
    }
    clear(card, body, btns);
    return card;
  }

  focus() {
    setTimeout(() => this.input.focus(), 0);
  }
}
