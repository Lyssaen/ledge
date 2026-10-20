import { useEffect, useState } from 'react';

/** Re-render each 15 s so ages stay honest without a new message. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  return now;
}
