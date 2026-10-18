import type { Tool } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { ResidentMascot, type ResidentGesture } from '../bots/ResidentMascot';
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BotState } from '../bots/poseFor';
import { BADGE } from '../ui/Badge';
import { transition } from '../motion';
import { FILET, ISLAND, SIZES, islandOrder, machineGroups, pipeBefore, type Slot } from './geometry';
import { useI18n } from '../i18n/lang';
import type { PipTone } from '../update/machine';

export interface HandleBot { id: string; name: string; tool: Tool; state: BotState; pose: 1 | 2 | 3; pending: boolean; lifted?: boolean; held?: boolean; readOnly?: boolean; /** The session's machine (absent: this one). */ machine?: string }

export interface HandleProps {
  bots: HandleBot[]; slots: Slot[]; visible: boolean; hoverId: string | null; onHover: (id: string | null) => void; onOpen: (id: string) => void; onOpenHome?: () => void;
  /** The island's left edge on screen (real px) and the handle scale: the awake mascot's gaze works in screen coordinates. */
  left?: number; scale?: number; pointer?: { x: number; y: number } | null;
  /** The discreet strip: the same filet, marked so a covering window can be told apart. */
  strip?: boolean;
  /** The pointer is over the notch: it grows into the compact island and its robots. */
  awake?: boolean;
  /** The update dash after the sessions (null or absent: none). */
  updatePip?: PipTone; updateVersion?: string;
  /** The update dot. Opening the install is Ledge Desktop's job. */
  onUpdate?: () => void;
  /** The global shortcut as Desktop shows it, named in Ledge's tooltip. */
  shortcut?: string;
  dnd?: boolean; unread?: boolean; sayId?: string | null; residentSignal?: { key: number; kind: ResidentGesture }; theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean;
}

const PIP_COLOR: Record<Exclude<PipTone, null>, string> = { new: 'var(--sidebar-primary)', busy: 'var(--info)', bad: 'var(--danger-text)', ok: 'var(--success)' };
const mark = (color: string): CSSProperties => ({ display: 'block', width: FILET.dash, height: 3, borderRadius: 1, background: color });

/** The resting notch, or the compact island with its robots while the pointer is over it. */
export function Handle(p: HandleProps) {
  return p.awake ? <CompactIsland {...p} /> : <Filet {...p} />;
}

/** The resting notch: Ledge's rectangle in its colour, a hairline before each machine, one dash per session. */
function Filet({ bots, visible, onHover, onOpen, onOpenHome, strip = false, updatePip = null, updateVersion = '', onUpdate, dnd = false, unread = false, frozen = false, shortcut }: HandleProps) {
  const { t } = useI18n();
  const pipText = updatePip === 'new' ? t.update.pip.new(updateVersion) : updatePip ? t.update.pip[updatePip] : null;
  const groups = machineGroups(islandOrder(bots));
  const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) };
  const dashButton: CSSProperties = { display: 'grid', placeItems: 'center', width: FILET.dash, height: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' };
  return (
    <div data-layer="handle" data-filet data-strip={strip || undefined} inert={!visible} style={{ ...layer, display: 'flex', alignItems: 'center', height: FILET.h, padding: `0 ${FILET.pad}px` }}>
      <button data-resident type="button" aria-label={unread ? `${t.resident.name} ${t.resident.unread}, ${t.open}` : `${t.resident.name}, ${t.open}`} title={`${pipText ? `${pipText}. ` : ''}${frozen ? t.resident.offline : unread ? t.resident.unreadTip : t.resident.tip(bots.length)}${shortcut ? ` · ${shortcut}` : ''}`} onClick={() => onOpenHome?.()}
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

/** The island awake, under the pointer (spec 2026-10-12 §3): the Ledge mascot, a separator, the companions in `islandOrder`
 *  (by machine, asks first) with a separator between two machines, a "+n" pill past six, the DND moon. */
function CompactIsland({ bots, slots, visible, hoverId, onHover, onOpen, onOpenHome, left = 0, scale = 1, pointer = null, updatePip = null, updateVersion = '', onUpdate, dnd = false, unread = false, sayId = null, residentSignal, theme = 'dark', frozen = false, reducedMotion, shortcut }: HandleProps) {
  const { t } = useI18n();
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [boopKey, setBoopKey] = useState(0);
  useEffect(() => () => clearTimeout(opening.current), []);
  const pipText = updatePip === 'new' ? t.update.pip.new(updateVersion) : updatePip ? t.update.pip[updatePip] : null;
  const ordered = islandOrder(bots);
  const shown = ordered.filter(b => slots.some(s => s.id === b.id));
  const extra = ordered.length - shown.length;
  const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) };
  return (
    <div data-layer="handle" data-awake inert={!visible} style={{ ...layer, display: 'flex', flexDirection: 'row', alignItems: 'center', height: ISLAND.h, padding: `0 ${ISLAND.padR}px 0 ${ISLAND.padL}px` }}>
      <span style={{ position: 'relative', display: 'grid', flexShrink: 0, width: ISLAND.resident, height: ISLAND.resident }}>
      <button data-resident type="button" aria-label={unread ? `${t.resident.name} ${t.resident.unread}, ${t.open}` : `${t.resident.name}, ${t.open}`} onClick={() => { setBoopKey(k => k + 1); clearTimeout(opening.current); opening.current = setTimeout(() => onOpenHome?.(), reducedMotion ? 0 : 180); }} title={`${pipText ? `${pipText}. ` : ''}${frozen ? t.resident.offline : unread ? t.resident.unreadTip : t.resident.tip(bots.length)}${shortcut ? ` · ${shortcut}` : ''}`}
        style={{ display: 'grid', placeItems: 'center', width: ISLAND.resident, height: ISLAND.resident, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
        <span data-sprite style={{ display: 'inline-flex', lineHeight: 0 }}>
          <ResidentMascot size={ISLAND.resident} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} dnd={dnd} center={{ x: left + (ISLAND.padL + ISLAND.resident / 2) * scale, y: (ISLAND.h / 2) * scale }} pointer={pointer} gestureKey={residentSignal?.key} gestureKind={residentSignal?.kind} boopKey={boopKey} />
        </span>
      </button>
      {updatePip && pipText && <button type="button" data-update-pip={updatePip} aria-label={pipText} onClick={() => onUpdate?.()} style={{ position: 'absolute', top: 0, right: -2, width: 9, height: 9, padding: 0, borderRadius: 9999, border: '2px solid var(--notch)', boxSizing: 'content-box', background: { new: 'var(--sidebar-primary)', busy: 'var(--info)', bad: 'var(--danger-text)', ok: 'var(--success)' }[updatePip], animation: updatePip === 'busy' && !reducedMotion ? 'ledge-pulse 1.2s ease-in-out infinite' : undefined }} />}
      </span>
      <span data-separator aria-hidden="true" style={{ display: 'block', flexShrink: 0, width: bots.length ? SIZES.separatorH : 0, height: 16, marginLeft: bots.length ? ISLAND.sepGap : 0, background: 'var(--sidebar-border)', opacity: bots.length ? 1 : 0, transition: transition([['opacity', 'fadeIn', 0], ['margin-left', 'grow', 0], ['width', 'grow', 0]]) }} />
      {ordered.map(b => {
        const on = slots.some(s => s.id === b.id);
        const pipe = on && pipeBefore(shown[shown.indexOf(b) - 1], b);
        const up = b.pending || !!b.lifted || !!b.held;
        const hov = hoverId === b.id;
        const quiet = b.state === 'done' || b.state === 'readonly';
        const tick = b.pending && b.id !== sayId;
        return (
          <Fragment key={b.id}>
          <span data-machine-separator aria-hidden="true" style={{ display: 'block', flexShrink: 0, width: pipe ? SIZES.separatorH : 0, height: 16, marginLeft: pipe ? ISLAND.sepGap : 0, background: 'var(--sidebar-border)', opacity: pipe ? 1 : 0, transition: transition([['opacity', 'fadeIn', 0], ['margin-left', 'grow', 0], ['width', 'grow', 0]]) }} />
          <button type="button" tabIndex={on ? undefined : -1} aria-hidden={on ? undefined : true} aria-label={`${b.name} ${t.handleLabel[b.state]}, ${t.open}`} onClick={() => onOpen(b.id)} onMouseEnter={() => onHover(b.id)} onMouseLeave={() => onHover(null)}
            style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0, border: 'none', borderRadius: 9999, cursor: 'pointer', background: hov ? 'var(--sidebar-accent)' : 'transparent', width: on ? ISLAND.companion : 0, height: ISLAND.companion, marginLeft: on ? ISLAND.gap : 0, opacity: !on ? 0 : hov || up ? 1 : quiet ? 0.55 : 0.8,
              transition: transition([['width', 'grow', 0], ['margin-left', 'grow', 0], ['opacity', 'fadeIn', on ? 80 : 0], ['background-color', 'hover']]) }}>
            <span data-tick style={{ position: 'absolute', left: 4, right: 4, top: -3, height: 1, borderRadius: '0 0 1px 1px', background: BADGE[b.state].fg, opacity: tick ? 1 : 0, transition: transition([['opacity', 'fadeIn', tick ? 160 : 0], ['background-color', 'hover']]) }} />
            <span data-sprite style={{ display: 'inline-flex', lineHeight: 0, transform: `scale(${up || hov ? 1.25 : 1})`, transition: transition([['transform', up || hov ? 'pop' : 'shrink', 0]]) }}>
              <Bot seed={b.id} readOnly={b.readOnly} tool={b.tool} state={b.state} pose={b.pose} size={ISLAND.companion} shownSize={ISLAND.companion} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} />
            </span>
          </button>
          </Fragment>
        );
      })}
      {extra > 0 && (
        <button type="button" data-overflow className="mono" aria-label={t.resident.more(extra)} onClick={() => onOpenHome?.()}
          style={{ flexShrink: 0, width: ISLAND.pill, height: 16, marginLeft: ISLAND.gap, padding: 0, border: 0, borderRadius: 9999, background: 'var(--sidebar-accent)', color: 'var(--muted-foreground)', fontSize: 11, lineHeight: '16px', textAlign: 'center', cursor: 'pointer' }}>+{extra}</button>
      )}
      {dnd && (
        <svg data-dnd-moon aria-hidden="true" width={ISLAND.moon} height={ISLAND.moon} viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: ISLAND.gap }}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </div>
  );
}
