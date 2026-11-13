import { useSyncExternalStore, type ReactNode } from 'react';

/**
 * A wide screen (an iPad either way up, a desktop window): at least 768 px wide and taller than a phone on its side. The
 * same query as the `tablet` variant and the `.split` rules of styles.css.
 */
export const WIDE_QUERY = '(min-width: 768px) and (min-height: 501px)';

const media = () => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(WIDE_QUERY) : null);
const subscribe = (fn: () => void) => {
  const m = media();
  m?.addEventListener?.('change', fn);
  return () => m?.removeEventListener?.('change', fn);
};

/** Whether the app shows two panes: the list on the left, what it opens on the right. */
export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
}

/** The Atelier's tab (docs/mockups/ledge-ipad-atelier.html): a wide screen only, and a PC that sends its projects (`daemon.atelier`). */
export function useAtelierTab(daemon: { atelier?: true } | null): boolean {
  return useWide() && !!daemon?.atelier;
}

/**
 * Two panes: `list` (the inbox or the agents, with the tabs) and `detail` (what it opened, or `empty`). `tab` names the tab whose
 * panes differ from the others' (`data-split`, read by styles.css): the MR/PR tab's list is narrower and its detail edge to edge.
 */
export function Split({ list, detail, tab }: { list: ReactNode; detail: ReactNode; tab?: 'prs' }) {
  return (
    <div className="split" data-split={tab}>
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
