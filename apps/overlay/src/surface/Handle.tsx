import type { Tool } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { ResidentMascot, type ResidentGesture } from '../bots/ResidentMascot';
import { useEffect, useRef, useState } from 'react';
import type { BotState } from '../bots/poseFor';
import { BADGE } from '../ui/Badge';
import { transition } from '../motion';
import type { Slot } from './geometry';
import { slotSizes } from './geometry';
import { useI18n } from '../i18n/lang';

export interface HandleBot { id: string; name: string; tool: Tool; state: BotState; pose: 1 | 2 | 3; pending: boolean; lifted?: boolean; readOnly?: boolean; tip: string }

export function Handle({ bots, slots, big, visible, hoverId, onHover, onOpen, onOpenHome, top = 0, scale = 1, pointer = null, dnd = false, residentSignal, theme = 'dark', frozen = false, reducedMotion }: { bots: HandleBot[]; slots: Slot[]; big: number; visible: boolean; hoverId: string | null; onHover: (id: string | null) => void; onOpen: (id: string) => void; onOpenHome?: () => void; top?: number; scale?: number; pointer?: { x: number; y: number } | null; dnd?: boolean; residentSignal?: { key: number; kind: ResidentGesture }; theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean }) {
  const { small, gap } = slotSizes(bots.length);
  const { t } = useI18n();
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [boopKey, setBoopKey] = useState(0);
  useEffect(() => () => clearTimeout(opening.current), []);
  return (
    <div data-layer="handle" inert={!visible} style={{ position: 'absolute', left: 0, top: 0, width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap, padding: '8px 0', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) }}>
      <button data-resident type="button" aria-label={`${t.resident.name}, ${t.open}`} onClick={() => { setBoopKey(k => k + 1); clearTimeout(opening.current); opening.current = setTimeout(() => onOpenHome?.(), reducedMotion ? 0 : 180); }} title={frozen ? t.resident.offline : t.resident.tip(bots.length)} style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: 24, height: 20, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
        <ResidentMascot size={20} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} dnd={dnd} center={{ x: 14 * scale, y: top + 18 * scale }} pointer={pointer} gestureKey={residentSignal?.key} gestureKind={residentSignal?.kind} boopKey={boopKey} />
      </button>
      {bots.map(b => {
        const on = slots.some(s => s.id === b.id);
        const up = b.pending || !!b.lifted;
        const size = up ? big : small;
        const base = up ? 1 : small / big;
        const hov = hoverId === b.id;
        const quiet = b.state === 'done' || b.state === 'readonly';
        return (
          <button key={b.id} type="button" tabIndex={on ? undefined : -1} aria-hidden={on ? undefined : true} aria-label={`${b.name} ${t.handleLabel[b.state]}, ${t.open}`} onClick={() => onOpen(b.id)} onMouseEnter={() => onHover(b.id)} onMouseLeave={() => onHover(null)}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: 9999, cursor: 'pointer', background: hov ? 'var(--sidebar-accent)' : 'transparent', width: on ? size : 0, height: on ? size : 0, marginTop: on ? 0 : -gap, opacity: !on ? 0 : hov || up ? 1 : quiet ? 0.55 : 0.8,
              transition: transition([['width', 'grow', 0], ['height', 'grow', 0], ['margin-top', 'grow', 0], ['opacity', 'fadeIn', on ? 80 : 0], ['background-color', 'hover']]) }}>
            <span data-tick style={{ position: 'absolute', left: -4, top: 2, bottom: 2, width: 2, borderRadius: '0 2px 2px 0', background: BADGE[b.state].fg, opacity: b.pending ? 1 : 0, transition: transition([['opacity', 'fadeIn', b.pending ? 160 : 0], ['background-color', 'hover']]) }} />
            <span data-sprite style={{ display: 'inline-flex', lineHeight: 0, transform: `scale(${hov ? base * 1.25 : base})`, transition: transition([['transform', up || hov ? 'pop' : 'shrink', 0]]) }}>
              <Bot seed={b.id} readOnly={b.readOnly} tool={b.tool} state={b.state} pose={b.pose} size={big} shownSize={up ? big : small} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
