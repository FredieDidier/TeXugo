// "Verificar instalação" (PRE-LAUNCH-AUDIT.md item 5): one calm screen with
// four lines (TeX, Git, an AI agent, the grammar checker), each with a status
// dot, one sentence and at most one button. Shown on the first run and from
// Ajuda → Verificar instalação. Never runs an installer or sudo by itself:
// every action is a click, and "Continuar" is always there.
import { call } from './api.js';
import { h, clear, icon, modal, toast } from './dom.js';

const link = (url, text) => h('a', { href: '#', onclick: (e) => (e.preventDefault(), call('openUrl', { url })) }, text || url.replace(/^https:\/\//, '').replace(/\/$/, ''));
const code = (text) => h('code', { class: 'setup-code' }, text);

// Is something essential missing? Decides whether an existing profile sees
// the screen once on its own.
export const setupIncomplete = (st) => !st.tex.ok || !st.git.ok || !st.git.name || !st.git.email;

export async function setupDialog(app, S, { first = false } = {}) {
  const list = h('div', { class: 'setup-list', 'aria-live': 'polite' });
  const again = h('button', { class: 'btn', onclick: () => refresh(true) }, icon('refresh'), 'Verificar de novo');
  const m = modal({
    title: first ? 'Bem-vindo ao TeXugo' : 'Verificar instalação',
    wide: true,
    body: [
      h('p', { class: 'muted setup-lead' }, first ? 'Antes de começar, o que o TeXugo encontrou neste computador. Só o TeX é indispensável; o resto dá para resolver depois, em Ajuda → Verificar instalação.' : 'O que o TeXugo encontrou neste computador.'),
      list,
    ],
    footer: [again, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Continuar')],
    onClose: () => {
      if (!S.settings.onboarded) {
        S.settings.onboarded = true;
        call('saveSettings', { settings: { onboarded: true } }).catch(() => {});
      }
    },
  });

  async function refresh(clicked) {
    again.disabled = true;
    let st;
    try {
      st = await call('setupStatus');
    } catch (err) {
      clear(list, h('p', { class: 'muted' }, String(err.message || err)));
      again.disabled = false;
      return;
    }
    again.disabled = false;
    // The start screen's "TeX missing" notice reads hello(): bring it along.
    try {
      const now = await call('hello', { refresh: true });
      S.hello.tools = now.tools;
      S.hello.tex = now.tex;
    } catch {}
    clear(list, texRow(st), gitRow(st, () => refresh()), agentRow(st), grammarRow(st, () => refresh()));
    if (clicked) toast(setupIncomplete(st) ? 'Verificado. Ainda falta algo indispensável.' : 'Verificado. Tudo o que é indispensável está pronto.', setupIncomplete(st) ? 'warn' : 'ok', 3000);
    return st;
  }

  const st = await refresh();
  return { close: m.close, status: st };
}

// state: 'ok' | 'missing' | 'optional'
function row(state, title, text, action, extra) {
  const label = { ok: 'pronto', missing: 'falta', optional: 'opcional, não instalado' }[state];
  return h(
    'div',
    { class: 'setup-row ' + state, 'data-state': state },
    h('span', { class: 'setup-dot', role: 'img', 'aria-label': label, title: label }),
    h('div', { class: 'setup-text' }, h('div', { class: 'setup-title' }, title), h('div', { class: 'setup-desc' }, ...[].concat(text)), extra || null),
    h('div', { class: 'setup-act' }, action || null),
  );
}

function texRow(st) {
  const t = st.tex;
  if (t.ok) {
    const year = ((t.version || '').match(/TeX Live (\d{4})/) || [])[1];
    const what = /MiKTeX/i.test(t.version || '') ? 'MiKTeX' : year ? `TeX Live ${year}` : 'TeX';
    return row('ok', 'TeX', `${what} com latexmk. Os documentos compilam.`);
  }
  if (t.perl) return row('missing', 'TeX', t.perl, h('button', { class: 'btn sm', onclick: () => call('openUrl', { url: 'https://strawberryperl.com' }) }, icon('external'), 'Baixar o Perl'));
  const what = !t.engine ? 'O TeX não foi encontrado.' : 'Falta o latexmk, que o TeXugo usa para compilar.';
  return row('missing', 'TeX', [what, ' ', t.hint, ' Depois de instalar, clique em Verificar de novo; não precisa reabrir o app.'], h('button', { class: 'btn sm primary', onclick: () => call('openUrl', { url: t.url }) }, icon('external'), 'Baixar o TeX'));
}

function gitRow(st, done) {
  const g = st.git;
  if (!g.ok) {
    const url = st.platform === 'win32' ? 'https://git-scm.com/download/win' : st.platform === 'darwin' ? 'https://git-scm.com/download/mac' : 'https://git-scm.com/download/linux';
    const how = st.platform === 'darwin' ? ['No Mac, rode ', code('xcode-select --install'), ' no Terminal ou instale o GitHub Desktop.'] : ['Instale pelo site do Git: ', link(url), '.'];
    return row('missing', 'Git', ['O Git não foi encontrado. Ele guarda as versões e sincroniza com os coautores. ', ...how], null);
  }
  if (g.name && g.email) return row('ok', 'Git', ['Commits e comentários saem como ', h('b', {}, g.name), ` <${g.email}>.`]);
  // Without an identity, commits fail and comments fall back to the
  // system user name: ask for it here.
  const name = h('input', { type: 'text', value: g.name || '', placeholder: 'Nome', 'aria-label': 'Nome para o Git', autocomplete: 'name' });
  const email = h('input', { type: 'email', value: g.email || '', placeholder: 'E-mail', 'aria-label': 'E-mail para o Git', autocomplete: 'email' });
  const save = h('button', {
    class: 'btn sm primary',
    onclick: async () => {
      save.disabled = true;
      try {
        await call('setGitIdentity', { name: name.value, email: email.value });
        toast('Identidade do Git gravada.', 'ok', 2500);
        done();
      } catch (err) {
        toast(String(err.message || err), 'error');
        save.disabled = false;
      }
    },
  }, 'Gravar');
  return row('missing', 'Git', 'O Git está instalado, mas não sabe quem você é: sem isso o commit falha. Grava em git config --global, vale para todos os projetos.', save, h('div', { class: 'setup-fields' }, name, email));
}

function agentRow(st) {
  if (st.agent.ok) return row('ok', 'Agente de IA (opcional)', 'Claude Code instalado: o painel do Claude e as ações de IA funcionam.');
  const cmd = st.platform === 'win32' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
  return row('optional', 'Agente de IA (opcional)', ['O Claude Code não foi encontrado. Para usar o painel do Claude, rode no terminal ', code(cmd), ' e entre na sua conta com ', code('claude'), '.'], h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(cmd).then(() => toast('Comando copiado.', 'ok', 2000)) }, icon('clipboard'), 'Copiar comando'));
}

function grammarRow(st, done) {
  const g = st.grammar || {};
  if (g.installed) return row('ok', 'Corretor (opcional)', 'LanguageTool instalado: o corretor de gramática roda neste computador.');
  if (st.platform === 'darwin' && g.brew) {
    const b = h('button', {
      class: 'btn sm',
      onclick: async () => {
        b.disabled = true;
        b.textContent = 'Instalando…';
        try {
          await call('grammarInstall');
          done();
        } catch (err) {
          toast(String(err.message || err), 'error');
          b.disabled = false;
          b.textContent = 'Instalar';
        }
      },
    }, 'Instalar');
    return row('optional', 'Corretor (opcional)', 'O LanguageTool não está instalado. Instalar usa o Homebrew (brew install languagetool) e leva alguns minutos.', b);
  }
  return row('optional', 'Corretor (opcional)', ['O LanguageTool não está instalado. Instale o Java e o LanguageTool (', link('https://languagetool.org/download/'), '), ou escolha o servidor online em Preferências: aí o texto sai do computador.'], null);
}
