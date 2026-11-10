// The agent's terminal, live (spec 2026-11-02 mobile terminal; mockup docs/mockups/mobile-terminal.html, 1a–4b): the pane at
// the PC's size, « Lisible » or « Ajusté », and once the passkey gave the hand, the keyboard with its row of special keys.
import type { PhoneSession } from '@ledge/protocol';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { copy } from '../copy';
import type { PhoneLink } from '../link/link';
import { href } from '../router';
import { isLive, type Op } from '../state/operations';
import { localStore } from '../state/storage';
import { useMobile, type MobileStore } from '../state/store';
import { TermController, type TermView, type TermWire } from '../term/controller';
import { HOLD_IDLE_MS, keyBytes, READABLE_PX, withModifiers, type Mod, type SpecialKey } from '../term/keys';
import type { XtermScreen } from '../term/xterm';
import { BackHeader, linkView } from '../ui/Header';
import { buttonClass } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { useNow } from '../useNow';
import { useDeviceCheck } from './SessionClose';
import { isApple } from './device';

const L = copy.terminal.live2;
const VIEW_KEY = 'ledge.mobile.terminalView';
type ViewMode = 'readable' | 'fit';
const SETTLE = 10_000;

const loadView = (storage?: Storage): ViewMode => { try { return localStore(storage)?.getItem(VIEW_KEY) === 'fit' ? 'fit' : 'readable'; } catch { return 'readable'; } };
const saveView = (v: ViewMode, storage?: Storage) => { try { localStore(storage)?.setItem(VIEW_KEY, v); } catch { /* the choice lasts for this visit */ } };

/** The link as the terminal's controller needs it. */
export function wireOf(link: PhoneLink): TermWire {
  return { send: m => { void link.send(m).catch(() => undefined); }, onMessage: fn => link.onMessage(fn), ready: () => link.state() === 'ready', subscribe: fn => link.subscribe(fn) };
}

const left = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

type Interrupt = Op & { message: Extract<Op['message'], { type: 'session.interrupt' }> };

/** xterm is loaded with the first terminal opened: the rest of the app never pays for it. */
const loadXterm = (host: HTMLElement): Promise<XtermScreen> => import('../term/xterm').then(m => m.createXterm(host));

export function TerminalLive({ store, link, session, storage, makeScreen }: {
  store: MobileStore; link: PhoneLink; session: PhoneSession; storage?: Storage;
  /** The xterm; a fake in tests, where there is no canvas to measure. */ makeScreen?: (host: HTMLElement) => XtermScreen;
}) {
  const state = useMobile(store);
  const now = useNow();
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [ctl, setCtl] = useState<TermController | null>(null);
  const [screen, setScreen] = useState<XtermScreen | null>(null);
  const [mode, setMode] = useState<ViewMode>(() => loadView(storage));
  const [sheet, setSheet] = useState(false);
  const [mods, setMods] = useState<Record<Mod, 'off' | 'armed' | 'locked'>>({ ctrl: 'off', alt: 'off' });
  const [lineMode, setLineMode] = useState(false);
  const [line, setLine] = useState('');
  const [withEnter, setWithEnter] = useState(true);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [map, setMap] = useState<{ left: number; width: number } | null>(null);
  const following = useRef(true);
  const modsRef = useRef(mods);
  modsRef.current = mods;

  // One xterm and one controller for the page: made once the box is there, gone with the page (which closes the terminal).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let gone = false;
    let made: { c: TermController; xt: XtermScreen } | null = null;
    const begin = (xt: XtermScreen) => {
      if (gone) { xt.dispose(); return; }
      const c = new TermController(wireOf(link), session.id, xt);
      xt.onData(d => c.type(applyMods(d)));
      c.start();
      made = { c, xt };
      setCtl(c); setScreen(xt);
    };
    if (makeScreen) begin(makeScreen(el)); else void loadXterm(el).then(begin);
    return () => { gone = true; made?.c.stop(); made?.xt.dispose(); };
    // The session id is the page's key: another session is another page.
  }, [link, session.id, makeScreen]);

  /** The armed modifiers apply to the next key, then disarm; a locked one stays. */
  const applyMods = (d: string): string => {
    const m = modsRef.current;
    if (m.ctrl === 'off' && m.alt === 'off') return d;
    const out = withModifiers(d, { ctrl: m.ctrl !== 'off', alt: m.alt !== 'off' });
    setMods(x => ({ ctrl: x.ctrl === 'armed' ? 'off' : x.ctrl, alt: x.alt === 'armed' ? 'off' : x.alt }));
    return out;
  };

  const view: TermView | null = useSyncExternalStore(
    fn => (ctl ? ctl.subscribe(fn) : () => {}),
    () => ctl?.state ?? null
  );
  const held = !!view?.held;

  useEffect(() => { screen?.setInput(held); if (held) { following.current = true; screen?.focus(); } }, [screen, held]);

  // The font: « Ajusté » fills the width with the pane's columns, « Lisible » is 11 px.
  useEffect(() => {
    if (!screen || !box.current || !view) return;
    screen.setFont(mode === 'fit' ? screen.fitFont(box.current.clientWidth - 16) : READABLE_PX);
  }, [screen, mode, view?.cols]);

  // « Lisible » follows the cursor across the long lines; the bar says which part of the columns shows.
  useEffect(() => {
    if (!screen) return;
    const el = box.current;
    const update = () => {
      if (!el) return;
      if (following.current && mode === 'readable') {
        const { x, cellWidth } = screen.cursor();
        const at = x * cellWidth;
        if (at < el.scrollLeft || at > el.scrollLeft + el.clientWidth - cellWidth * 4) el.scrollLeft = Math.max(0, at - el.clientWidth / 2);
      }
      setMap(el.scrollWidth > el.clientWidth + 1 ? { left: el.scrollLeft / el.scrollWidth, width: el.clientWidth / el.scrollWidth } : null);
    };
    screen.onDrawn(update);
    update();
  }, [screen, mode]);

  const onScroll = () => {
    const el = box.current;
    if (el) setMap(el.scrollWidth > el.clientWidth + 1 ? { left: el.scrollLeft / el.scrollWidth, width: el.clientWidth / el.scrollWidth } : null);
  };

  // Pinch: between « Ajusté » and 16 px, from the size the fingers started at.
  const pinch = useRef<{ d: number; px: number } | null>(null);
  const dist = (t: React.TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && screen) pinch.current = { d: dist(e.touches), px: screen.font() };
    else following.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinch.current || !screen || !box.current) return;
    const lo = screen.fitFont(box.current.clientWidth - 16);
    screen.setFont(Math.max(lo, pinch.current.px * (dist(e.touches) / pinch.current.d)));
  };
  const onTouchEnd = () => { pinch.current = null; };

  const pick = (v: ViewMode) => { setMode(v); saveView(v, storage); following.current = true; };

  const key = (k: SpecialKey) => {
    if (!ctl || !screen) return;
    following.current = true;
    if (k === 'ctrl' || k === 'alt') {
      setMods(m => ({ ...m, [k]: m[k] === 'off' ? 'armed' : m[k] === 'armed' ? 'locked' : 'off' }));
      return;
    }
    if (k === 'line') { setLineMode(v => !v); return; }
    if (k === 'paste') {
      setPasteFailed(false);
      // Read in the tap itself: the browser allows the clipboard only there.
      void navigator.clipboard?.readText?.().then(t => { if (t) screen.paste(t); else setPasteFailed(true); }, () => setPasteFailed(true));
      return;
    }
    ctl.type(applyMods(keyBytes(k, screen.appCursor())));
  };

  const sendLine = () => {
    if (!ctl || !line) return;
    const text = line.replace(/\r?\n/g, withEnter ? '\r' : ' ');
    ctl.type(withEnter ? `${text}\r` : text);
    setLine('');
  };

  // Interrupt, as the read-only screen has it.
  const last = Object.values(state.ops)
    .filter((o): o is Interrupt => o.message.type === 'session.interrupt' && o.message.id === session.id)
    .sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const working = session.state === 'working';
  const waiting = !!session.pending || session.state === 'waiting_permission' || session.state === 'waiting_input';
  const justSent = last?.phase === 'applied' && (!working || now - Date.parse(last.at) < SETTLE);
  const canInterrupt = working && state.fresh && !waiting && !(last && isLive(last.phase)) && !justSent;

  const backRoute = { name: 'thread', sessionId: session.id } as const;
  const phase = view?.phase ?? 'connecting';
  const ended = phase === 'ended';
  const offline = phase === 'offline';
  const canType = !!state.daemon?.terminalInput && !view?.readOnly && session.readOnly !== true;
  const status = held ? L.status.held : L.status[phase];
  const meta = ended ? L.ended(session.project) : L.meta(session.project, view?.cols ?? 0, view?.rows ?? 0);
  const releasedLine = view?.released && view.released !== 'asked' ? L.released[view.released] : null;
  const exitLine = view?.exit === 'gone' ? L.exit.gone(session.name) : view?.exit ? L.exit[view.exit] : null;
  const refusedLine = view?.refused ? L.refused[view.refused] ?? L.refused.unavailable! : null;
  const holdRefusedLine = view?.holdRefused ? L.holdRefused[view.holdRefused] ?? copy.confirm.refused[view.holdRefused as keyof typeof copy.confirm.refused] ?? null : null;
  // The page's clock ticks once a second, behind the last key: never more than the 5 minutes.
  const heldLeft = view?.held ? Math.min(HOLD_IDLE_MS, Math.min(view.held.lastKey + HOLD_IDLE_MS, view.held.until) - now) : 0;

  return (
    <>
      {held ? (
        <div className="flex flex-none items-center gap-2 pt-2 pb-2 text-small">
          <span aria-hidden="true" className="size-2 flex-none rounded-full bg-info" />
          <span role="status" className="min-w-0 flex-1 leading-[1.35]"><b className="font-semibold">{L.heldTitle(session.name)}</b><br /><span className="text-muted">{L.heldLeft(left(heldLeft))}</span></span>
          <button type="button" onClick={() => ctl?.release()} className={buttonClass({ size: 'sm' })}>{L.release}</button>
        </div>
      ) : (
        <BackHeader title={copy.terminal.title(session.name)} fallback={backRoute} label={L.back} link={linkView(state)} />
      )}
      <main className="flex min-h-0 flex-1 flex-col">
        {!held && (
          <div className="flex flex-none items-center justify-between gap-2 py-2.5">
            <div className="min-w-0">
              <p role="status" className={`flex items-center gap-1.5 text-meta ${offline ? 'text-attention' : ended || phase === 'refused' ? 'text-muted' : 'text-ok'}`}>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{status}
              </p>
              <p className="text-meta text-muted">{meta}</p>
            </div>
            {(phase === 'live' || offline) && (
              <div role="group" aria-label={L.view} className="inline-flex gap-0.5 rounded-control border border-input p-0.5">
                {(['readable', 'fit'] as const).map(v => (
                  <button key={v} type="button" aria-pressed={mode === v} onClick={() => pick(v)}
                    className={`min-h-8 rounded-[8px] px-2.5 text-small font-medium ${mode === v ? 'bg-raised text-fg' : 'text-muted'}`}>
                    {v === 'readable' ? L.readable : L.fit}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div ref={box} onScroll={onScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          aria-label={L.screen(session.name)}
          className={`relative min-h-0 flex-1 overflow-auto rounded-card bg-term-bg p-2 ${held ? 'border-2 border-info' : 'border border-line'} ${offline || ended ? 'opacity-45' : ''}`}>
          <div ref={host} data-term="" className="w-max" />
          {held && <span aria-hidden="true" className="absolute top-2 right-2 rounded-[6px] bg-info px-2 py-0.5 text-meta font-semibold text-white">{L.heldTag}</span>}
        </div>
        {map && !held && (
          <div aria-label={L.position} role="img" className="relative mt-2 h-1 flex-none rounded-full bg-raised">
            <span className="absolute inset-y-0 rounded-full bg-muted" style={{ left: `${map.left * 100}%`, width: `${map.width * 100}%` }} />
          </div>
        )}
      </main>
      {held ? (
        <footer className="flex flex-none flex-col gap-1 pt-2 pb-[max(8px,var(--foot-inset))]">
          {lineMode && (
            <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); sendLine(); }}>
              <input id="term-line" value={line} onChange={e => setLine(e.target.value)} aria-label={L.lineField} autoCapitalize="off" enterKeyHint="send"
                className="min-h-12 min-w-0 flex-1 rounded-control border border-input bg-transparent px-3 text-body" />
              <button type="submit" disabled={!line} aria-label={L.lineSend} className={buttonClass({ variant: 'primary', size: 'sm' })}><Icon name="arrowUp" /></button>
            </form>
          )}
          {pasteFailed && <p role="alert" className="text-meta text-attention">{L.pasteFailed}</p>}
          <div role="toolbar" aria-label={L.keys} className="flex gap-1.5 overflow-x-auto py-1.5">
            {lineMode && (
              <label className="flex flex-none items-center gap-1.5 pr-1 text-small text-muted">
                <input type="checkbox" checked={withEnter} onChange={e => setWithEnter(e.target.checked)} />{L.withEnter}
              </label>
            )}
            {(lineMode ? ['esc', 'tab', 'up', 'down', 'line'] as const : ['esc', 'tab', 'ctrl', 'alt', 'left', 'up', 'down', 'right', 'enter', 'interrupt', 'paste', 'line'] as const).map(k => {
              const on = k === 'ctrl' || k === 'alt' ? mods[k] !== 'off' : k === 'line' ? lineMode : false;
              const pressed = k === 'ctrl' || k === 'alt' || k === 'line' ? on : undefined;
              const state2 = (k === 'ctrl' || k === 'alt') && mods[k] !== 'off' ? `, ${mods[k] === 'locked' ? L.locked : L.armed}` : '';
              return (
                <button key={k} type="button" aria-pressed={pressed} aria-label={`${L.keyLabel[k]}${state2}`}
                  // The focus stays in the terminal: the phone's keyboard does not close at each tap.
                  onPointerDown={e => e.preventDefault()} onClick={() => key(k)}
                  className={`inline-grid h-10 min-w-10 flex-none place-items-center rounded-control border px-2.5 font-mono text-[13px] font-medium ${on ? 'border-transparent bg-fg text-bg' : 'border-input bg-surface text-fg'}`}>
                  {L.key[k]}
                </button>
              );
            })}
          </div>
        </footer>
      ) : (
        <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg pt-3 pb-[max(16px,var(--foot-inset))]">
          {(releasedLine || exitLine || refusedLine || holdRefusedLine) && (
            <p role="status" className="text-center text-small text-muted">{refusedLine ?? exitLine ?? holdRefusedLine ?? releasedLine}</p>
          )}
          {ended ? (
            <a href={href(backRoute)} className={buttonClass({ block: true })}>{L.back}</a>
          ) : (
            <>
              {canType && phase !== 'refused' && (
                <button type="button" disabled={phase !== 'live' || view?.holding} onClick={() => setSheet(true)} className={buttonClass({ variant: 'primary', block: true })}>
                  <Icon name="keyboard" />{view?.released ? L.holdAgain : L.hold}
                </button>
              )}
              <button type="button" disabled={!canInterrupt} onClick={() => { if (canInterrupt) store.interrupt(session.id); }} className={buttonClass({ block: true })}>
                <Icon name="stop" />{justSent ? copy.terminal.sent : copy.terminal.interrupt(session.name)}
              </button>
              {offline && <p className="text-center text-meta text-muted">{L.offlineHint}</p>}
              {!canType && !offline && state.daemon?.terminal && !view?.readOnly && session.readOnly !== true && <p className="text-center text-meta text-muted">{L.inputOff}</p>}
            </>
          )}
        </footer>
      )}
      {sheet && ctl && <HoldSheet store={store} session={session} onClose={() => setSheet(false)} hold={a => { setSheet(false); void ctl.hold(a); return 'sent'; }} />}
    </>
  );
}

/** « Taper dans le terminal de Nova ? » (2a–2c): what holding the hand allows, then the passkey from the same button. */
function HoldSheet({ store, session, onClose, hold }: { store: MobileStore; session: PhoneSession; onClose: () => void; hold: (a: Parameters<TermController['hold']>[0]) => string | null }) {
  const { fresh, device } = useMobile(store);
  const protectedDevice = !!device?.confirm;
  const check = useDeviceCheck(store, 'terminal', session.id, fresh && protectedDevice, hold);
  const full = (variant?: 'primary') => buttonClass({ variant, block: true });
  const label = check.asking ? copy.confirm.asking : check.challenge ? (isApple() ? `${L.go}` : L.go) : copy.confirm.preparing;
  return (
    <Sheet labelledBy="hold-title" onClose={onClose}>
      <h2 id="hold-title" className="text-heading leading-[1.3] tracking-[-.5px]">{L.sheetTitle(session.name)}</h2>
      {!protectedDevice ? (
        <>
          <Notice title={L.unprotectedTitle} tone="warning" role="status"><p>{L.unprotectedBody}</p></Notice>
          <a href={href({ name: 'connection' })} className={full('primary')}>{L.openConnection}</a>
        </>
      ) : (
        <>
          <p className="text-body leading-[1.6] text-muted">{L.sheetBody}</p>
          <p className="text-small leading-[1.6] text-muted">{L.sheetNote}</p>
          {check.problem && <Notice title={copy.confirm[check.problem]} tone="warning" role="alert" />}
          {check.needsNew
            ? <button type="button" onClick={check.retry} className={full('primary')}>{copy.confirm.retry}</button>
            : <button type="button" disabled={check.asking || !check.challenge} onClick={() => { void check.go(); }} className={full('primary')}><Icon name="passkey" />{label}</button>}
        </>
      )}
      <button type="button" onClick={onClose} className={full()}>{L.cancel}</button>
    </Sheet>
  );
}
