import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Conversations } from './useConversations';

const SAVE_MS = 250;
const END_SLACK = 24;

/** A thread's reading position in `desktop.thread[id]` (spec §7), for a session (lot 4) or the chat (`ledge`): it comes back once
 *  the thread is loaded, is saved 250 ms after scrolling stops and on leaving; at the end of the thread, a new `tail` stays in view.
 *  `scroll: null` means "at the end". The caller mounts one per id (`key`). */
export function useReadingPosition(id: string, api: Pick<Conversations, 'pref' | 'setPref'>, loaded: boolean, tail: string): { ref: RefObject<HTMLElement | null>; onScroll: () => void } {
  const ref = useRef<HTMLElement>(null);
  const restored = useRef(false);
  const atEnd = useRef(true);
  const pending = useRef<number | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(api);
  latest.current = api;

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current === undefined) return;
    latest.current.setPref(id, { scroll: pending.current });
    pending.current = undefined;
  };
  // Leaving the thread (it remounts per id) saves where the reader was.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || restored.current) return;
    if (!loaded) { atEnd.current = true; el.scrollTop = el.scrollHeight; return; }
    const at = latest.current.pref(id).scroll;
    el.scrollTop = at ?? el.scrollHeight;
    atEnd.current = at === null;
    restored.current = true;
  }, [loaded, id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (restored.current || !loaded) && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [tail]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = ref.current;
    // Never record a position while a partial fallback is shown (the collapsed content would clamp it).
    if (!el || !restored.current || !loaded) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < END_SLACK;
    pending.current = atEnd.current ? null : Math.round(el.scrollTop);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_MS);
  };
  return { ref, onScroll };
}
