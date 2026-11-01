import { ResidentMascot, type ResidentGesture } from '../bots/ResidentMascot';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { transition } from '../motion';
import { FILET, ISLAND, SIZES } from './geometry';
import { useI18n } from '../i18n/lang';
import type { HandleLine } from './handleLine';
import { LedgeLine } from './LedgeLine';

/** The update dot's tone (null: none). The notch only ever shows `new`, when Ledge Desktop has an update waiting. */
export type PipTone = 'new' | 'busy' | 'bad' | 'ok' | null;

/** The measured widths (handle px) of Ledge's line and of the trailing slot: 0 when absent. They widen the notch (`layout`). */
export interface HandleMeasure { line: number; trailing: number }

export interface HandleProps {
  /** How many sessions Ledge watches: named in its tooltip (the notch shows no bot row, lot 4). */
  sessions: number;
  visible: boolean; onOpenHome?: () => void;
  /** What Ledge says beside it (`handleLine`); absent or calm: the mascot alone. */
  line?: HandleLine;
  /** Another feature's element at the right of the message (e.g. the music), after a vertical rule; absent: no rule. */
  trailing?: ReactNode;
  /** Reports the line's and the trailing slot's measured widths, so the window and the hot zone follow them. */
  onMeasure?: (m: HandleMeasure) => void;
  /** The island's left edge on screen (real px) and the handle scale: the awake mascot's gaze works in screen coordinates. */
  left?: number; scale?: number; pointer?: { x: number; y: number } | null;
  /** The discreet strip: the same filet, marked so a covering window can be told apart. */
  strip?: boolean;
  /** The pointer is over the notch: it grows into the compact island and Ledge's line in words. */
  awake?: boolean;
  /** The update dash after Ledge (null or absent: none). */
  updatePip?: PipTone; updateVersion?: string;
  /** The update dot. Opening the install is Ledge Desktop's job. */
  onUpdate?: () => void;
  /** The global shortcut as Desktop shows it, named in Ledge's tooltip. */
  shortcut?: string;
  dnd?: boolean; unread?: boolean; residentSignal?: { key: number; kind: ResidentGesture }; theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean;
}

const PIP_COLOR: Record<Exclude<PipTone, null>, string> = { new: 'var(--sidebar-primary)', busy: 'var(--info)', bad: 'var(--danger-text)', ok: 'var(--success)' };
const mark = (color: string): CSSProperties => ({ display: 'block', width: FILET.dash, height: 3, borderRadius: 1, background: color });
const filled = (n: ReactNode) => n !== undefined && n !== null && n !== false;

/** The resting notch, or the compact island while the pointer is over it: Ledge alone, its line, the trailing slot. */
export function Handle(p: HandleProps) {
  const trailing = p.strip ? undefined : p.trailing;
  return p.awake ? <CompactIsland {...p} trailing={trailing} /> : <Filet {...p} trailing={trailing} />;
}

/** Measures the line and the trailing slot (their client rect is zoomed by the handle scale) and reports them on every change. */
function useMeasure(scale: number, onMeasure: HandleProps['onMeasure']) {
  const [lineEl, setLineEl] = useState<HTMLElement | null>(null);
  const [trailingEl, setTrailingEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!onMeasure) return;
    const width = (el: HTMLElement | null) => (el ? Math.ceil(el.getBoundingClientRect().width / scale) : 0);
    const read = () => onMeasure({ line: width(lineEl), trailing: width(trailingEl) });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    if (lineEl) ro.observe(lineEl);
    if (trailingEl) ro.observe(trailingEl);
    return () => ro.disconnect();
  }, [lineEl, trailingEl, scale, onMeasure]);
  return { lineRef: setLineEl, trailingRef: setTrailingEl };
}

const layerStyle = (visible: boolean): CSSProperties => ({ position: 'absolute', left: 0, top: 0, width: 'max-content', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) });

/** The resting notch: Ledge's rectangle in its colour, its line's mark, the update dash, then the trailing slot after a hairline. */
function Filet({ sessions, visible, onOpenHome, line = { kind: 'calm' }, trailing, onMeasure, scale = 1, strip = false, updatePip = null, updateVersion = '', onUpdate, dnd = false, unread = false, frozen = false, shortcut }: HandleProps) {
  const { t } = useI18n();
  const { lineRef, trailingRef } = useMeasure(scale, onMeasure);
  const pipText = updatePip === 'new' ? t.update.pip.new(updateVersion) : updatePip ? t.update.pip[updatePip] : null;
  const dashButton: CSSProperties = { display: 'grid', placeItems: 'center', width: FILET.dash, height: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' };
  return (
    <div data-layer="handle" data-filet data-strip={strip || undefined} data-sessions={sessions} inert={!visible} style={{ ...layerStyle(visible), display: 'flex', alignItems: 'center', height: FILET.h, padding: `0 ${FILET.pad}px` }}>
      <button data-resident type="button" aria-label={unread ? `${t.resident.name} ${t.resident.unread}, ${t.open}` : `${t.resident.name}, ${t.open}`} title={`${pipText ? `${pipText}. ` : ''}${frozen ? t.resident.offline : unread ? t.resident.unreadTip : t.resident.tip(sessions)}${shortcut ? ` · ${shortcut}` : ''}`} onClick={() => onOpenHome?.()}
        style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: FILET.ledge, height: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
        <span data-ledge-mark style={{ display: 'block', width: FILET.ledge, height: 3, borderRadius: 1, background: dnd ? 'var(--muted-foreground)' : 'var(--sidebar-primary)' }} />
      </button>
      <LedgeLine line={line} variant="filet" onOpen={onOpenHome} lineRef={lineRef} />
      {updatePip && pipText && <button type="button" aria-label={pipText} title={pipText} onClick={() => onUpdate?.()} style={dashButton}>
        <span data-update-pip={updatePip} style={mark(PIP_COLOR[updatePip])} />
      </button>}
      {filled(trailing) && <>
        <span data-trailing-rule aria-hidden="true" style={{ display: 'block', flexShrink: 0, width: SIZES.separatorH, height: 6, margin: `0 ${(FILET.sep - SIZES.separatorH) / 2}px`, background: 'var(--sidebar-border)' }} />
        <span data-trailing ref={trailingRef} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{trailing}</span>
      </>}
    </div>
  );
}

/** The island awake, under the pointer (spec 2026-10-12 §3, lot 4 §8.5): the Ledge mascot and its line in words (`nn-closed-*`),
 *  the DND moon, then the trailing slot after a vertical rule. */
function CompactIsland({ sessions, visible, onOpenHome, line = { kind: 'calm' }, trailing, onMeasure, left = 0, scale = 1, pointer = null, updatePip = null, updateVersion = '', onUpdate, dnd = false, unread = false, residentSignal, theme = 'dark', frozen = false, reducedMotion, shortcut }: HandleProps) {
  const { t } = useI18n();
  const { lineRef, trailingRef } = useMeasure(scale, onMeasure);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [boopKey, setBoopKey] = useState(0);
  useEffect(() => () => clearTimeout(opening.current), []);
  const pipText = updatePip === 'new' ? t.update.pip.new(updateVersion) : updatePip ? t.update.pip[updatePip] : null;
  return (
    <div data-layer="handle" data-awake data-sessions={sessions} inert={!visible} style={{ ...layerStyle(visible), display: 'flex', flexDirection: 'row', alignItems: 'center', height: ISLAND.h, padding: `0 ${ISLAND.padR}px 0 ${ISLAND.padL}px` }}>
      <span style={{ position: 'relative', display: 'grid', flexShrink: 0, width: ISLAND.resident, height: ISLAND.resident }}>
      <button data-resident type="button" aria-label={unread ? `${t.resident.name} ${t.resident.unread}, ${t.open}` : `${t.resident.name}, ${t.open}`} onClick={() => { setBoopKey(k => k + 1); clearTimeout(opening.current); opening.current = setTimeout(() => onOpenHome?.(), reducedMotion ? 0 : 180); }} title={`${pipText ? `${pipText}. ` : ''}${frozen ? t.resident.offline : unread ? t.resident.unreadTip : t.resident.tip(sessions)}${shortcut ? ` · ${shortcut}` : ''}`}
        style={{ display: 'grid', placeItems: 'center', width: ISLAND.resident, height: ISLAND.resident, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
        <span data-sprite style={{ display: 'inline-flex', lineHeight: 0 }}>
          <ResidentMascot size={ISLAND.resident} theme={theme} paused={!visible} frozen={frozen} reducedMotion={reducedMotion} dnd={dnd} center={{ x: left + (ISLAND.padL + ISLAND.resident / 2) * scale, y: (ISLAND.h / 2) * scale }} pointer={pointer} gestureKey={residentSignal?.key} gestureKind={residentSignal?.kind} boopKey={boopKey} />
        </span>
      </button>
      {updatePip && pipText && <button type="button" data-update-pip={updatePip} aria-label={pipText} onClick={() => onUpdate?.()} style={{ position: 'absolute', top: 0, right: -2, width: 9, height: 9, padding: 0, borderRadius: 9999, border: '2px solid var(--notch)', boxSizing: 'content-box', background: PIP_COLOR[updatePip], animation: updatePip === 'busy' && !reducedMotion ? 'ledge-pulse 1.2s ease-in-out infinite' : undefined }} />}
      </span>
      <LedgeLine line={line} variant="island" onOpen={onOpenHome} lineRef={lineRef} />
      {dnd && (
        <svg data-dnd-moon aria-hidden="true" width={ISLAND.moon} height={ISLAND.moon} viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: ISLAND.gap }}>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
      {filled(trailing) && <>
        <span data-trailing-rule aria-hidden="true" style={{ display: 'block', flexShrink: 0, width: SIZES.separatorH, height: 16, marginLeft: ISLAND.sepGap, background: 'var(--sidebar-border)' }} />
        <span data-trailing ref={trailingRef} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: ISLAND.sepGap }}>{trailing}</span>
      </>}
    </div>
  );
}
