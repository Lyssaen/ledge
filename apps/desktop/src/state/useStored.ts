import { useCallback, useEffect, useRef, useState } from 'react';

/** A value loaded once from storage and saved on each change (not on mount: a corrupt key is only rewritten once used). */
export function useStored<T>(load: () => T, save: (v: T) => void): [T, (fn: (v: T) => T) => void] {
  const [value, setValue] = useState(load);
  const mounted = useRef(false);
  useEffect(() => { if (!mounted.current) { mounted.current = true; return; } save(value); }, [value, save]);
  const update = useCallback((fn: (v: T) => T) => setValue(fn), []);
  return [value, update];
}
