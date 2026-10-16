import { useCallback, useEffect, useState, type JSX } from 'react';

/** One notice at a time (observatory.tsx's `notice`): it stays `ms` (6 s by default, like the mockup), and a new one
 *  replaces it and restarts the clock. */
export function useToast(ms = 6000): { notice: string | null; notify(text: string): void } {
  // An object per notice, so the same text said twice still restarts the clock.
  const [toast, setToast] = useState<{ text: string } | null>(null);
  const notify = useCallback((text: string) => setToast({ text }), []);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(timer);
  }, [toast, ms]);
  return { notice: toast?.text ?? null, notify };
}

/** The mockup's toast (observatory.css `.toast`), at the bottom of the window. */
export function Toast({ notice }: { notice: string | null }): JSX.Element | null {
  return notice === null ? null : <div className="toast" role="status">{notice}</div>;
}
