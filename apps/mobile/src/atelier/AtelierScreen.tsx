// The Atelier tab on iPad (docs/mockups/ledge-ipad-atelier.html, validated with choice A): a compact head, then Ledge Desktop's
// Atelier fitted readable; a tap on an agent opens its session in a panel over it (on the right in landscape, from the bottom
// in portrait), a room's name its sheet.
import { useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BROADCAST_SESSIONS_MAX, PROJECT_COLORS, type PhoneProject } from '@ledge/protocol';
import { roomTileWidth, rigColor, sceneOf, IPAD_RUG_SIDE, MAX_SEATS, type AtelierScene } from '@ledge/ui/atelier/layout';
import { copy } from '../copy';
import { navigate, replaceRoute } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { sessionStatus } from '../model/agents';
import { GroupWrite } from '../screens/Agents';
import { RequestDetail } from '../screens/RequestDetail';
import { Thread } from '../screens/Thread';
import { HostPill, LinkStrip } from '../shell/Shell';
import { MobileBot } from '../ui/MobileBot';
import { Tag } from '../ui/Tag';
import { iconButtonClass } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Icon as LineIcon } from '@ledge/ui/ui/icons';
import { LedgeDesk, Legend, Room, Table, Unassigned, type AtelierPhone, type SceneActions } from './Scene';
import { orientOf, waitingOf } from './fit';
import { useIpadView } from './useIpadView';

const EXPAND = ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'];
/** How far the panel is pulled (towards its edge) before it closes. */
const SWIPE_CLOSE = 80;

/** The panel over the Atelier: its grabber, and a swipe towards its edge (down in portrait, right in landscape) closes it. */
function Panel({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const pull = useRef<{ x: number; y: number; id: number; land: boolean } | null>(null);
  const [shift, setShift] = useState(0);
  const start = (e: ReactPointerEvent<HTMLElement>) => {
    const t = e.target as Element;
    // From its head or its grabber only: the thread itself scrolls, its buttons tap.
    if (!t.closest('.atelier-panel-grab, .atelier-panel > header, .atelier-panel header') || t.closest('button,a,textarea,input')) return;
    pull.current = { x: e.clientX, y: e.clientY, id: e.pointerId, land: orientOf({ width: globalThis.innerWidth, height: globalThis.innerHeight }) === 'land' };
    ref.current?.setPointerCapture?.(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    setShift(Math.max(0, p.land ? e.clientX - p.x : e.clientY - p.y));
  };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const p = pull.current;
    if (!p || p.id !== e.pointerId) return;
    pull.current = null;
    const d = p.land ? e.clientX - p.x : e.clientY - p.y;
    setShift(0);
    if (d > SWIPE_CLOSE) onClose();
  };
  return (
    <aside ref={ref} className="atelier-panel" aria-label={label} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      style={shift ? { ['--pull' as string]: `${shift}px` } : undefined}>
      <div className="atelier-panel-grab" aria-hidden="true" />
      {children}
    </aside>
  );
}

/** A room's sheet: its agents (a tap opens one) and « Écrire au groupe », the phone's broadcast (by ids). */
function RoomSheet({ store, name, ids, onOpen, onClose }: { store: MobileStore; name: string; ids: string[]; onOpen(id: string): void; onClose(): void }): JSX.Element {
  const state = useMobile(store);
  const offline = !state.fresh;
  const sessions = ids.map(id => state.sessions.get(id)).filter(s => s !== undefined);
  const live = sessions.filter(s => s.state !== 'exited').map(s => s.id);
  return (
    <Panel label={copy.atelier.room(name)} onClose={onClose}>
      <header className="flex flex-none items-center gap-2.5 border-b border-line pt-2 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold [overflow-wrap:anywhere]">{name}</h1>
          <p className="mt-[3px] text-meta text-muted">{copy.atelier.roomAgents(sessions.length)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={copy.atelier.closePanel} title={copy.atelier.closeTitle} className={iconButtonClass({})}><Icon name="close" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {sessions.map(s => (
          <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 border-b border-line py-3 text-left active:bg-raised/60">
            <MobileBot tool={s.tool} seed={s.id} state={s.state} frozen={offline} />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">{s.name}</span>
              <span className="block truncate text-meta text-muted">{s.rig?.role ?? s.topic ?? s.branch ?? s.title}</span>
            </span>
            <Tag {...sessionStatus(s)} />
          </button>
        ))}
        {state.daemon?.broadcast && live.length > 0 && (
          <div className="pt-4">
            {live.length > BROADCAST_SESSIONS_MAX
              ? <p className="text-meta text-attention">{copy.agents.tooMany(live.length, BROADCAST_SESSIONS_MAX)}</p>
              : <GroupWrite store={store} label={name} ids={live} offline={offline} />}
          </div>
        )}
      </main>
    </Panel>
  );
}

/** The room a sheet is about, by its id in the scene: its name and its sessions. */
function roomOf(scene: AtelierScene<AtelierPhone, PhoneProject>, id: string): { name: string; ids: string[] } | null {
  const room = scene.rooms.find(r => r.project.id === id);
  if (!room) return null;
  return { name: room.rig?.kind === 'kernel' ? copy.atelier.kernel : room.project.name, ids: room.tables.flatMap(t => t.mains.map(s => s.id)) };
}

export function AtelierScreen({ store, sessionId, requestKey, storage, onReconnect }: { store: MobileStore; sessionId?: string; requestKey?: string; storage?: Storage; onReconnect?: () => void }): JSX.Element {
  const state = useMobile(store);
  const offline = !state.fresh;
  const sessions = useMemo(() => [...state.sessions.values()], [state.sessions]);
  // A rig's plaque names its first seat's folder: the phone knows only the folder's name.
  const order = useMemo<AtelierPhone[]>(() => sessions.map(s => ({ ...s, cwd: s.project })), [sessions]);
  const scene = useMemo(() => sceneOf<AtelierPhone, PhoneProject>(order, state.projects, s => s.projectId ?? null, 'all', true,
    ({ id, name, kind }) => ({ id, name, color: rigColor(kind) })), [order, state.projects]);
  const [sheet, setSheet] = useState<string | null>(null);
  const view = useIpadView([scene, offline]);

  const open = (id: string) => {
    setSheet(null);
    // Another agent while one is open: the panel changes, no new step back.
    if (sessionId) replaceRoute({ name: 'atelier', sessionId: id }); else navigate({ name: 'atelier', sessionId: id });
  };
  const close = () => replaceRoute({ name: 'atelier' });
  const act: SceneActions = { open, room: id => { if (sessionId) close(); setSheet(id); }, chat: () => navigate({ name: 'chat' }) };

  const live = sessions.filter(s => s.state !== 'exited').length;
  const waiting = sessions.filter(waitingOf).length;
  const subtitle = `${offline ? `${copy.agents.offline} · ` : ''}${copy.atelier.subtitle(live, scene.rooms.length, waiting)}`;
  const room = sheet ? roomOf(scene, sheet) : null;
  const shown = sessionId ? state.sessions.get(sessionId) : undefined;

  return (
    <>
      <div className="atelier-col">
        <header className="flex flex-none items-center gap-3 pt-3 pb-3">
          <h1 className="text-title font-semibold tracking-[-.3px]">{copy.atelier.title}</h1>
          <span className="min-w-0 truncate text-meta text-muted">{subtitle}</span>
          <span className="flex-1" />
          <HostPill />
        </header>
        <div className="mb-3 flex-none empty:hidden"><LinkStrip /></div>
        <div className={`atelier-ipad${offline ? ' atelier-frozen' : ''}`}>
          <div className="zoom-controls" role="toolbar" aria-label={copy.atelier.zoom.bar}>
            <button type="button" className="ledge-btn" data-variant="ghost" aria-label={copy.atelier.zoom.out} onClick={() => view.step(-1)}>−</button>
            <button type="button" className="zoom-level" aria-label={copy.atelier.zoom.reset} onClick={() => view.zoomTo(1)}>{copy.percent(Math.round(view.zoom * 100))}</button>
            <button type="button" className="ledge-btn" data-variant="ghost" aria-label={copy.atelier.zoom.in} onClick={() => view.step(1)}>+</button>
            <span className="zoom-sep" />
            <button type="button" className="ledge-btn zoom-fit" data-variant={view.fitted ? 'secondary' : 'ghost'} aria-pressed={view.fitted} title={copy.atelier.zoom.fitTitle} onClick={view.fit}>
              <LineIcon d={EXPAND} size={13} />{copy.atelier.zoom.fit}
            </button>
          </div>
          <div className="overview-scroll atelier" role="region" aria-label={copy.atelier.region} ref={view.scrollRef}>
            <div className="atelier-floor">
              <div ref={view.shellRef} className={`office-shell${offline ? ' office-paused' : ''}`}>
                <LedgeDesk count={live} frozen={offline} {...(state.device?.chat ? { onOpen: act.chat } : {})} />
                <div className={`project-grid ${scene.rooms.length === 1 ? 'focused' : ''}`}>
                  {scene.rooms.map(({ project, tables, rig }) => (
                    <Room key={project.id} project={project} tables={tables} {...(rig ? { rig } : {})} width={roomTileWidth(tables, MAX_SEATS, IPAD_RUG_SIDE)} act={act}>
                      {tables.map(table => <Table key={table.key} table={table} project={project} color={PROJECT_COLORS[project.color]} frozen={offline} act={act} />)}
                    </Room>
                  ))}
                </div>
                <Unassigned sessions={scene.unassigned} frozen={offline} act={act} />
              </div>
            </div>
            <Legend />
          </div>
        </div>
      </div>
      {sessionId && (
        <Panel label={copy.atelier.session(shown?.name ?? '')} onClose={close}>
          {requestKey
            ? <RequestDetail key={`${sessionId}:request`} store={store} sessionId={sessionId} requestKey={requestKey} onReconnect={onReconnect}
                panel={{ onBack: () => replaceRoute({ name: 'atelier', sessionId }), onClose: close }} />
            : <Thread key={sessionId} store={store} sessionId={sessionId} storage={storage} onReconnect={onReconnect} panel={{ onClose: close }} />}
        </Panel>
      )}
      {!sessionId && room && sheet && <RoomSheet store={store} name={room.name} ids={room.ids} onOpen={open} onClose={() => setSheet(null)} />}
    </>
  );
}
