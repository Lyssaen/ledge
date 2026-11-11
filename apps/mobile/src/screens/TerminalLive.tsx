// The agent's terminal, live (spec 2026-11-02 mobile terminal; mockups mobile-terminal.html 1a–4b and m2-sessions.html §6): the
// pane at the PC's size under the session's head, and once the passkey gave the hand, the keyboard with its row of keys.
import type { PhoneSession } from '@ledge/protocol';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { copy } from '../copy';
import type { PhoneLink } from '../link/link';
import { href } from '../router';
import { localStore } from '../state/storage';
import type { ForgeStore } from '../state/forge';
import { useMobile, type MobileStore } from '../state/store';
import { TermController, type TermView, type TermWire } from '../term/controller';
import { contextKeys, HOLD_IDLE_MS, keyBytes, READABLE_PX, withModifiers, type Mod, type SpecialKey } from '../term/keys';
import type { XtermScreen } from '../term/xterm';
import { buttonClass } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { useNow } from '../useNow';
import { useDeviceCheck } from './SessionClose';
import { SessionHead } from './SessionHead';
import { SessionFoot } from './Thread';
import { useWide } from '../ui/layout';
import { CONTEXT_NEAR } from '@ledge/protocol';
import { isApple } from './device';

const L = copy.terminal.live2;
const VIEW_KEY = 'ledge.mobile.terminalView';
type ViewMode = 'readable' | 'fit';

const loadView = (storage?: Storage): ViewMode => { try { return localStore(storage)?.getItem(VIEW_KEY) === 'fit' ? 'fit' : 'readable'; } catch { return 'readable'; } };
const saveView = (v: ViewMode, storage?: Storage) => { try { localStore(storage)?.setItem(VIEW_KEY, v); } catch { /* the choice lasts for this visit */ } };

/** The link as the terminal's controller needs it. */
export function wireOf(link: PhoneLink): TermWire {
  return { send: m => { void link.send(m).catch(() => undefined); }, onMessage: fn => link.onMessage(fn), ready: () => link.state() === 'ready', subscribe: fn => link.subscribe(fn) };
}

/** Where the pane was when the person went to « Fil »: it opens there again (Comportements, « garde le défilement de chaque vue »). */
const keptPlace = new Map<string, { left: number; top: number }>();

const left = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** xterm is loaded with the first terminal opened: the rest of the app never pays for it. */
const loadXterm = (host: HTMLElement): Promise<XtermScreen> => import('../term/xterm').then(m => m.createXterm(host));

export function TerminalLive({ store, link, session, storage, makeScreen, forge }: {
  store: MobileStore; link: PhoneLink; session: PhoneSession; storage?: Storage;
  /** The PC's requests, for the foot's MR/PR chip (M5 §9). */ forge?: ForgeStore | null;
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
  const [pasteFailed, setPasteFailed] = useState(false);
  const [map, setMap] = useState<{ left: number; width: number } | null>(null);
  // The numbered choice the screen shows, as context keys (§6); « Modèle et effort », opened from the foot.
  const [rowsChoice, setRowsChoice] = useState<ReturnType<typeof contextKeys>>([]);
  const [model, setModel] = useState(false);
  const wide = useWide();
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
      const kept = keptPlace.get(session.id);
      // The place comes back once the pane is drawn wide and tall enough to hold it; it stops the cursor's following.
      if (kept && el.scrollWidth >= kept.left + el.clientWidth && el.scrollHeight >= kept.top + el.clientHeight) {
        keptPlace.delete(session.id);
        el.scrollLeft = kept.left; el.scrollTop = kept.top;
        following.current = false;
      }
      if (following.current && mode === 'readable') {
        const { x, cellWidth } = screen.cursor();
        const at = x * cellWidth;
        if (at < el.scrollLeft || at > el.scrollLeft + el.clientWidth - cellWidth * 4) el.scrollLeft = Math.max(0, at - el.clientWidth / 2);
      }
      setMap(el.scrollWidth > el.clientWidth + 1 ? { left: el.scrollLeft / el.scrollWidth, width: el.clientWidth / el.scrollWidth } : null);
      const next = contextKeys(screen.rows());
      setRowsChoice(c => (c.length === next.length && c.every((k, i) => k.digit === next[i]!.digit && k.word === next[i]!.word) ? c : next));
    };
    screen.onDrawn(update);
    update();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, mode]);

  const leave = () => { const el = box.current; if (el) keptPlace.set(session.id, { left: el.scrollLeft, top: el.scrollTop }); };

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

  // « Taper ↵ » always ends the line with Enter (§6, QUESTIONS.md « M2b · Le terminal » 6).
  const sendLine = () => {
    if (!ctl || !line) return;
    ctl.type(`${line.replace(/\r?\n/g, '\r')}\r`);
    setLine('');
  };

  // A request waits on the person: the context keys may show, and the read-only bar says where else it is.
  const waiting = !!session.pending || session.state === 'waiting_permission' || session.state === 'waiting_input';
  const permission = session.pending?.kind === 'permission' || session.state === 'waiting_permission';

  const backRoute = { name: 'thread', sessionId: session.id } as const;
  const phase = view?.phase ?? 'connecting';
  const ended = phase === 'ended';
  const offline = phase === 'offline';
  const canType = !!state.daemon?.terminalInput && !view?.readOnly && session.readOnly !== true;
  const status = held ? L.status.held : L.status[phase];
  const releasedLine = view?.released && view.released !== 'asked' ? L.released[view.released] : null;
  const exitLine = view?.exit === 'gone' ? L.exit.gone(session.name) : view?.exit ? L.exit[view.exit] : null;
  const refusedLine = view?.refused ? L.refused[view.refused] ?? L.refused.unavailable! : null;
  const holdRefusedLine = view?.holdRefused ? L.holdRefused[view.holdRefused] ?? copy.confirm.refused[view.holdRefused as keyof typeof copy.confirm.refused] ?? null : null;
  // The page's clock ticks once a second, behind the last key: never more than the 5 minutes.
  const heldLeft = view?.held ? Math.min(HOLD_IDLE_MS, Math.min(view.held.lastKey + HOLD_IDLE_MS, view.held.until) - now) : 0;
  // The countdown shows only in the last minute, in place of « Au clavier »; the project gives it room.
  const lastMinute = held && heldLeft <= 60_000;
  // The context keys: only for a permission waiting, and while the screen shows « ❯ 1. ».
  const choice = permission ? rowsChoice : [];

  return (
    <>
      <SessionHead store={store} session={session} current="terminal" onLeave={leave} model={model} onModel={setModel}
        display={phase === 'live' || offline ? { value: mode === 'readable' ? L.readable : L.fit, onToggle: () => pick(mode === 'readable' ? 'fit' : 'readable') } : undefined} />
      <main className="flex min-h-0 flex-1 flex-col pt-2">
        {/* The banner (§6): the project, the state in the app's words, the size; « Rendre la main » while at the keyboard. Dark in both themes. */}
        <div className={`flex h-9 flex-none items-center gap-2 rounded-t-card bg-term-bg px-3 text-[12px] text-term-fg ${held ? 'border-2 border-b-0 border-info' : 'border border-b-0 border-line'}`}>
          {!lastMinute && <span className="min-w-0 truncate font-mono">{session.project}</span>}
          <span role="status" className={`flex-none rounded-[6px] px-2 py-0.5 font-medium ${held ? 'bg-info text-white' : offline ? 'text-attention' : phase === 'live' ? 'text-ok' : 'text-muted'}`}>
            {lastMinute ? L.heldLeft(left(heldLeft)) : status}
          </span>
          <span className="flex-1" />
          {held
            ? <button type="button" onClick={() => ctl?.release()} className="flex-none underline">{L.release}</button>
            : view && !ended && phase !== 'refused' && <span className="flex-none font-mono">{view.cols} × {view.rows}</span>}
        </div>
        <div ref={box} onScroll={onScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          aria-label={L.screen(session.name)}
          className={`relative min-h-0 flex-1 overflow-auto rounded-b-card bg-term-bg p-2 ${held ? 'border-2 border-t-0 border-info' : 'border border-t-0 border-line'} ${offline || ended ? 'opacity-45' : ''}`}>
          <div ref={host} data-term="" className="w-max" />
        </div>
        {map && !held && mode === 'readable' && (
          <div aria-label={L.position} role="img" className="relative mt-2 h-1 flex-none rounded-full bg-raised">
            <span className="absolute inset-y-0 rounded-full bg-muted" style={{ left: `${map.left * 100}%`, width: `${map.width * 100}%` }} />
          </div>
        )}
      </main>
      {held ? (
        <footer className="flex flex-none flex-col gap-1 pt-2 pb-[max(8px,var(--foot-inset))]">
          {pasteFailed && <p role="alert" className="text-meta text-attention">{L.pasteFailed}</p>}
          <div role="toolbar" aria-label={L.keys} className="flex gap-1.5 overflow-x-auto py-1.5">
            {choice.map(c => (
              <button key={c.digit} type="button" onPointerDown={e => e.preventDefault()} onClick={() => { following.current = true; ctl?.type(c.digit); }}
                className="inline-grid h-10 min-w-10 flex-none place-items-center rounded-control border border-attention/50 bg-attention/10 px-2.5 font-mono text-[13px] font-medium text-attention">
                {c.word ? `${c.digit} ${L.contextKeys[c.word]}` : c.digit}
              </button>
            ))}
            {/* A tablet keeps the keys a hardware keyboard lacks (§10, Q26); a phone, the whole row. */}
            {(wide ? ['interrupt', 'paste'] as const : lineMode ? ['esc', 'tab', 'up', 'down', 'line'] as const : ['esc', 'tab', 'ctrl', 'alt', 'left', 'up', 'down', 'right', 'enter', 'interrupt', 'paste', 'line'] as const).map(k => {
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
            {wide && <span className="ml-auto flex-none self-center pl-2 text-[12px] text-muted">{L.hardware}</span>}
          </div>
          {lineMode && !wide && (
            <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); sendLine(); }}>
              <span aria-hidden="true" className="font-mono text-muted">$</span>
              <input id="term-line" value={line} onChange={e => setLine(e.target.value)} aria-label={L.lineField} placeholder={L.lineField} autoCapitalize="off" enterKeyHint="send"
                className="min-h-11 min-w-0 flex-1 rounded-control border border-input bg-transparent px-3 font-mono text-body" />
              <button type="submit" disabled={!line} aria-label={L.lineSend} className={buttonClass({ variant: 'primary', size: 'sm' })}>{L.lineGo}</button>
            </form>
          )}
        </footer>
      ) : (
        <>
          <footer className="flex flex-none flex-col gap-2 pt-2.5 pb-2.5">
            {(releasedLine || exitLine || refusedLine || holdRefusedLine) && (
              <p role="status" className="text-center text-small text-muted">{refusedLine ?? exitLine ?? holdRefusedLine ?? releasedLine}</p>
            )}
            {ended ? (
              <a href={href(backRoute)} className={buttonClass({ block: true })}>{L.back}</a>
            ) : canType && phase !== 'refused' ? (
              <div className="flex items-center gap-3">
                {waiting && <span className="min-w-0 flex-1 text-small text-muted">{L.alsoInThread}</span>}
                <button type="button" disabled={phase !== 'live' || view?.holding} onClick={() => setSheet(true)} className={buttonClass({ size: 'sm', className: waiting ? 'flex-none' : 'ml-auto flex-none' })}>
                  <Icon name="keyboard" />{view?.released ? L.holdAgain : L.hold}
                </button>
              </div>
            ) : !offline && state.daemon?.terminal && !view?.readOnly && session.readOnly !== true && <p className="text-center text-meta text-muted">{L.inputOff}</p>}
            {offline && <p className="text-center text-meta text-muted">{L.offlineHint}</p>}
          </footer>
          <SessionFoot store={store} forge={forge} session={session} wide={wide} threshold={state.device?.contextNear ?? CONTEXT_NEAR} onModel={() => setModel(true)} />
        </>
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
