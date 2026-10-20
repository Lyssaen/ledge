import { useEffect, useState } from 'react';

/** A button busy for a moment after a tap (4 s by default), so a second tap waits for the first one's effect. */
export function useBusy(ms = 4000): [boolean, (busy: boolean) => void] {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), ms);
    return () => clearTimeout(t);
  }, [busy, ms]);
  return [busy, setBusy];
}
