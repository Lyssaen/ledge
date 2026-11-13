import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';

/**
 * A wide screen (an iPad either way up, a desktop window): at least 768 px wide and taller than a phone on its side. The
 * same query as the `tablet` variant and the `.split` rules of styles.css.
 */
export const WIDE_QUERY = '(min-width: 768px) and (min-height: 501px)';
/** A wide screen on its side: the right pane is roomy enough for what the tablet adds to the phone's thread (Q27). */
export const WIDE_SIDE_QUERY = `${WIDE_QUERY} and (orientation: landscape)`;

const media = (q: string) => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(q) : null);
function useMedia(q: string): boolean {
  return useSyncExternalStore(
    fn => { const m = media(q); m?.addEventListener?.('change', fn); return () => m?.removeEventListener?.('change', fn); },
    () => media(q)?.matches ?? false,
    () => false
  );
}

/** Whether the app shows two panes: the list on the left, what it opens on the right. */
export function useWide(): boolean {
  return useMedia(WIDE_QUERY);
}

/**
 * Whether the two panes are side by side on a tablet on its side. Upright, the right pane is barely wider than a phone
 * (t-tablette.html §2, Q92): the thread and « Nouvelle session » take the phone's head, foot and cards there.
 */
export function useWideSide(): boolean {
  return useMedia(WIDE_SIDE_QUERY);
}

/** The Atelier's tab (docs/mockups/ledge-ipad-atelier.html): a wide screen only, and a PC that sends its projects (`daemon.atelier`). */
export function useAtelierTab(daemon: { atelier?: true } | null): boolean {
  return useWide() && !!daemon?.atelier;
}

/**
 * Where the banner of a PC that does not answer goes in two panes (t-tablette.html §6, Q95 A): a band across both, right of the
 * rail. `undefined` outside two panes; `null` until the band is mounted.
 */
const BannerSlot = createContext<HTMLElement | null | undefined>(undefined);
export const useBannerSlot = (): HTMLElement | null | undefined => useContext(BannerSlot);

/**
 * Two panes: `list` (the inbox or the agents, with the tabs) and `detail` (what it opened, or `empty`). `tab` names the tab whose
 * panes differ from the others' (`data-split`, read by styles.css): the MR/PR tab's list is narrower and its detail edge to edge;
 * upright, Sessions' detail keeps 18 px on each side (t-tablette.html §2).
 * `fold`: upright, the list folds and the detail takes the whole width, its « Retour » reopening the list (the terminal,
 * t-tablette.html §3, Q93). Above the panes, the band the list's offline banner goes to; a list with nothing to choose and
 * nothing opened joins both panes (styles.css, Q94 B).
 */
export function Split({ list, detail, tab, fold = false }: { list: ReactNode; detail: ReactNode; tab?: 'prs' | 'sessions'; fold?: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div className="split" data-split={tab} data-fold={fold ? '' : undefined}>
      <div ref={setSlot} className="split-banner" />
      <BannerSlot.Provider value={slot}>
        <section className="split-list">{list}</section>
        <section className="split-detail">{detail}</section>
      </BannerSlot.Provider>
    </div>
  );
}

/** The detail pane before anything was chosen in the list. */
export function SplitEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div data-split-empty="" className="flex flex-1 items-center justify-center px-6 text-center">
      <div className="max-w-[280px]">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-body text-muted">{body}</p>
      </div>
    </div>
  );
}
