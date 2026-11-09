// Client for the local server: JSON calls and the event WebSocket.
const params = new URLSearchParams(location.search);
export const TOKEN = params.get('t') || sessionStorage.getItem('texugo-token') || '';
if (TOKEN) sessionStorage.setItem('texugo-token', TOKEN);

export async function call(method, args = {}) {
  const r = await fetch('/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-texugo-token': TOKEN },
    body: JSON.stringify(args),
  });
  let body;
  try {
    body = await r.json();
  } catch {
    throw new Error(`Erro ${r.status} em ${method}`);
  }
  if (!body.ok) throw new Error(body.error || `Erro em ${method}`);
  return body.data;
}

export function fileUrl(p) {
  return `/file?t=${encodeURIComponent(TOKEN)}&p=${encodeURIComponent(p)}&v=${Date.now()}`;
}

const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
export function emit(type, payload) {
  for (const fn of listeners.get(type) || []) fn(payload);
  for (const fn of listeners.get('*') || []) fn({ type, ...payload });
}

let ws;
let wsOk = false;
export function connect(extra = '') {
  const url = `ws://${location.host}/ws?t=${encodeURIComponent(TOKEN)}${extra}`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    wsOk = true;
    emit('ws:open', {});
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    emit(msg.type, msg);
  };
  ws.onclose = () => {
    if (wsOk) emit('ws:close', {});
    wsOk = false;
    setTimeout(() => connect(extra), 1200);
  };
}

// Electron bridge (preload). Absent when running in a plain browser.
export const native = window.texugo || null;
