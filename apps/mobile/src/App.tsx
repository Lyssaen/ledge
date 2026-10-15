import { useEffect, useState } from 'react';
import { navigate, useRoute } from './router';
import { Agents } from './screens/Agents';
import { Connection } from './screens/Connection';
import { Inbox } from './screens/Inbox';
import { Pairing } from './screens/Pairing';
import { Terminal } from './screens/Terminal';
import { Thread } from './screens/Thread';
import { RequestDetail } from './screens/RequestDetail';
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
  if (pairing || link === 'unpaired' || (route.name === 'pair' && (repairing || !hasToken()))) {
    return <Pairing onCancel={repairing ? () => { setRepairing(false); navigate({ name: 'connection' }); } : undefined} onContinue={() => { setPairing(false); setRepairing(false); navigate({ name: 'inbox' }); mobileStore.setLink('connecting'); onPaired?.(); }} />;
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
