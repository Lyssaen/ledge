import type { Ref } from 'react';
import { transition } from '../motion';
import type { SayKind } from './say';

/** Fallback extents of the unread speech bubble, before (or without) a layout measurement. */
export const UNREAD_SAY_BOX = { left: 16, w: 176, h: 36 } as const;

/** A comic balloon beside a speaker on the handle, outside the clipped notch. */
export function UnreadSay({ visible, top, left = UNREAD_SAY_BOX.left, text, kind, onOpen, ref }: { visible: boolean; top: number; left?: number; text: string; kind: SayKind; onOpen: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" data-unread-say data-say-kind={kind} tabIndex={visible ? 0 : -1} aria-hidden={visible ? undefined : true} onClick={() => { if (visible) onOpen(); }}
      style={{ position: 'absolute', left, top, padding: '6px 11px 7px', border: '1px solid var(--border)', borderRadius: '14px 14px 14px 4px', background: 'var(--popover)', color: 'var(--popover-foreground)', font: 'inherit', fontSize: 12, fontWeight: 600, lineHeight: '16px', letterSpacing: '-0.01em', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-overlay)', cursor: 'pointer', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transform: `translateY(${visible ? 0 : 4}px)`, transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 80 : 0], ['transform', visible ? 'pop' : 'shrink', 0]]) }}>
      {text}
      <span aria-hidden="true" data-tail style={{ position: 'absolute', left: 5, bottom: -4, width: 8, height: 8, background: 'var(--popover)', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)', transform: 'rotate(-40deg)', pointerEvents: 'none' }} />
    </button>
  );
}
