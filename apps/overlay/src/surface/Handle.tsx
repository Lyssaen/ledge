import type { Tool } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import type { BotState } from '../bots/poseFor';
import { BADGE } from '../ui/Badge';
import { transition } from '../motion';
import type { Slot } from './geometry';
import { slotSizes } from './geometry';
import { useI18n } from '../i18n/lang';

export interface HandleBot { id: string; name: string; tool: Tool; state: BotState; pose: 1 | 2 | 3; pending: boolean; readOnly?: boolean; tip: string }

export function Handle({ bots, slots, big, visible, hoverId, onHover, onOpen, theme = 'dark', frozen = false, reducedMotion }: { bots: HandleBot[]; slots: Slot[]; big: number; visible: boolean; hoverId: string | null; onHover: (id: string | null) => void; onOpen: (id: string) => void; theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean }) {
  const { small, gap } = slotSizes(bots.length);
  const { t } = useI18n();
  return (
    <div data-layer="handle" inert={!visible} style={{ position: 'absolute', left: 0, top: 0, width: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap, padding: '8px 0', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) }}>
      {bots.map(b => {
        const on = slots.some(s => s.id === b.id);
        const size = b.pending ? big : small;
        const base = b.pending ? 1 : small / big;
        const hov = hoverId === b.id;
        const quiet = b.state === 'done' || b.state === 'readonly';
        return (
          <button key={b.id} type="button" tabIndex={on ? undefined : -1} aria-hidden={on ? undefined : true} aria-label={`${b.name} ${t.handleLabel[b.state]}, ${t.open}`} onClick={() => onOpen(b.id)} onMouseEnter={() => onHover(b.id)} onMouseLeave={() => onHover(null)}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: 9999, cursor: 'pointer', background: hov ? 'var(--sidebar-accent)' : 'transparent', width: on ? size : 0, height: on ? size : 0, marginTop: on ? 0 : -gap, opacity: !on ? 0 : hov || b.pending ? 1 : quiet ? 0.55 : 0.8,
              transition: transition([['width', 'grow', 0], ['height', 'grow', 0], ['margin-top', 'grow', 0], ['opacity', 'fadeIn', on ? 80 : 0], ['background-color', 'hover']]) }}>
            <span data-tick style={{ position: 'absolute', left: -4, top: 2, bottom: 2, width: 2, borderRadius: '0 2px 2px 0', background: BADGE[b.state].fg, opacity: b.pending ? 1 : 0, transition: transition([['opacity', 'fadeIn', b.pending ? 160 : 0], ['background-color', 'hover']]) }} />
            <span data-sprite style={{ display: 'inline-flex', lineHeight: 0, transform: `scale(${hov ? base * 1.25 : base})`, transition: transition([['transform', b.pending || hov ? 'pop' : 'shrink', 0]]) }}>
              <Bot seed={b.id} readOnly={b.readOnly} tool={b.tool} state={b.state} pose={b.pose} size={big} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
