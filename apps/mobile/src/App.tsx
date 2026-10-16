import { useEffect, useState } from 'react';
import { navigate, useRoute } from './router';
import { Agents } from './screens/Agents';
import { Connection } from './screens/Connection';
import { Inbox } from './screens/Inbox';
import { Pairing } from './screens/Pairing';
import { Terminal } from './screens/Terminal';
import { Thread } from './screens/Thread';
import { RequestDetail } from './screens/RequestDetail';
import { hashOf } from './push/handlers';
import { hasToken } from './state/persist';
import { useMobile, mobileStore } from './state/store';

export function App({ onPaired, onReconnect = () => {} }: { onPaired?: () => void; onReconnect?: () => void }) {
  const { link } = useMobile();
  const route = useRoute();
  // Once pairing has started it stays up through its last step, even after the token is stored and the link moves on.
  const [pairing, setPairing] = useState(false);
  // A paired phone reaches the pairing flow only through the confirmation on the Connexion panel.
  const [repairing, setRepairing] = useState(false);
  useEffect(() => { if (link === 'unpaired') setPairing(true); }, [link]);
  // A tap on a notification while the app is open: the service worker sends the link, the router does the rest.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown; url?: unknown } | null;
      const hash = d?.type === 'open' ? hashOf(d.url) : null;
      if (hash) globalThis.location.hash = hash;
    };
    sw.addEventListener('message', onMessage);
    return () => sw.removeEventListener('message', onMessage);
  }, []);
  if (pairing || link === 'unpaired' || (route.name === 'pair' && (repairing || !hasToken()))) {
    return <Pairing onCancel={repairing ? () => { setRepairing(false); navigate({ name: 'connection' }); } : undefined} onSaved={() => { mobileStore.setLink('connecting'); onPaired?.(); }} onContinue={() => { setPairing(false); setRepairing(false); navigate({ name: 'inbox' }); }} />;
  }
  return (
    <div className="app">
      {route.name === 'connection' || route.name === 'pair'
        ? <Connection onRepair={() => { setRepairing(true); navigate({ name: 'pair' }); }} />
        : route.name === 'request'
        ? <RequestDetail key={`${route.sessionId}/${route.pendingId}`} sessionId={route.sessionId} pendingId={route.pendingId} onReconnect={onReconnect} />
        : route.name === 'thread'
        ? <Thread key={route.sessionId} sessionId={route.sessionId} onReconnect={onReconnect} />
        : route.name === 'terminal'
        ? <Terminal key={route.sessionId} sessionId={route.sessionId} />
        : route.name === 'agents'
        ? <Agents onReconnect={onReconnect} />
        : <Inbox onReconnect={onReconnect} />}
    </div>
  );
}
