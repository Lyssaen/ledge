import { useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import type { Session } from '@ledge/protocol';
import { useDaemon } from '../daemon/store';
import type { DaemonClient } from '../daemon/client';
import { botState, poseFor } from '../bots/poseFor';
import { layout, slotSizes, SIZES, type Layout } from './geometry';
import { createSurfaceController } from './controller';
import type { SurfaceState } from './machine';
import { Handle, type HandleBot } from './Handle';
import { Tooltip } from './Tooltip';
import { Bubble } from './Bubble';
import { SessionList, rowHint } from './SessionList';
import { SessionView, measureSessionH } from './SessionView';
import { transition, MOTION, ms } from '../motion';
import { setFrame, focusTerminal } from '../tauri/bridge';

const isPending = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';
const inside = (p: { x: number; y: number } | null, g: Layout) => p !== null && p.x >= 0 && p.x < g.w && p.y >= g.top && p.y < g.top + g.h;

export function Surface({ screenH, theme, client, dnd, onToggleDnd }: { screenH: number; theme: 'dark' | 'light'; client: DaemonClient; dnd: boolean; onToggleDnd: () => void }) {
  const { sessions, byId, status, previews } = useDaemon();
  const [ctl] = useState(() => createSurfaceController({ onState: s => setSt(s) }));
  const [st, setSt] = useState<SurfaceState>(() => ctl.state());
  const dispatch = ctl.dispatch;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const prevPending = useRef<Set<string>>(new Set());
  const prevIds = useRef<Set<string>>(new Set());
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => ctl.dispose(), [ctl]);

  // Daemon changes drive the machine. DND keeps the bot growing in the handle but never asks for a bubble.
  useEffect(() => {
    const ids = new Set(sessions.map(s => s.id));
    const pend = new Set(sessions.filter(isPending).map(s => s.id));
    for (const id of prevIds.current) if (!ids.has(id)) dispatch({ type: 'removed', id, remaining: [...ids] });
    for (const id of pend) if (!prevPending.current.has(id) && !dnd) dispatch({ type: 'ask', id });
    for (const id of prevPending.current) if (!pend.has(id) && ids.has(id)) dispatch({ type: 'askCleared', id });
    prevIds.current = ids; prevPending.current = pend;
  }, [sessions, dnd, dispatch]);

  // DND switched on takes any bubble down and drops queued asks. Turning it off does not re-bubble asks already pending.
  useEffect(() => { if (dnd) dispatch({ type: 'dnd', on: true }); }, [dnd, dispatch]);

  // A hidden document holds the bubble clock.
  useEffect(() => {
    const sync = () => dispatch({ type: 'visibility', hidden: document.hidden });
    if (document.hidden) sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [dispatch]);

  // The last known pointer position, to tell whether the surface shrank out from under it.
  useEffect(() => {
    const track = (e: PointerEvent | MouseEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    document.addEventListener('pointermove', track); document.addEventListener('mousemove', track);
    return () => { document.removeEventListener('pointermove', track); document.removeEventListener('mousemove', track); };
  }, []);

  const bots: HandleBot[] = useMemo(() => sessions.map(s => ({ id: s.id, name: s.name, tool: s.tool, state: botState(s), pose: poseFor(s.id, s.state), pending: isPending(s), readOnly: s.source === 'hook_only', tip: isPending(s) ? `${botState(s) === 'question' ? 'has a question' : 'needs your approval'} · ${s.pending?.text ?? ''}` : rowHint(s) })), [sessions]);
  const selected = st.selectedId ? byId.get(st.selectedId) ?? null : null;
  const bubbleSession = st.bubbleId ? byId.get(st.bubbleId) ?? null : null;
  const geo = layout({ bots: bots.map(b => ({ id: b.id, pending: b.pending })), mode: st.mode, screenH, bubbleId: st.bubbleId, sessionH: selected ? measureSessionH(selected, st.reading) : 480, reading: st.reading });

  // Grow when the area grows, shrink otherwise; remembered per area so unrelated re-renders keep the direction.
  const areaNow = geo.w * geo.h;
  const [dir, setDir] = useState({ area: areaNow, growing: true });
  if (dir.area !== areaNow) setDir({ area: areaNow, growing: areaNow > dir.area });
  const growing = dir.area === areaNow ? dir.growing : areaNow > dir.area;

  useEffect(() => { setFrame({ top: geo.top, w: Math.max(geo.w, 360), h: geo.h }); }, [geo.top, geo.w, geo.h]);

  // The machine's hover and focus facts are sticky: when the surface changes shape (close, shortcut, fold, back)
  // the pointer may no longer be over it without any mouseleave, and focus may sit in a layer that just went inert.
  useEffect(() => {
    const s = ctl.state();
    if (s.hovering && !inside(pointer.current, geo)) dispatch({ type: 'surfaceLeave' });
    if (s.focusWithin) {
      const a = document.activeElement;
      if (!a || !surfaceRef.current?.contains(a) || a.closest('[inert]')) dispatch({ type: 'focusWithin', on: false });
    }
  }, [st.mode, geo.top, geo.w, geo.h, ctl, dispatch]);

  const onBlur = (e: FocusEvent) => { if (!surfaceRef.current?.contains(e.relatedTarget as Node | null)) dispatch({ type: 'focusWithin', on: false }); };
  const onMouseMove = () => { if (!ctl.state().hovering) dispatch({ type: 'surfaceEnter' }); };

  const { big } = slotSizes(bots.length);
  const hovBot = bots.find(b => b.id === hoverId) ?? null;
  const hovSlot = geo.slots.find(s => s.id === hoverId);
  const panel = st.mode === 'list' || st.mode === 'session';
  const unreachable = status === 'unreachable';
  const bubblePaused = st.hovering || st.focusWithin || st.hidden || st.ack !== null;
  const send = (m: Parameters<DaemonClient['send']>[0]) => client.send(m);
  const decide = (id: string, d: 'accept' | 'deny') => send({ type: 'session.decide', id, decision: d });
  const reply = (id: string, text: string) => { send({ type: 'session.reply', id, text }); setDrafts(x => ({ ...x, [id]: '' })); dispatch({ type: 'typing', on: false }); };
  const motion = growing ? MOTION.grow : MOTION.shrink;
  const delay = growing ? 0 : MOTION.shrink.delayMs;

  return (
    <>
      {geo.hotZones.map((z, i) => <div key={i} data-hotzone onMouseEnter={() => dispatch({ type: 'edgeEnter' })} onMouseLeave={() => dispatch({ type: 'edgeLeave' })} style={{ position: 'absolute', left: 0, top: z.top, width: 14, height: z.h, pointerEvents: st.mode === 'handle' && !unreachable ? 'auto' : 'none', background: st.hot ? 'var(--edge-hot)' : 'transparent', transition: transition([['background-color', 'hover']]) }} />)}

      <div ref={surfaceRef} data-surface data-mode={st.mode}
        onMouseEnter={() => dispatch({ type: 'surfaceEnter' })} onMouseLeave={() => dispatch({ type: 'surfaceLeave' })} onMouseMove={onMouseMove}
        onFocus={() => { if (!ctl.state().focusWithin) dispatch({ type: 'focusWithin', on: true }); }} onBlur={onBlur}
        style={{ position: 'absolute', left: 0, top: geo.top, width: geo.w, height: geo.h, boxSizing: 'border-box', overflow: 'hidden', background: 'var(--sidebar)', color: 'var(--sidebar-foreground)', border: '1px solid var(--sidebar-border)', borderLeft: 'none', borderRadius: '0 var(--radius-xl) var(--radius-xl) 0', boxShadow: 'var(--shadow-overlay)', opacity: unreachable ? 0.6 : 1, willChange: 'top, width, height',
          transition: ['top', 'width', 'height'].map(p => `${p} ${ms(motion.ms)} ${motion.ease} ${ms(delay)}`).join(', ') + `, opacity ${ms(150)} ease-out` }}>
        <Handle bots={bots} slots={geo.slots} big={big} visible={st.mode === 'handle'} hoverId={hoverId} onHover={setHoverId} onOpen={id => dispatch({ type: 'botClick', id })} theme={theme} />
        <Bubble session={bubbleSession} moreCount={Math.max(0, st.queue.length - 1)} visible={st.mode === 'bubble'} paused={bubblePaused} onOpen={() => dispatch({ type: 'bubbleClick' })}
          onDecide={d => { if (st.bubbleId) { decide(st.bubbleId, d); dispatch({ type: 'decidedInBubble' }); } }}
          onReply={t => { if (st.bubbleId) { send({ type: 'session.reply', id: st.bubbleId, text: t }); dispatch({ type: 'decidedInBubble' }); } }} theme={theme} />
        <div data-panel style={{ position: 'absolute', inset: 0, opacity: panel ? 1 : 0, pointerEvents: panel ? 'auto' : 'none', transition: transition([['opacity', panel ? 'fadeIn' : 'fadeOut', panel ? 120 : 0]]) }}>
          <div aria-hidden={st.mode !== 'list' || undefined} style={{ position: 'absolute', inset: 0, transform: `translateX(${st.mode === 'session' ? -12 : 0}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            <SessionList sessions={sessions} visible={st.mode === 'list'} numbered={st.openedBy === 'keyboard'} selectedId={st.selectedId} dnd={dnd} onToggleDnd={onToggleDnd} onOpen={id => dispatch({ type: 'rowClick', id })} onClose={() => dispatch({ type: 'close' })} theme={theme} />
          </div>
          <div aria-hidden={st.mode !== 'session' || undefined} style={{ position: 'absolute', inset: 0, transform: `translateX(${st.mode === 'session' ? 0 : 12}px)`, transition: transition([['transform', 'grow', 0]]) }}>
            {selected && <SessionView session={selected} preview={previews.get(selected.id) ?? []} visible={st.mode === 'session'} reading={st.reading} draft={drafts[selected.id] ?? ''}
              onDraft={t => { setDrafts(x => ({ ...x, [selected.id]: t })); dispatch({ type: 'typing', on: t.length > 0 }); }}
              onBack={() => dispatch({ type: 'back' })} onClose={() => dispatch({ type: 'close' })} onDecide={d => decide(selected.id, d)} onReply={t => reply(selected.id, t)}
              onInterrupt={() => send({ type: 'session.interrupt', id: selected.id })} onKill={() => send({ type: 'session.kill', id: selected.id })}
              onFocus={() => { send({ type: 'session.focus', id: selected.id }); void focusTerminal(selected.title); }} onToggleReading={() => dispatch({ type: 'reading', on: !st.reading })} theme={theme} />}
          </div>
        </div>
      </div>

      <Tooltip bot={st.mode === 'handle' ? hovBot : null} y={hovSlot?.center ?? geo.top} />
      {unreachable && <div role="status" style={{ position: 'absolute', left: Math.max(geo.w, SIZES.handleW) + 8, top: geo.top, fontSize: 12, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>daemon unreachable, retrying</div>}
    </>
  );
}
