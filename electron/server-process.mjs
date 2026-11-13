// The local server in its own process (Electron utilityProcess), so a slow
// scan of a big project, its synchronous file reads included, never freezes
// menus and windows (PRE-LAUNCH-AUDIT.md D8). What only the main process can
// do (Trash, Finder, the default browser) goes back to it as a message.
//
// Messages from main: { type: 'start', port, token }, { type: 'idle' },
// { type: 'close' }, { type: 'hook:reply', id, error }.
// Messages to main: { type: 'ready', url, port, token }, { type: 'hook', id,
// name, arg }, { type: 'closed' }.
const parent = process.parentPort;
const { createServer } = await import('../server/index.js');

let server = null;
let seq = 0;
const waiting = new Map();
const hook = (name) => (arg) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    parent.postMessage({ type: 'hook', id, name, arg });
  });

parent.on('message', async ({ data: m }) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'start' && !server) {
    server = await createServer({
      port: m.port || 0,
      token: m.token || undefined,
      hooks: { trash: hook('trash'), reveal: hook('reveal'), openPath: hook('openPath'), openUrl: hook('openUrl') },
    });
    parent.postMessage({ type: 'ready', url: server.url, port: server.port, token: server.token });
  } else if (m.type === 'hook:reply') {
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    if (w) m.error ? w.reject(new Error(m.error)) : w.resolve();
  } else if (m.type === 'idle') {
    server?.idle();
  } else if (m.type === 'close') {
    // Stops terminals, agents, builds and the grammar server this process
    // started, so none outlives the app.
    try {
      server?.close();
    } catch {}
    parent.postMessage({ type: 'closed' });
    setTimeout(() => process.exit(0), 50);
  }
});
