import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { href } from '../router';
import { isLive, type Op } from '../state/operations';
import { localStore } from '../state/storage';
import { useMobile, type MobileStore } from '../state/store';
import { BackHeader, linkView } from '../ui/Header';
import { useNow } from '../useNow';
import { buttonClass, iconButtonClass } from '../ui/Button';
import { Icon } from '../ui/icons';

const SIZE_KEY = 'ledge.mobile.terminalSize';
export const SIZE_MIN = 11;
export const SIZE_MAX = 20;
const SIZE_DEFAULT = 12;
/** How long a transmitted interruption keeps its confirmation while the agent still reports working. */
const SETTLE = 10_000;
const clamp = (n: number) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, n));

function loadSize(storage?: Storage): number {
  try { const n = Number(localStore(storage)?.getItem(SIZE_KEY)); return Number.isFinite(n) && n > 0 ? clamp(Math.round(n)) : SIZE_DEFAULT; } catch { return SIZE_DEFAULT; }
}
function saveSize(n: number, storage?: Storage): void {
  try { localStore(storage)?.setItem(SIZE_KEY, String(n)); } catch { /* blocked storage: the size lasts for this visit */ }
}

const STEP = iconButtonClass({ variant: 'outline', className: 'text-body font-medium' });

type Interrupt = Op & { message: Extract<Op['message'], { type: 'session.interrupt' }> };

/** What a session prints, read-only, while it is watched; and the one thing the phone may do to it: interrupt the agent. */
export function Terminal({ store, sessionId, storage }: { store: MobileStore; sessionId: string; storage?: Storage }) {
  const state = useMobile(store);
  const now = useNow();
  const { fresh, ops } = state;
  const session = state.sessions.get(sessionId);
  const lines = state.previews.get(sessionId) ?? [];
  const [size, setSize] = useState(() => loadSize(storage));
  const resize = (d: number) => setSize(s => { const n = clamp(s + d); saveSize(n, storage); return n; });
  const [refused, setRefused] = useState(false);

  // Watched while open: the PC pushes the lines only to the phone watching. It forgets the watch when the link drops.
  useEffect(() => () => store.watch(null), [store, sessionId]);
  useEffect(() => { if (fresh) store.watch(sessionId); }, [store, sessionId, fresh]);

  const box = useRef<HTMLDivElement>(null);
  // The latest lines are the ones that matter: follow the end, and leave the horizontal position alone.
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [lines.length, lines[lines.length - 1], size]);

  const back = href({ name: 'thread', sessionId });
  const link = linkView(state);
  if (!session) {
    return (
      <>
        <BackHeader title={copy.thread.title} backTo={back} label={copy.terminal.back} link={link} />
        <main className="min-h-0 flex-1 pt-7 text-body text-muted" role="status">{!fresh && state.syncedAt === null ? copy.thread.loading : copy.terminal.unknown}</main>
      </>
    );
  }

  const waiting = !!session.pending || session.state === 'waiting_permission' || session.state === 'waiting_input';
  const offline = !fresh;
  const status = offline ? copy.terminal.offline : waiting ? copy.terminal.waiting : copy.terminal.live;
  const last = Object.values(ops)
    .filter((o): o is Interrupt => o.message.type === 'session.interrupt' && o.message.id === sessionId)
    .sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const inFlight = last !== undefined && isLive(last.phase);
  const working = session.state === 'working';
  // Just after a transmitted interruption the agent may still report `working`: the confirmation stays, and no second one goes.
  const justSent = last?.phase === 'applied' && (!working || now - Date.parse(last.at) < SETTLE);
  const enabled = working && !offline && !waiting && !inFlight && !justSent;
  const why = offline ? copy.terminal.why.offline : waiting ? copy.terminal.why.waiting : !working ? copy.terminal.why.idle : null;
  const interrupt = () => {
    if (!enabled) return;
    setRefused(!store.interrupt(sessionId));
  };
  const label = last?.phase === 'sending' ? copy.terminal.sending : justSent ? copy.terminal.sent : copy.terminal.interrupt(session.name);
  const problem = last?.phase === 'rejected' && last.reason === 'read_only' ? copy.terminal.readOnly
    : refused || last?.phase === 'rejected' || last?.phase === 'failed' ? copy.terminal.fail
    : last?.phase === 'uncertain' && !offline ? copy.terminal.uncertain : null;

  return (
    <>
      <BackHeader title={copy.terminal.title(session.name)} backTo={back} label={copy.terminal.back} link={link} />
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="mt-2 mb-4 flex items-center justify-between gap-2">
          <span role="status" className="text-small text-muted">{status}</span>
          <div className="flex gap-2">
            <button type="button" disabled={size <= SIZE_MIN} onClick={() => resize(-1)} aria-label={copy.terminal.smaller} className={STEP}>A−</button>
            <button type="button" disabled={size >= SIZE_MAX} onClick={() => resize(1)} aria-label={copy.terminal.larger} className={STEP}>A+</button>
          </div>
        </div>
        <div ref={box} tabIndex={0} aria-label={copy.terminal.output} className="mb-3 min-h-0 flex-1 overflow-auto rounded-card border border-line bg-term-bg p-4">
          {lines.length === 0
            ? <p className="text-small text-muted">{copy.terminal.empty}</p>
            : <pre data-size={size} style={{ fontSize: size }} className="m-0 w-max min-w-full font-mono leading-[1.5] whitespace-pre text-term-fg">{lines.join('\n')}</pre>}
        </div>
      </main>
      <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg pt-3 pb-[max(16px,env(safe-area-inset-bottom))] [@media(max-height:650px)]:pb-2.5">
        <p className="text-center text-meta text-muted">{copy.terminal.scrollHint}</p>
        {problem && <p role="alert" className="text-center text-small text-attention">{problem}</p>}
        <button type="button" disabled={!enabled} onClick={interrupt} className={buttonClass({ block: true })}>
          <Icon name="stop" />
          {label}
        </button>
        {why && !inFlight && !justSent && <p className="text-center text-meta text-muted">{why}</p>}
        <p className="text-center text-meta text-muted">{copy.terminal.note}</p>
      </footer>
    </>
  );
}
