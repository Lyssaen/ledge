import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Exchange, OpenRigStatus, Rig, Session } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import type { AtelierScene } from '@ledge/ui/rigs/scene';
import { seatAt, seatSession, type Arc } from '@ledge/ui/rigs/model';
import { botState } from '@ledge/ui/bots/poseFor';
import { LogoBot } from '@ledge/ui/bots/LogoBot';
import { LedgeSketch } from '@ledge/ui/bots/LedgeSketch';
import { useTheme } from '../../shell/theme';
import { useMotionPreferences } from '../../motionPreferences';
import { helperState } from '../layout';
import { peerIdOf } from '../MessageLayer';
import { EXT, layout, ROOM_HEIGHT, type Room, type Team } from './layout';
import { buildWorld, route, usePresence, type Presence } from './presence';
import geometry from './offices.json';
import '@ledge/ui/bots/bots.css';
import '@ledge/ui/bots/logo-bot.css';
import '@ledge/ui/bots/ledge-sketch.css';
import './office-floor.css';

type Point = { x: number; y: number };
type Variant = { file: string; table_file?: string; front_file?: string; w: number; table?: number[]; seats?: { t: Point[]; b: Point[] }; ends?: (Point & { end: string })[]; racks?: (Point & { w: number; h: number })[] };
type Geometry = { sizes: Record<string, { variants: Record<string, Variant> }>; rest: Record<string, { variants: Record<string, Variant> }>; tech: { variants: Record<string, Variant> }; ledge: { file: string; desk_file: string; ledge: Point & { size: number } } };
const GEO = geometry as Geometry;
const present = (s: Session) => !s.offline && s.state !== 'exited';
const styleAt = (x: number, y: number, w?: number): React.CSSProperties => ({ left: x, top: y, ...(w === undefined ? {} : { width: w }) });
const fileFor = (room: Room): Variant | null => room.size === 'ledge' ? null : room.size === 'tech' ? GEO.tech.variants[room.door] ?? null : GEO.rest[room.size]?.variants[`${room.door}-${room.win ? 'win' : 'wall'}`] ?? GEO.sizes[room.size]?.variants[`${room.door}-${room.win ? 'win' : 'wall'}`] ?? null;
const stateRank = (s: Session) => s.state === 'waiting_permission' ? 0 : s.state === 'waiting_input' ? 1 : s.state === 'working' ? 2 : s.state === 'starting' ? 3 : 4;

/** Sprite room with layered bots and a keyboard accessible button for each live session. */
type Core = { machine: string; state: OpenRigStatus['state'] };
function OfficeRoom({ room, byId, presence, visiting, cores, theme, reduced, onOpen, onMenu, onChat }: { room: Room; byId: Map<string, Session>; presence: ReadonlyMap<string, Presence>; visiting: ReadonlySet<string>; cores: readonly Core[]; theme: 'dark' | 'light'; reduced: boolean; onOpen(id: string): void; onMenu(session: Session, event: MouseEvent<HTMLElement>): void; onChat(): void }) {
  const src = (name: string) => `/offices/${theme === 'dark' ? 'night' : 'day'}/${name}`;
  const base = styleAt(EXT + room.x, room.y);
  if (room.size === 'ledge') return <div className="bureaux-room bureaux-ledge" style={base}>
    <img src={src(GEO.ledge.file)} alt="" />
    <button type="button" aria-label="Ledge" title="Ledge" onClick={onChat} style={styleAt(GEO.ledge.ledge.x, GEO.ledge.ledge.y)}><LedgeSketch palette="darkred" size={GEO.ledge.ledge.size} theme={theme} label="Ledge" /></button>
    <img className="bureaux-table" src={src(GEO.ledge.desk_file)} alt="" />
    <span className="bureaux-plate">Ledge</span>
  </div>;
  const variant = fileFor(room);
  if (!variant) return null;
  if (room.size === 'tech') {
    const start = Number(room.key.replace('__tech', '')) || 0;
    return <div className="bureaux-room" style={base}><img src={src(variant.file)} alt="" />
      {cores.slice(start, start + 4).map((core, i) => { const rack = variant.racks?.[i]; return rack ? <div key={core.machine} className={`bureaux-rack ${core.state}`} style={styleAt(rack.x, rack.y, rack.w)} title={`${core.machine} · ${core.state}`}><span>{core.machine}</span><i /></div> : null; })}
      <span className="bureaux-plate">OpenRig · Salle technique</span></div>;
  }
  if (room.size === 'rs' || room.size === 'rm' || room.size === 'rl') return <div className="bureaux-room" style={base}><img src={src(variant.file)} alt="" /><span className="bureaux-plate">Repos</span></div>;
  const sessions = room.sessionIds.map(id => byId.get(id)).filter((s): s is Session => !!s && present(s));
  const table = variant.table ?? [0, 96, 0, 40];
  const seats = sessions.map((s, i) => {
    const side = sessions.length === 1 || i % 2 === 0 ? 't' : 'b';
    const p = variant.seats?.[side]?.[Math.floor(i / 2)];
    if (!p) return null;
    const x = p.x - 5.5, y = side === 't' ? table[1]! - 19 : table[1]! + table[3]! - 8;
    const bot = <LogoBot tool={s.tool} state={botState(s)} size={26} theme={theme} seed={s.id} reducedMotion={reduced} branded />;
    return presence.get(s.id)?.at === 'seat' && !visiting.has(s.id) ? <button key={s.id} type="button" className={`bureaux-seat ${side === 'b' ? 'back' : ''}`} data-agent={s.id} aria-label={`${s.name} · ${s.state}`} title={s.name} style={styleAt(x, y)} onClick={() => onOpen(s.id)} onContextMenu={e => onMenu(s, e)}>{bot}<span className="bureaux-name">{s.name}</span></button> : null;
  });
  const led = [...sessions].sort((a, b) => stateRank(a) - stateRank(b))[0];
  return <div className="bureaux-room" style={base}>
    <img src={src(variant.file)} alt="" />
    {seats.filter((_, i) => sessions.length === 1 || i % 2 === 0)}
    {variant.table_file && <img className="bureaux-table" src={src(variant.table_file)} alt="" />}
    {sessions.map((s, i) => { const side = sessions.length === 1 || i % 2 === 0 ? 't' : 'b', p = variant.seats?.[side]?.[Math.floor(i / 2)]; return p ? <img key={s.id} className="bureaux-laptop" src={src(presence.get(s.id)?.at === 'spot' ? 'laptop-closed.png' : side === 't' ? 'laptop-back.png' : `laptop-${s.state === 'waiting_input' ? 'question' : s.state === 'waiting_permission' ? 'approval' : s.state === 'idle' ? 'idle' : 'working'}.png`)} alt="" style={styleAt(p.x - 2, side === 't' ? table[1]! + 2 : table[1]! + table[3]! - 17, 18)} /> : null; })}
    {seats.filter((_, i) => sessions.length !== 1 && i % 2 === 1)}
    {variant.front_file && <img className="bureaux-front" src={src(variant.front_file)} alt="" />}
    {sessions.flatMap(s => s.helpers.filter(h => h.state !== 'exited').map(h => ({ parent: s, helper: h }))).slice(0, 4).map(({ parent, helper }, i) => {
      const end = variant.ends?.filter(e => e.end === (i < 2 ? 'left' : 'right'))[i % 2];
      return end ? <button key={`${parent.id}:${helper.id}`} type="button" className="bureaux-helper" title={`${helper.kind} · ${parent.name}`} aria-label={`${helper.kind} · sous-agent de ${parent.name}`} style={styleAt(end.x - 1, end.y - 6)} onClick={() => onOpen(parent.id)}><LogoBot tool={parent.tool} state={helperState(helper)} size={18} theme={theme} seed={`${parent.id}:${helper.id}`} reducedMotion={reduced} branded /></button> : null;
    })}
    <span className={`bureaux-plate ${led?.state ?? ''}`} style={{ top: room.door === 'S' ? ROOM_HEIGHT + 4 : -23 }}>{room.name} · {sessions.length}</span>
  </div>;
}

function Visitor({ session, path, theme, reduced, onOpen }: { session: Session; path: readonly { x: number; y: number }[]; theme: 'dark' | 'light'; reduced: boolean; onOpen(): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const pathKey = path.map(p => `${p.x},${p.y}`).join(';');
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || path.length < 2) return;
    const travel = [...path, ...[...path].reverse()];
    const animation = el.animate(travel.map((p, i) => ({ left: `${p.x - 13}px`, top: `${p.y - 26}px`, offset: i / (travel.length - 1) })), { duration: 5000, fill: 'both', easing: 'linear' });
    return () => animation.cancel();
  }, [pathKey, reduced]);
  const first = path[0] ?? { x: 0, y: 0 };
  return <button ref={ref} type="button" className="bureaux-walker bureaux-visitor" data-agent={session.id} style={styleAt(first.x - 13, first.y - 26)} aria-label={`${session.name} · en visite`} onClick={onOpen}><LogoBot tool={session.tool} state={botState(session)} size={26} theme={theme} seed={session.id} reducedMotion={reduced} branded /></button>;
}

export function OfficeFloor({ client, scene, sessions, rigs = [], exchanges = new Map(), arcs = [], cores, onOpen, onMenu, onChat, viewportWidth }: { client?: DaemonClient; scene: AtelierScene; sessions: readonly Session[]; rigs?: readonly Rig[]; exchanges?: ReadonlyMap<string, readonly Exchange[]>; arcs?: readonly Arc[]; cores: readonly Core[]; onOpen(id: string): void; onMenu(session: Session, event: MouseEvent<HTMLElement>): void; onChat(): void; viewportWidth: number }) {
  const theme = useTheme(), { reduced } = useMotionPreferences();
  const [now, setNow] = useState(Date.now());
  const [thoughts, setThoughts] = useState<Map<string, { text: string; seen: number }>>(new Map());
  const [focusOnly, setFocusOnly] = useState(false);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => client?.onMessage(m => {
    if (m.type !== 'session.thought') return;
    setThoughts(previous => new Map(previous).set(m.id, { text: m.text, seen: Date.now() }));
    window.setTimeout(() => setThoughts(previous => { const next = new Map(previous); if (next.get(m.id)?.text === m.text) next.delete(m.id); return next; }), 10_000);
  }), [client]);
  const byId = useMemo(() => new Map([...sessions, ...scene.rooms.flatMap(r => r.tables.flatMap(t => t.mains))].map(s => [s.id, s])), [sessions, scene]);
  const allSessions = useMemo(() => [...byId.values()], [byId]);
  const botCount = allSessions.filter(present).reduce((n, s) => n + 1 + s.helpers.filter(h => h.state !== 'exited').length, 0);
  const teams: Team[] = [...scene.rooms.filter(r => r.kind !== 'kernel').map(r => ({ id: r.key, name: r.kind === 'project' ? r.project.name : r.rig.name, kind: r.kind as 'project' | 'rig', sessionIds: r.tables.flatMap(t => t.mains).filter(present).map(s => s.id) })), { id: '__loose', name: 'Sans projet', kind: 'none', sessionIds: scene.unassigned.filter(present).map(s => s.id) }];
  const restNeed = sessions.filter(s => present(s) && s.state === 'idle' && now - Date.parse(s.lastActivityAt) >= 300_000).length;
  const scale = Math.min(4, Math.max(1, Math.round(Math.max(320, viewportWidth) / 640)));
  const bw = Math.max(444, Math.floor(Math.max(320, viewportWidth) / scale) - 2 * EXT);
  const floor = useMemo(() => layout(bw, teams, cores.length, restNeed), [bw, scene, cores.length, restNeed]);
  const presence = usePresence(floor, allSessions, now, reduced || botCount > 40);
  const world = useMemo(() => buildWorld(floor), [floor]);
  const messages = allSessions.flatMap(s => s.lastMessage && now - Date.parse(s.lastMessage.at) < 5000 && peerIdOf(s) ? [{ id: s.lastMessage.id, fromId: s.id, toId: peerIdOf(s)!, text: s.lastMessage.summary, kind: 'message' as const }] : []);
  const visits = [...messages, ...arcs].filter(x => x.kind !== 'ledge' && world.seats.has(x.fromId) && world.seats.has(x.toId)).slice(0, 2);
  const invitations = [...exchanges.values()].flat().filter(e => e.kind === 'ledge' && now - Date.parse(e.at) < 5000).flatMap(e => {
    const rig = rigs.find(r => r.machine === e.machine && r.id === e.rigId);
    const seat = rig && seatAt([rig], e.machine, e.rigId, e.to);
    const room = scene.rooms.find(r => r.kind === 'rig' && r.rig.machine === e.machine && r.rig.id === e.rigId);
    const s = seat && rig ? room?.tables[0].mains.find(s => s.rig?.seat === seat.ref) ?? seatSession(seat, rig, byId) : undefined;
    return s && world.seats.has(s.id) && world.guests[0] ? [{ id: e.id, session: s, from: world.seats.get(s.id)!, to: world.guests[0], text: e.text }] : [];
  }).slice(0, 2);
  const visiting = new Set(reduced || botCount > 40 ? [] : [...visits.map(v => v.fromId), ...invitations.map(v => v.session.id)]);
  const attention = floor.rooms.filter(r => r.sessionIds.some(id => { const s = byId.get(id); return s?.state === 'waiting_permission' || s?.state === 'waiting_input'; }));
  const following = attention.length ? attention : floor.rooms.filter(r => r.sessionIds.some(id => byId.get(id)?.state === 'working'));
  const followKeys = new Set(['__ledge', ...following.map(r => r.key)]);
  const bubbleRooms = floor.rooms.filter(r => r.sessionIds.length).map(r => {
    const priority = r.sessionIds.map(id => byId.get(id)).filter((s): s is Session => !!s && present(s)).sort((a, b) => stateRank(a) - stateRank(b));
    const session = priority.find(s => s.pending || thoughts.has(s.id) || s.lastMessage || s.lastReply);
    const raw = session?.pending?.text ?? (session && thoughts.get(session.id)?.text)
      ?? (session?.lastMessage && now - Date.parse(session.lastMessage.at) < 10_000 ? session.lastMessage.summary : undefined)
      ?? (session?.lastReply && now - Date.parse(session.lastReply.at) < 10_000 ? session.lastReply.text : undefined);
    return raw ? { room: r, text: raw.replace(/\s+/g, ' ').slice(0, 80), urgent: !!session?.pending } : null;
  }).filter((x): x is { room: Room; text: string; urgent: boolean } => !!x).slice(0, 3);
  return <div className={`bureaux-floor ${theme}`} style={{ width: floor.width * scale, height: floor.height * scale }}>
    {botCount > 40 && <div className="bureaux-performance" role="status">{botCount} bots · Les animations peuvent ralentir. <button type="button" aria-pressed={focusOnly} onClick={() => setFocusOnly(v => !v)}>{focusOnly ? 'Tout voir' : 'Voir les salles à suivre'}</button></div>}
    <div className="bureaux-plan" style={{ width: floor.width, height: floor.height, transform: `scale(${scale})` }}>
    {floor.corridors.map(c => <div key={c.wing} className="bureaux-corridor" style={{ top: c.y, width: floor.width, height: 60 }}>
      <img src={`/offices/${theme === 'dark' ? 'night' : 'day'}/plant.png`} alt="" style={{ left: 18, top: 15, width: 28 }} />
      <img src={`/offices/${theme === 'dark' ? 'night' : 'day'}/bench.png`} alt="" style={{ left: Math.max(70, floor.width - 90), top: 33, width: 44 }} />
      {Array.from({ length: Math.max(0, Math.floor((floor.width - 100) / 80)) }, (_, i) => <i key={i} className="bureaux-lamp" style={{ left: 90 + i * 80 }} />)}
    </div>)}
    {floor.zones.map(z => <img key={z.id} className="bureaux-zone" src={`/offices/${theme === 'dark' ? 'night' : 'day'}/zone-${z.kind}.png`} alt="" style={styleAt(EXT + z.x, z.y)} />)}
    {floor.rooms.map(r => <div key={r.key} className={focusOnly && !followKeys.has(r.key) ? 'bureaux-dim' : undefined}><OfficeRoom room={r} byId={byId} presence={presence} visiting={visiting} cores={cores} theme={theme} reduced={reduced} onOpen={onOpen} onMenu={onMenu} onChat={onChat} /></div>)}
    {!reduced && botCount <= 40 && visits.map(v => { const s = byId.get(v.fromId), from = world.seats.get(v.fromId), to = world.seats.get(v.toId); return s && from && to ? <Visitor key={v.id} session={s} path={route(from, to)} theme={theme} reduced={reduced} onOpen={() => onOpen(s.id)} /> : null; })}
    {!reduced && botCount <= 40 && invitations.map(v => <Visitor key={v.id} session={v.session} path={route(v.from, v.to)} theme={theme} reduced={reduced} onOpen={() => onOpen(v.session.id)} />)}
    {invitations.length > 0 && <div className="bureaux-bubble bureaux-ledge-bubble" style={styleAt(EXT + (floor.rooms.find(r => r.size === 'ledge')?.x ?? 44) + 15, 16)}>{invitations[0]!.text.slice(0, 80)}</div>}
    {bubbleRooms.map(b => <div key={b.room.key} className={`bureaux-bubble ${b.urgent ? 'urgent' : ''}`} style={styleAt(EXT + b.room.x + 20, b.room.y + 8)}>{b.text}</div>)}
    {[...presence].filter(([, p]) => p.at !== 'seat').map(([id, p]) => { const s = byId.get(id); return s ? <button key={id} type="button" className="bureaux-walker" data-agent={id} style={styleAt(p.x - 13, p.y - 26)} aria-label={`${s.name} · ${p.at === 'spot' ? 'au repos' : 'en marche'}`} onClick={() => onOpen(id)}><LogoBot tool={s.tool} state={botState(s)} size={26} theme={theme} seed={id} reducedMotion={reduced} branded /></button> : null; })}
  </div></div>;
}
