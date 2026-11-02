import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import type { MediaCommand, NowPlaying } from '@ledge/protocol';
import { ResidentMascot, type ResidentGesture } from '../bots/ResidentMascot';
import { transition } from '../motion';
import { ISLAND } from './geometry';
import { useI18n } from '../i18n/lang';
import { SPINNER, SPINNER_STILL } from '../thread/tools';
import type { NotchLine } from '../notch/line';
import type { Described } from '../notch/describe';
import '../notch/notch.css';

/** The update dot's tone (null: none). The notch only ever shows `new`, when Ledge Desktop has an update waiting. */
export type PipTone = 'new' | 'busy' | 'bad' | 'ok' | null;
/** A request waiting for the user, as the resting Ledge mark shows it: red for a permission, amber for the rest. */
export type PendingTone = 'permission' | 'question' | null;

export interface HandleProps {
  visible: boolean; onOpenHome?: () => void;
  /** The island's left edge on screen (real px) and the handle scale: the awake mascot's gaze works in screen coordinates. */
  left?: number; scale?: number; pointer?: { x: number; y: number } | null;
  /** The discreet strip: the same filet, marked so a covering window can be told apart. */
  strip?: boolean;
  /** Awake: Ledge, the activity line and the music (hover, keyboard, or an activity for 5 s). */
  awake?: boolean;
  /** The session count, for Ledge's tooltip. */
  sessionCount?: number;
  /** The activity line: the line itself (its kind and colour), in words, and its age when it is an old one seen on hover. */
  line?: NotchLine | null; described?: Described | null; aged?: string | null; onOpenLine?: (id: string) => void;
  /** What plays on the PC (null: nothing, or paused for over 5 min); `trackKey` bumps on a new track (the cover's bounce). */
  music?: NowPlaying | null; trackKey?: number; musicOpen?: boolean; onMusicOpen?: (open: boolean) => void; onMedia?: (command: MediaCommand) => void;
  pending?: PendingTone;
  /** The request a click on Ledge reopens (the oldest waiting), and how many wait: its tooltip and label. */
  waiting?: { kind: 'permission' | 'question'; who: string; count: number } | null;
  updatePip?: PipTone; updateVersion?: string; onUpdate?: () => void;
  /** The global shortcut as Desktop shows it, named in Ledge's tooltip. */
  shortcut?: string;
  dnd?: boolean; unread?: boolean; residentSignal?: { key: number; kind: ResidentGesture }; theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean;
  /** The drawn row, measured by the surface for its width. */
  contentRef?: Ref<HTMLDivElement>;
}

const PIP_COLOR: Record<Exclude<PipTone, null>, string> = { new: 'var(--sidebar-primary)', busy: 'var(--info)', bad: 'var(--danger-text)', ok: 'var(--success)' };

/** The resting notch, or the awake row (Ledge, the line, the music). */
export function Handle(p: HandleProps) {
  return p.awake ? <AwakeNotch {...p} /> : <Filet {...p} />;
}

const layerStyle = (visible: boolean): CSSProperties => ({ position: 'absolute', left: 0, top: 0, opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? 200 : 0]]) });

function useResidentTip(p: HandleProps) {
  const { t } = useI18n();
  const pipText = p.updatePip === 'new' ? t.update.pip.new(p.updateVersion ?? '') : p.updatePip ? t.update.pip[p.updatePip] : null;
  if (p.waiting) return { pipText, title: t.notch.pending.tip(p.waiting.kind, p.waiting.who, p.waiting.count), label: t.notch.pending.aria(p.waiting.kind, p.waiting.who, p.waiting.count) };
  const title = `${pipText ? `${pipText}. ` : ''}${p.frozen ? t.resident.offline : p.unread ? t.resident.unreadTip : t.resident.tip(p.sessionCount ?? 0)}${p.shortcut ? ` · ${p.shortcut}` : ''}`;
  const label = p.unread ? `${t.resident.name} ${t.resident.unread}, ${t.open}` : `${t.resident.name}, ${t.open}`;
  return { pipText, title, label };
}

/** The resting notch: Ledge's mark (red or amber while a request waits, grey in Do not disturb), the update dash, and
 *  three still bars while a track plays. */
function Filet(p: HandleProps) {
  const { t } = useI18n();
  const { pipText, title, label } = useResidentTip(p);
  const playing = !!p.music?.playing;
  return (
    <div ref={p.contentRef} data-layer="handle" data-sessions={p.sessionCount ?? 0} data-filet data-strip={p.strip || undefined} inert={!p.visible} className="nt-filet" style={layerStyle(p.visible)}>
      <button data-resident type="button" aria-label={label} title={title} onClick={() => p.onOpenHome?.()}
        style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: 9, height: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
        <span data-ledge-mark className="nt-mark" data-dnd={p.dnd || undefined} data-pending={p.pending ?? undefined} />
      </button>
      {p.updatePip && pipText && <button type="button" aria-label={pipText} title={pipText} onClick={() => p.onUpdate?.()} style={{ display: 'grid', placeItems: 'center', flexShrink: 0, width: 5, height: 6, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
        <span data-update-pip={p.updatePip} style={{ display: 'block', width: 5, height: 3, borderRadius: 1, background: PIP_COLOR[p.updatePip] }} />
      </button>}
      {playing && p.music && <span data-eq className="nt-eq" role="img" aria-label={t.notch.music.label(p.music.title, p.music.artist)}><i /><i /><i /></span>}
    </div>
  );
}

function AwakeNotch(p: HandleProps) {
  const { t } = useI18n();
  const { title, label } = useResidentTip(p);
  const opening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [boopKey, setBoopKey] = useState(0);
  useEffect(() => () => clearTimeout(opening.current), []);
  const still = !!p.reducedMotion;
  const d = p.described;
  const track = p.line?.kind === 'track';
  return (
    <div ref={p.contentRef} data-layer="handle" data-sessions={p.sessionCount ?? 0} data-awake data-still={still || undefined} inert={!p.visible} className="nt-awake" style={layerStyle(p.visible)}>
      <span style={{ position: 'relative', display: 'grid', flexShrink: 0, width: ISLAND.resident, height: ISLAND.resident }}>
        <button data-resident type="button" aria-label={label} title={title} onClick={() => { setBoopKey(k => k + 1); clearTimeout(opening.current); opening.current = setTimeout(() => p.onOpenHome?.(), still ? 0 : 180); }}
          style={{ display: 'grid', placeItems: 'center', width: ISLAND.resident, height: ISLAND.resident, padding: 0, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer' }}>
          <span data-sprite style={{ display: 'inline-flex', lineHeight: 0 }}>
            <ResidentMascot size={ISLAND.resident} theme={p.theme ?? 'dark'} paused={!p.visible} frozen={p.frozen} reducedMotion={p.reducedMotion} dnd={p.dnd} center={{ x: (p.left ?? 0) + (ISLAND.padL + ISLAND.resident / 2) * (p.scale ?? 1), y: (ISLAND.h / 2) * (p.scale ?? 1) }} pointer={p.pointer ?? null} gestureKey={p.residentSignal?.key} gestureKind={p.residentSignal?.kind} boopKey={boopKey} />
          </span>
        </button>
        {/* A waiting request takes the update dot's place (the update stays on the filet's dash) until it is answered. */}
        {p.waiting && p.pending ? <span data-pending-dot={p.pending} aria-hidden="true" style={{ position: 'absolute', top: 0, right: -2, width: 9, height: 9, borderRadius: 9999, border: '2px solid var(--notch)', boxSizing: 'content-box', background: p.pending === 'permission' ? 'var(--danger-text)' : 'var(--warning)', pointerEvents: 'none' }} />
          : p.updatePip && <UpdateDot tone={p.updatePip} version={p.updateVersion ?? ''} onUpdate={p.onUpdate} reducedMotion={still} />}
      </span>
      {p.dnd && <svg data-dnd-moon className="nt-moon" aria-hidden="true" width={ISLAND.moon} height={ISLAND.moon} viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
      {p.line && d && <button type="button" data-line className="nt-line-btn" data-track={track || undefined} title={d.text}
        aria-label={track ? d.text : t.notch.line.open(d.who)} onClick={() => { if (d.open) p.onOpenLine?.(d.open); }}>
        <span className="nt-line" data-kind={p.line.kind} data-aged={p.aged ? true : undefined}>
          <span className="nt-glyph"><Glyph line={p.line} still={still || !!p.aged} /></span>
          <span className="nt-words">{d.parts.map((x, i) => x.k === 'name' ? <b key={i}>{x.s}</b> : x.k === 'code' ? <code key={i}>{x.s}</code> : <span key={i} className={x.k === 'arrow' ? 'nt-arrow' : x.k === 'sub' ? 'nt-sub' : x.k === 'text' ? 'nt-text' : undefined}>{x.s}</span>)}</span>
          {p.aged && <span className="nt-age">{p.aged}</span>}
        </span>
      </button>}
      {p.music && <>
        <span className="nt-sep" aria-hidden="true" />
        <MusicSlot music={p.music} open={!!p.musicOpen} trackKey={p.trackKey ?? 0} onOpen={p.onMusicOpen} onMedia={p.onMedia} />
      </>}
    </div>
  );
}

function UpdateDot({ tone, version, onUpdate, reducedMotion }: { tone: Exclude<PipTone, null>; version: string; onUpdate?: () => void; reducedMotion: boolean }) {
  const { t } = useI18n();
  const text = tone === 'new' ? t.update.pip.new(version) : t.update.pip[tone];
  return <button type="button" data-update-pip={tone} aria-label={text} onClick={() => onUpdate?.()} style={{ position: 'absolute', top: 0, right: -2, width: 9, height: 9, padding: 0, borderRadius: 9999, border: '2px solid var(--notch)', boxSizing: 'content-box', background: PIP_COLOR[tone], animation: tone === 'busy' && !reducedMotion ? 'ledge-pulse 1.2s ease-in-out infinite' : undefined }} />;
}

/* ------------------------------------------------------------------ the line's symbol */

const TONE: Record<string, string> = { message: 'var(--task)', tool: 'var(--info)', thinking: 'var(--muted-foreground)', permission: 'var(--danger-text)', error: 'var(--danger-text)', question: 'var(--warning)', plan: 'var(--warning)', diff: 'var(--warning)', finished: 'var(--success)', track: 'var(--sidebar-primary)' };

function Spinner({ color, still }: { color: string; still: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (still) return; const id = setInterval(() => setI(n => (n + 1) % SPINNER.length), 80); return () => clearInterval(id); }, [still]);
  return <span className="nt-spin" aria-hidden="true" style={{ color }}>{still ? SPINNER_STILL : SPINNER[i]}</span>;
}

function Glyph({ line, still }: { line: NotchLine; still: boolean }) {
  const c = line.kind === 'notification' ? TONE[line.reason]! : TONE[line.kind]!;
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (line.kind === 'message') return <svg {...common}><path d="M2.5 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg>;
  if (line.kind === 'tool') return <Spinner color={c} still={still} />;
  if (line.kind === 'thinking') return <span className="nt-dots" data-still={still || undefined} aria-hidden="true"><i /><i /><i /></span>;
  if (line.kind === 'track') return <svg {...common}><path d="M6 12.2V3.6l7-1.4v8.4" /><circle cx="4.4" cy="12.2" r="1.7" /><circle cx="11.4" cy="10.6" r="1.7" /></svg>;
  const r = line.reason;
  if (r === 'finished') return <svg {...common}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>;
  if (r === 'error') return <svg {...common}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  if (r === 'permission') return <svg {...common}><path d="M8 2.2 13 4v3.6c0 3-2.2 5.2-5 6.2-2.8-1-5-3.2-5-6.2V4z" /></svg>;
  if (r === 'question') return <svg {...common}><path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4" /><circle cx="8" cy="12.6" r=".5" fill={c} /></svg>;
  return <svg {...common}><rect x="3" y="2.5" width="10" height="11" rx="1.6" /><path d="M5.5 6h5M5.5 9h3.5" /></svg>;
}

/* ------------------------------------------------------------------ the music slot */

const NOTE = <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 12.2V3.6l7-1.4v8.4" /><circle cx="4.4" cy="12.2" r="1.7" /><circle cx="11.4" cy="10.6" r="1.7" /></svg>;
const ICO = {
  prev: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9.5 12z" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" /></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15L19.5 12z" /></svg>
};

/** A control the player refuses is greyed only once it has refused it for this long: right after a « next », some players
 *  (Chrome) report previous/next off for an instant, and the buttons must not blink. Allowing again is immediate. */
export const CAN_SETTLE_MS = 600;
/** How long the controls stay open once the pointer or the focus has left the cover's slot. */
export const MUSIC_LEAVE_MS = 250;
type Can = NowPlaying['can'];
function useSteadyCan(can: Can): Can {
  const [steady, setSteady] = useState(can);
  const key = `${can.previous}${can.playPause}${can.next}`;
  useEffect(() => {
    const up = { previous: steady.previous || can.previous, playPause: steady.playPause || can.playPause, next: steady.next || can.next };
    if (up.previous !== steady.previous || up.playPause !== steady.playPause || up.next !== steady.next) setSteady(up);
    if (can.previous === up.previous && can.playPause === up.playPause && can.next === up.next) return;
    const id = setTimeout(() => setSteady(can), CAN_SETTLE_MS);
    return () => clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` is `can`
  return steady;
}

function MusicSlot({ music, open, trackKey, onOpen, onMedia }: { music: NowPlaying; open: boolean; trackKey: number; onOpen?: (open: boolean) => void; onMedia?: (c: MediaCommand) => void }) {
  const { t } = useI18n();
  const M = t.notch.music;
  // Never the raw player id (« Chrome »): Windows names some players, not all.
  const who = music.artist || music.player.name || '';
  const can = useSteadyCan(music.can);
  const ctl = (key: 'prev' | 'play' | 'next') => {
    const allowed = key === 'prev' ? can.previous : key === 'next' ? can.next : can.playPause;
    const label = key === 'prev' ? M.prev : key === 'next' ? M.next : music.playing ? M.pause : M.play;
    const why = key === 'prev' ? M.cantPrev : key === 'next' ? M.cantNext : M.cantPlay;
    const command: MediaCommand = key === 'prev' ? 'previous' : key === 'next' ? 'next' : 'play_pause';
    return <button type="button" className="nt-ctl" data-ctl={key} aria-label={label} aria-disabled={!allowed || undefined} title={allowed ? label : why} tabIndex={open ? 0 : -1}
      onClick={() => { if (allowed) onMedia?.(command); }}>
      {key === 'play' ? (music.playing ? ICO.pause : ICO.play) : ICO[key]}
    </button>;
  };
  // Hovering or focusing the cover opens the controls; leaving the slot (pointer or focus) closes them after a short delay,
  // so a quick out-and-back keeps them open (mockup « Comportements »).
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaving.current), []);
  const enter = () => { clearTimeout(leaving.current); onOpen?.(true); };
  const leave = () => { clearTimeout(leaving.current); leaving.current = setTimeout(() => onOpen?.(false), MUSIC_LEAVE_MS); };
  return <div className="nt-music" data-music data-open={open || undefined} onMouseEnter={enter} onMouseLeave={leave} onFocus={enter}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leave(); }}>
    <button type="button" className="nt-cover-btn" aria-label={`${M.label(music.title, music.artist)}${music.playing ? '' : ` (${M.paused})`}`} aria-expanded={open}>
      <span key={trackKey} data-cover className="nt-cover" data-paused={!music.playing || undefined} data-pulse={trackKey > 0 || undefined}>
        {music.artwork ? <img src={music.artwork} alt="" draggable={false} /> : NOTE}
        {!music.playing && <span className="nt-pz" aria-hidden="true"><i /><i /></span>}
      </span>
    </button>
    <span className="nt-titles" aria-hidden={!open}>
      <b>{music.title}</b>
      {(who || !music.playing) && <span>{who}{!music.playing && <em>{who ? ' · ' : ''}{M.paused}</em>}</span>}
    </span>
    <span className="nt-ctls">{ctl('prev')}{ctl('play')}{ctl('next')}</span>
  </div>;
}
