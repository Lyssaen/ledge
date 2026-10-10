import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Session } from '@ledge/protocol';
import type { Mode } from '../surface/geometry';

export interface KeyboardOptions {
  enabled: boolean; mode: Mode; sessions: Session[]; focusedId: string | null;
  onFocus: (id: string | null) => void; onOpen: (id: string) => void; onDecide: (id: string, d: 'accept' | 'deny') => void;
  onNextAsk: () => void; onClose: () => void; onReplyFocus: () => void; onToggleDnd: () => void; onHelp: () => void;
  /** `o`: open the terminal tab of the focused row (list) or of the open session. */
  onTerminal?: (id: string) => void;
  /** 1 to 9 in a session whose ask is a question: choose option N. */
  onChooseOption?: (n: number) => void;
}

const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
/** A yes/no ask decidable from the list: Y and N decide it. A question has no yes/no answer and a diff or plan opens
 *  its review before any decision (spec §5), so on those they open the session instead. */
export const isYesNo = (s: Session) => isPending(s) && s.pending?.kind === 'permission';
/** A diff or plan: decided only from its open session, where the terminal preview is the review. */
export const needsReview = (s: Session) => isPending(s) && (s.pending?.kind === 'diff' || s.pending?.kind === 'plan');
/** Typing or choosing an option: any input (text, radio, checkbox), textarea, select or editable content. */
const isRadio = (el: Element | null) => el?.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio';
const choosing = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
/** Enter on a control other than a session row belongs to that control. */
const ownsEnter = (el: Element | null) => !!el && !!el.closest('button, a[href], summary, [role="button"]') && !el.closest('[data-row]');

/** Scoped single-key commands for a surface opened from the keyboard. Tab and Shift+Tab are never handled. */
export function useKeyboard(o: KeyboardOptions) {
  const latest = useRef(o);
  useLayoutEffect(() => { latest.current = o; });
  useEffect(() => {
    if (!o.enabled) return;
    const h = (e: KeyboardEvent) => {
      const c = latest.current;
      const k = e.key;
      const nextAsk = e.altKey && k === 'ArrowRight' && !e.ctrlKey && !e.metaKey;
      if (!nextAsk && (e.ctrlKey || e.metaKey || e.altKey)) return;
      const active = document.activeElement;
      const list = c.mode === 'list';
      const focused = c.sessions.find(s => s.id === c.focusedId);
      const digit = /^[1-9]$/.test(k);
      const option = !list && digit && !!focused && isPending(focused) && focused.pending?.kind === 'question';
      // Typing or choosing swallows every command but Escape and Alt+ArrowRight. A focused option radio also lets the
      // digits through, so 1 to 9 keep choosing from it; its arrow keys stay native.
      if (choosing(active) && k !== 'Escape' && !nextAsk && !(option && isRadio(active))) return;
      const ids = c.sessions.map(s => s.id);
      const i = c.focusedId ? ids.indexOf(c.focusedId) : -1;
      if (nextAsk) c.onNextAsk();
      else if (list && (k === 'j' || k === 'ArrowDown')) { if (ids.length) c.onFocus(ids[Math.min(ids.length - 1, i + 1)]!); }
      else if (list && (k === 'k' || k === 'ArrowUp')) { if (ids.length) c.onFocus(ids[Math.max(0, i - 1)]!); }
      else if (list && digit) { const id = ids[Number(k) - 1]; if (id) c.onFocus(id); }
      else if (option) c.onChooseOption?.(Number(k));
      else if (list && k === 'Enter') { if (ownsEnter(active)) return; if (focused) c.onOpen(focused.id); }
      else if (k === 'y' || k === 'n') { if (focused && isPending(focused)) { if (isYesNo(focused) || (c.mode === 'session' && needsReview(focused))) c.onDecide(focused.id, k === 'y' ? 'accept' : 'deny'); else c.onOpen(focused.id); } }
      else if (k === 'r') c.onReplyFocus();
      else if (k === 'o') { if (focused) c.onTerminal?.(focused.id); }
      else if (k === 'd') c.onToggleDnd();
      else if (k === 'Escape') c.onClose();
      else if (k === '?') c.onHelp();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [o.enabled]);
}
