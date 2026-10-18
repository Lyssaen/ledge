import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

/** Test hook: every `notify` call is pushed here (a notice replaces the previous one on screen, so the DOM cannot count them). */
let history: string[] | null = null;
export function recordToastsForTests(): string[] { return (history = []); }

/** A button on the toast (« Annuler »): `run` does it, `ms` is how long the toast, and so the button, lives (the hook's default otherwise). */
export interface ToastAction { label: string; run(): void; ms?: number }
interface Shown { text: string; action?: ToastAction }

/** One notice at a time (observatory.tsx's `notice`): it stays `ms` (6 s by default, like the mockup; an action sets its own), and a new one
 *  replaces it and restarts the clock. `undo()` runs the visible toast's action, once, and says whether there was one. */
export function useToast(ms = 6000): { notice: string | null; action: ToastAction | null; notify(text: string, action?: ToastAction): void; undo(): boolean } {
  // An object per notice, so the same text said twice still restarts the clock.
  const [toast, setToast] = useState<Shown | null>(null);
  const current = useRef<Shown | null>(null);
  const show = (next: Shown | null) => { current.current = next; setToast(next); };
  const notify = useCallback((text: string, action?: ToastAction) => { history?.push(text); show({ text, action }); }, []);
  const undo = useCallback(() => {
    const action = current.current?.action;
    if (!action) return false;
    show(null);
    action.run();
    return true;
  }, []);
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => show(null), toast.action?.ms ?? ms);
    return () => clearTimeout(timer);
  }, [toast, ms]);
  return { notice: toast?.text ?? null, action: toast?.action ?? null, notify, undo };
}

const keys = new WeakMap<ToastAction, number>();
let seq = 0;
const keyOf = (a: ToastAction): number => keys.get(a) ?? (keys.set(a, ++seq), seq);

/** The mockup's toast (observatory.css `.toast`; manage.css `.undo-toast` with an action), at the bottom of the window. The live region is always mounted, empty
 *  without a notice: a region that mounts already holding its text may not be announced. The thin bar runs down the action's lifetime. */
export function Toast({ notice, action, onAction }: { notice: string | null; action?: ToastAction | null; onAction?: () => void }): JSX.Element {
  return (
    <div className="toast-region" role="status">
      {notice !== null && (
        action
          // Keyed by the action object (one per notify): a new notice remounts the bar, so its clock restarts.
          ? <div className="toast undo-toast" key={keyOf(action)}><span>{notice}</span><button type="button" aria-keyshortcuts="Control+Z" onClick={onAction}>{action.label} <kbd>Ctrl Z</kbd></button><i style={{ animationDuration: `${(action.ms ?? 6000) / 1000}s` }} /></div>
          : <div className="toast">{notice}</div>
      )}
    </div>
  );
}
