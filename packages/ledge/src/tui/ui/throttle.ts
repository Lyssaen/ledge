import { useEffect, useRef, useState } from 'react';

/** `value`, at most once each `ms`: the latest one at the end of the wait. `null` goes through at once. */
export function useThrottled<T>(value: T | null, ms: number): T | null {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const show = () => { last.current = Date.now(); setShown(value); };
    const wait = last.current + ms - Date.now();
    if (value === null || wait <= 0) { show(); return; }
    const timer = setTimeout(show, wait);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
