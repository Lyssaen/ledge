import { useEffect, useState } from 'react';

/** `value` held true for `ms` ms: the discreet strip comes back 500 ms after the island folds, never at once. */
export function useDelayed(value: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!value) { setOn(false); return; }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value && on;
}
