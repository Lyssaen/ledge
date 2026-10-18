import type { Tool } from '@ledge/protocol';
import { Fragment, type CSSProperties } from 'react';
import type { BotState } from '../bots/poseFor';
import type { ResidentGesture } from '../bots/ResidentMascot';
import { BADGE } from '../ui/Badge';
import { transition } from '../motion';
import { FILET, islandOrder, machineGroups, type Slot } from './geometry';
import { useI18n } from '../i18n/lang';
import type { PipTone } from '../update/machine';

export interface HandleBot { id: string; name: string; tool: Tool; state: BotState; pose: 1 | 2 | 3; pending: boolean; lifted?: boolean; held?: boolean; readOnly?: boolean; /** The session's machine (absent: this one). */ machine?: string }

export interface HandleProps {
  bots: HandleBot[]; slots: Slot[]; visible: boolean; hoverId: string | null; onHover: (id: string | null) => void; onOpen: (id: string) => void; onOpenHome?: () => void;
  /** The island's left edge on screen (real px) and the handle scale. Kept so callers stay stable; the filet has no gaze. */
  left?: number; scale?: number; pointer?: { x: number; y: number } | null;
  /** The discreet strip: the same filet, marked so a covering window can be told apart. */
  strip?: boolean;
  /** The update dash after the sessions (null or absent: none). */
  updatePip?: PipTone; updateVersion?: string;
  /** The update dot. Opening the install is Ledge Desktop's job. */
  onUpdate?: () => void;
  dnd?: boolean; unread?: boolean; sayId?: string | null; residentSignal?: { key: number; kind: ResidentGesture }; theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean;
}

const PIP_COLOR: Record<Exclude<PipTone, null>, string> = { new: 'var(--sidebar-primary)', busy: 'var(--info)', bad: 'var(--danger-text)', ok: 'var(--success)' };
const mark = (color: string): CSSProperties => ({ display: 'block', width: FILET.dash, height: 3, borderRadius: 1, background: color });

/** The resting notch: Ledge's rectangle in its colour, a hairline before each machine, one dash per session. */
export function Handle({ bots, visible, onHover, onOpen, onOpenHome, strip = false, updatePip = null, updateVersion = '', onUpdate, dnd = false, unread = false, frozen = false }: HandleProps) {
  const { t } = useI18n();
  const pipText = updatePip === 'new' ? t.update.pip.new(updateVersion) : updatePip ? t.update.pip[updatePip] : null;
  const groups = machineGroups(islandOrder(bots));
  const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) };
  const dashButton: CSSProperties = { display: 'grid', placeItems: 'center', width: FILET.dash, height: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' };
  return (
    <div data-layer="handle" data-filet data-strip={strip || undefined} inert={!visible} style={{ ...layer, display: 'flex', alignItems: 'center', height: FILET.h, padding: `0 ${FILET.pad}px` }}>
      <button data-resident type="button" aria-label={unread ? `${t.resident.name} ${t.resident.unread}, ${t.open}` : `${t.resident.name}, ${t.open}`} title={`${pipText ? `${pipText}. ` : ''}${frozen ? t.resident.offline : unread ? t.resident.unreadTip : t.resident.tip(bots.length)}`} onClick={() => onOpenHome?.()}
        style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: FILET.ledge, height: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
        <span data-ledge-mark style={{ display: 'block', width: FILET.ledge, height: 3, borderRadius: 1, background: dnd ? 'var(--muted-foreground)' : 'var(--sidebar-primary)' }} />
      </button>
      {groups.map(g => <Fragment key={g[0]!.id}>
        <span data-machine-separator aria-hidden="true" style={{ display: 'block', flexShrink: 0, width: 1, height: 6, margin: '0 3px', background: 'var(--sidebar-border)' }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: FILET.gap }}>
          {g.map(b => <button key={b.id} type="button" aria-label={`${b.name} ${t.handleLabel[b.state]}, ${t.open}`} onClick={() => onOpen(b.id)} onMouseEnter={() => onHover(b.id)} onMouseLeave={() => onHover(null)} style={dashButton}>
            <span data-dot data-state={b.state} style={mark(b.state === 'readonly' ? 'transparent' : BADGE[b.state].fg)} />
          </button>)}
        </span>
      </Fragment>)}
      {updatePip && pipText && <button type="button" aria-label={pipText} title={pipText} onClick={() => onUpdate?.()} style={dashButton}>
        <span data-update-pip={updatePip} style={mark(PIP_COLOR[updatePip])} />
      </button>}
    </div>
  );
}
