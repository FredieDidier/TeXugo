// The AI agents TeXugo can drive, behind one interface. Each agent is an
// object with:
//
//   id, name, product, install, site, login
//   modes                   -> the permission modes it offers (./modes.js), or none
//   detect()                -> { installed, panel, oneShot, version, models?, efforts? }
//   Session                 -> class (root, opts, emit): one conversation of
//                              the panel, with start(), send(text, opts),
//                              answer(reqId, allow, note), interrupt(),
//                              close(), matches(opts), resumeId, running
//   oneShot(prompt, opts)   -> text, always read-only (the actions on the
//                              text, the referee review, the response to
//                              referees)
//
// A session reports what happens with emit({ kind, ... }), kind one of:
// init, text, tool, tool-result, permission, permission-closed, result,
// error, status, mod-log, mod-status. The panel draws the same events for
// every agent. Claude Code speaks its own stream-json (./claude.js); the
// others speak ACP (./acp.js, ./others.js).
import { claude } from './claude.js';
import { codex, gemini, opencode } from './others.js';
import { cancelOneShot } from './proc.js';

export const AGENTS = [claude, codex, gemini, opencode];
export const agentById = (id) => AGENTS.find((a) => a.id === id) || claude;

// What the page shows in the agent picker. Models and efforts of the ACP
// agents are known only after a conversation opens; the last ones seen are
// kept in `catalog` (saved with the app state).
export async function listAgents(catalog = {}) {
  return Promise.all(
    AGENTS.map(async (a) => {
      const d = await a.detect();
      const seen = catalog[a.id] || {};
      return { id: a.id, name: a.name, product: a.product, install: a.install, panelInstall: a.panelInstall, site: a.site, ...d, models: d.models || seen.models || [], efforts: d.efforts || seen.efforts || [], modes: a.modes || [] };
    }),
  );
}

export function oneShot(prompt, opts = {}) {
  return agentById(opts.agent).oneShot(prompt, opts);
}

export const cancelAi = cancelOneShot;

export class Agents {
  // agents: the list to choose from (the tests pass a stand-in).
  constructor(broadcast, { catalog = {}, saveCatalog = () => {}, agents = AGENTS } = {}) {
    this.broadcast = broadcast;
    this.agents = agents;
    this.catalog = catalog;
    this.saveCatalog = saveCatalog;
    this.sessions = new Map(); // root -> session
  }

  emit(root, agent, ev) {
    // Models and efforts an ACP agent offers, remembered for the picker.
    if (ev.kind === 'init' && Array.isArray(ev.models) && agent !== 'claude') {
      const prev = JSON.stringify(this.catalog[agent] || null);
      this.catalog[agent] = { models: ev.models, efforts: ev.efforts || [] };
      if (JSON.stringify(this.catalog[agent]) !== prev) this.saveCatalog();
    }
    this.broadcast({ type: 'agent:event', root, agent, ...ev });
  }

  agent(id) {
    return this.agents.find((a) => a.id === id) || this.agents[0];
  }

  async start(root, opts) {
    const agent = this.agent(opts.agent);
    const s = new agent.Session(root, opts, (ev) => this.emit(root, agent.id, ev));
    s.agentId = agent.id;
    this.sessions.set(root, s);
    s.onClose = () => this.sessions.get(root) === s && this.sessions.delete(root);
    try {
      await s.start();
    } catch (err) {
      if (this.sessions.get(root) === s) this.sessions.delete(root);
      throw err;
    }
    return s;
  }

  async send(root, text, opts = {}) {
    const id = this.agent(opts.agent).id;
    let s = this.sessions.get(root);
    // Another agent: a new conversation. Claude with a different model or
    // effort: a new process that resumes the conversation.
    if (s && s.agentId !== id) {
      this.reset(root);
      s = null;
    } else if (s && !s.matches(opts)) {
      const resume = s.resumeId;
      this.reset(root);
      s = null;
      opts = { ...opts, resume };
    }
    if (!s) s = await this.start(root, { ...opts, agent: id });
    return s.send(text, opts);
  }

  answer(root, reqId, allow, note) {
    const s = this.sessions.get(root);
    return s ? s.answer(reqId, allow, note) : false;
  }

  interrupt(root) {
    const s = this.sessions.get(root);
    return s ? s.interrupt() : false;
  }

  reset(root) {
    const s = this.sessions.get(root);
    if (s) {
      this.sessions.delete(root);
      s.close();
    }
    return true;
  }

  killAll() {
    for (const root of [...this.sessions.keys()]) this.reset(root);
  }
}
