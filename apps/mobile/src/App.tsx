import { useEffect, useState } from 'react';
import { navigate, useRoute } from './router';
import { Inbox } from './screens/Inbox';
import { Pairing } from './screens/Pairing';
import { RequestDetail } from './screens/RequestDetail';
import { useMobile, mobileStore } from './state/store';

export function App({ onPaired, onReconnect = () => {} }: { onPaired?: () => void; onReconnect?: () => void }) {
  const { link } = useMobile();
  const route = useRoute();
  // Once pairing has started it stays up through its last step, even after the token is stored and the link moves on.
  const [pairing, setPairing] = useState(false);
  useEffect(() => { if (link === 'unpaired') setPairing(true); }, [link]);
  if (pairing || link === 'unpaired' || route.name === 'pair') {
    return <Pairing onContinue={() => { setPairing(false); navigate({ name: 'inbox' }); mobileStore.setLink('connecting'); onPaired?.(); }} />;
  }
  return (
    <div className="app">
      {route.name === 'request'
        ? <RequestDetail sessionId={route.sessionId} pendingId={route.pendingId} onReconnect={onReconnect} />
        : <Inbox onReconnect={onReconnect} />}
    </div>
  );
}
