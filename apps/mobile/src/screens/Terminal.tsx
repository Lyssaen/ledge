import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { newOperationId } from '../model/operations';
import { href } from '../router';
import { mobileStore, useMobile } from '../state/store';
import { BackHeader } from '../ui/Header';
import { useNow } from '../useNow';

const SIZE_KEY = 'ledge.mobile.terminalSize';
export const SIZE_MIN = 11;
export const SIZE_MAX = 20;
const SIZE_DEFAULT = 12;
/** How long a transmitted interruption keeps its confirmation while the agent still reports working. */
const SETTLE = 10_000;
const clamp = (n: number) => Math.max(SIZE_MIN, Math.min(SIZE_MAX, n));

function loadSize(): number {
  try { const n = Number(globalThis.localStorage?.getItem(SIZE_KEY)); return Number.isFinite(n) && n > 0 ? clamp(Math.round(n)) : SIZE_DEFAULT; } catch { return SIZE_DEFAULT; }
}
function saveSize(n: number): void {
  try { globalThis.localStorage?.setItem(SIZE_KEY, String(n)); } catch { /* blocked storage: the size lasts for this visit */ }
}

const STEP = 'inline-flex size-11 items-center justify-center rounded-control border border-line bg-surface text-[13px] font-medium disabled:opacity-45';
const ICON = 'size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';

/** What a session prints, read-only, and the one thing the phone may do to it: interrupt the agent. */
export function Terminal({ sessionId }: { sessionId: string }) {
  const { sessions, previews, ops, link } = useMobile();
  const now = useNow();
  const session = sessions.find(s => s.id === sessionId);
  const lines = previews[sessionId] ?? [];
  const [size, setSize] = useState(loadSize);
  const resize = (d: number) => setSize(s => { const n = clamp(s + d); saveSize(n); return n; });
  const [refused, setRefused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The latest lines are the ones that matter: follow the end, and leave the horizontal position alone.
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [lines.length, lines[lines.length - 1], size]);

  const back = href({ name: 'thread', sessionId });
  if (!session) {
    return (
      <>
        <BackHeader title={copy.thread.title} backTo={back} label={copy.terminal.back} />
        <main className="min-h-0 flex-1 px-side pt-7 text-[13px] text-muted" role="status">{link === 'connecting' ? copy.thread.loading : copy.terminal.unknown}</main>
      </>
    );
  }

  const waiting = !!session.pending || session.state === 'waiting_permission' || session.state === 'waiting_input';
  const offline = link !== 'online';
  const status = offline ? copy.terminal.offline : waiting ? copy.terminal.waiting : copy.terminal.live;
  const mine = Object.values(ops).filter(o => o.kind === 'interrupt' && o.sessionId === sessionId).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const last = mine[mine.length - 1];
  const inFlight = last?.phase === 'sending' || last?.phase === 'received' || last?.phase === 'uncertain';
  const working = session.state === 'working';
  // Just after a transmitted interruption the agent may still report `working`: the confirmation stays, and no second one goes.
  const justSent = last?.phase === 'applied' && (!working || now - Date.parse(last.startedAt) < SETTLE);
  const enabled = working && !offline && !waiting && !inFlight && !justSent;
  const why = offline ? copy.terminal.why.offline : waiting ? copy.terminal.why.waiting : !working ? copy.terminal.why.idle : null;
  const interrupt = () => {
    if (!enabled) return;
    setRefused(false);
    const operationId = newOperationId();
    if (!mobileStore.submit({ operationId, sessionId, kind: 'interrupt', phase: 'sending', startedAt: new Date().toISOString() }, { type: 'session.interrupt', id: sessionId, operationId })) setRefused(true);
  };
  const label = last?.phase === 'sending' || last?.phase === 'received' ? copy.terminal.sending : justSent ? copy.terminal.sent : copy.terminal.interrupt(session.name);
  const problem = refused || last?.phase === 'rejected' || last?.phase === 'failed' || last?.phase === 'unknown' ? copy.terminal.fail : last?.phase === 'uncertain' && !offline ? copy.terminal.uncertain : null;

  return (
    <>
      <BackHeader title={copy.terminal.title(session.name)} backTo={back} label={copy.terminal.back} />
      <main className="flex min-h-0 flex-1 flex-col px-side">
        <div className="mt-2 mb-4 flex items-center justify-between gap-2">
          <span role="status" className="text-xs text-muted">{status}</span>
          <div className="flex gap-2">
            <button type="button" disabled={size <= SIZE_MIN} onClick={() => resize(-1)} aria-label={copy.terminal.smaller} className={STEP}>A−</button>
            <button type="button" disabled={size >= SIZE_MAX} onClick={() => resize(1)} aria-label={copy.terminal.larger} className={STEP}>A+</button>
          </div>
        </div>
        <div ref={box} tabIndex={0} aria-label={copy.terminal.output} className="mb-3 min-h-0 flex-1 overflow-auto rounded-card border border-line bg-[#090a0b] p-4">
          {lines.length === 0
            ? <p className="text-xs text-muted">{copy.terminal.empty}</p>
            : <pre data-size={size} style={{ fontSize: size }} className="m-0 w-max min-w-full font-mono leading-[1.5] whitespace-pre text-[#c5ccc7]">{lines.join('\n')}</pre>}
        </div>
      </main>
      <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg px-side pt-3 pb-[max(16px,env(safe-area-inset-bottom))] [@media(max-height:650px)]:pb-2.5">
        <p className="text-center text-[10px] text-muted">{copy.terminal.scrollHint}</p>
        {problem && <p role="alert" className="text-center text-xs text-attention">{problem}</p>}
        <button type="button" disabled={!enabled} onClick={interrupt} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium disabled:opacity-45">
          <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          {label}
        </button>
        {why && !inFlight && !justSent && <p className="text-center text-[11px] text-muted">{why}</p>}
        <p className="text-center text-[10px] text-muted">{copy.terminal.note}</p>
      </footer>
    </>
  );
}
