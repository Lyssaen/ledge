import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What a modal owes the keyboard and the screen reader: the focus goes into it as it opens (on the box itself, so its
 * title is read first), Tab turns inside it, Escape closes it, and the focus comes back where it was when it closes.
 */
export function useDialog(box: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [box]);
}

/** A sheet risen from the bottom over a dimmed screen, the phone's one form of modal; Escape and a tap on the dim close it. */
export function Sheet({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  useDialog(box, onClose);
  return createPortal(
    <div className="fixed inset-0 z-20">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />
      <section
        ref={box} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-w-[480px] flex-col gap-4 rounded-t-[28px] border-t border-line bg-surface px-5 pt-3 pb-[calc(34px+env(safe-area-inset-bottom))] shadow-[var(--shadow-overlay)] outline-none"
      >
        <span className="h-[5px] w-9 self-center rounded-full bg-muted/40" aria-hidden="true" />
        {children}
      </section>
    </div>,
    document.body
  );
}
