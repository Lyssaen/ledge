import { useSyncExternalStore, type ReactNode } from 'react';

/**
 * A wide screen (an iPad either way up, a desktop window): at least 768 px wide and taller than a phone on its side. The
 * same query as the `tablet` variant and the `.split` rules of styles.css.
 */
export const WIDE_QUERY = '(min-width: 768px) and (min-height: 501px)';

const media = () => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(WIDE_QUERY) : null);
const subscribe = (fn: () => void) => {
  const m = media();
  m?.addEventListener('change', fn);
  return () => m?.removeEventListener('change', fn);
};

/** Whether the app shows two panes: the list on the left, what it opens on the right. */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}

/** Two panes: `list` (the inbox or the agents, with the tabs) and `detail` (what it opened, or `empty`). */
export function Split({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className="split">
      <section className="split-list">{list}</section>
      <section className="split-detail">{detail}</section>
    </div>
  );
}

/** The detail pane before anything was chosen in the list. */
export function SplitEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <div className="max-w-[280px]">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-body text-muted">{body}</p>
      </div>
    </div>
  );
}
