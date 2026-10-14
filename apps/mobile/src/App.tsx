import { useState } from 'react';
import { copy } from './copy';
import { Pairing } from './screens/Pairing';
import { useMobile, mobileStore } from './state/store';

export function App({ onPaired }: { onPaired?: () => void }) {
  const { link } = useMobile();
  // Once pairing has started it stays up through its last step, even after the token is stored and the link moves on.
  const [pairing, setPairing] = useState(false);
  if (link === 'unpaired' && !pairing) setPairing(true);
  if (pairing) {
    return <Pairing onContinue={() => { setPairing(false); mobileStore.setLink('connecting'); onPaired?.(); }} />;
  }
  return (
    <main className="app">
      <header className="px-side pt-4 pb-[18px]">
        <h1 className="text-[29px] leading-[1.15] font-semibold tracking-[-1px]">{copy.shellTitle}</h1>
        <p className="mt-2 text-[13px] text-muted">{copy.shellSubtitle}</p>
      </header>
    </main>
  );
}
