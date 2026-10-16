import { createDaemonClient, type DaemonClient, type WsCtor } from '@ledge/client';
import { MOBILE_WS_PATH, REMOTE_CLOSE } from '@ledge/protocol';
import { DEVICE_KEY, TOKEN_KEY } from '../state/persist';
import type { MobileStore } from '../state/store';

export function connectRemote(o: { store: MobileStore; url?: string; storage?: Storage; WebSocketImpl?: WsCtor; doc?: Document }): DaemonClient {
  const storage = o.storage ?? globalThis.localStorage;
  const doc = o.doc ?? document;
  const read = () => { try { return storage.getItem(TOKEN_KEY); } catch { return null; } };
  const url = o.url ?? `wss://${globalThis.location.host}${MOBILE_WS_PATH}`;
  const unpair = () => {
    try { storage.removeItem(TOKEN_KEY); storage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
    o.store.reset();
  };
  const client = createDaemonClient({
    url, WebSocketImpl: o.WebSocketImpl,
    hello: () => { const token = read(); return token ? { type: 'auth', token } : null; },
    stopOn: [REMOTE_CLOSE.unauthenticated, REMOTE_CLOSE.revoked],
    onClose: code => { if (code === REMOTE_CLOSE.unauthenticated || code === REMOTE_CLOSE.revoked) unpair(); }
  });
  o.store.setSender(m => client.send(m));
  client.onMessage(m => o.store.apply(m));
  client.onStatus(s => { if (s === 'unreachable' && read()) o.store.setLink('offline'); });

  const connect = () => {
    if (!read()) { o.store.setLink('unpaired'); return; }
    o.store.setLink('connecting');
    client.connect();
  };
  const onVisible = () => { if (doc.visibilityState === 'visible') { o.store.dispatch({ type: 'resumed' }); connect(); } };
  doc.addEventListener('visibilitychange', onVisible);

  connect();
  return { ...client, close: () => { doc.removeEventListener('visibilitychange', onVisible); client.close(); } };
}
