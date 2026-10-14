import { useEffect, useState } from 'react';
import { navigate, useRoute } from './router';
import { Connection } from './screens/Connection';
import { Inbox } from './screens/Inbox';
import { Pairing } from './screens/Pairing';
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
        ? <RequestDetail sessionId={route.sessionId} pendingId={route.pendingId} onReconnect={onReconnect} />
        : <Inbox onReconnect={onReconnect} />}
    </div>
  );
}
