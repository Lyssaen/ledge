import type { Ref } from 'react';
import { transition } from '../motion';
import type { SayKind } from './say';

/** Fallback extents of the unread speech bubble, before (or without) a layout measurement. */
export const UNREAD_SAY_BOX = { left: 16, w: 176, h: 36 } as const;
/** The tail's left edge (inside the 1 px border) and side. */
const SAY_TAIL = { left: 5, size: 8 } as const;
/** From the balloon's left edge to the tail's centre: the point that sits under the speaker. */
export const SAY_TAIL_X = 1 + SAY_TAIL.left + SAY_TAIL.size / 2;

/** A comic balloon under a speaker in the island, outside the clipped notch. */
export function UnreadSay({ visible, top, left = UNREAD_SAY_BOX.left, text, kind, onOpen, ref }: { visible: boolean; top: number; left?: number; text: string; kind: SayKind; onOpen: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" data-unread-say data-say-kind={kind} tabIndex={visible ? 0 : -1} aria-hidden={visible ? undefined : true} onClick={() => { if (visible) onOpen(); }}
      style={{ position: 'absolute', left, top, padding: '6px 11px 7px', border: '1px solid var(--border)', borderRadius: '4px 14px 14px 14px', background: 'var(--popover)', color: 'var(--popover-foreground)', font: 'inherit', fontSize: 12, fontWeight: 600, lineHeight: '16px', letterSpacing: '-0.01em', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-overlay)', cursor: 'pointer', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transform: `translateY(${visible ? 0 : -4}px)`, transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 80 : 0], ['transform', visible ? 'pop' : 'shrink', 0]]) }}>
      {text}
      <span aria-hidden="true" data-tail style={{ position: 'absolute', left: SAY_TAIL.left, top: -4, width: SAY_TAIL.size, height: SAY_TAIL.size, background: 'var(--popover)', borderLeft: '1px solid var(--border)', borderTop: '1px solid var(--border)', transform: 'rotate(40deg)', pointerEvents: 'none' }} />
    </button>
  );
}
