import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@ledge/protocol';
import type { FloorLayout } from './layout';
import geometry from './offices.json';

type Point = { x: number; y: number };
type Place = { feet: Point; corY: number; approach: Point[] };
export type Presence = { at: 'seat' | 'spot' | 'walk'; x: number; y: number; spotId?: string; path?: Point[]; step?: number; dest?: 'seat' | 'spot' | 'exit' };
type World = { seats: Map<string, Place>; spots: Map<string, Place>; guests: Place[]; entrance: Place };
const GEO = geometry as unknown as { sizes: Record<string, { variants: Record<string, { door: { x: number }; table: number[]; seats: { t: Point[]; b: Point[] } }> }>; rest: Record<string, { variants: Record<string, { door: { x: number }; spots: Point[] }> }>; zones: Record<string, { spots: Point[] }>; ledge: { door: { x: number }; guests: Point[] } };
const SPINE_X = 31, BOT = 26;
export function buildWorld(floor: FloorLayout): World {
  const seats = new Map<string, Place>(), spots = new Map<string, Place>(), guests: Place[] = [];
  const corY = floor.corridors[0]?.y ?? 201;
  const entrance: Place = { feet: { x: -10, y: corY + 30 }, corY: corY + 30, approach: [{ x: 15, y: corY + 30 }, { x: -10, y: corY + 30 }] };
  for (const room of floor.rooms) {
    if (room.size === 'ledge') {
      const doorX = 9 + room.x + GEO.ledge.door.x + 14;
      for (const g of GEO.ledge.guests) { const feet = { x: 9 + room.x + g.x, y: room.y + g.y }; guests.push({ feet, corY: room.corY, approach: [{ x: doorX, y: room.corY }, { x: doorX, y: room.y + 172 }, feet] }); }
      continue;
    }
    if (room.size === 'tech') continue;
    const key = `${room.door}-${room.win ? 'win' : 'wall'}`, x0 = 9 + room.x;
    const rest = GEO.rest[room.size]?.variants[key];
    if (rest) {
      const doorX = x0 + rest.door.x + 14;
      rest.spots.forEach((p, i) => { const feet = { x: x0 + p.x, y: room.y + p.y }; spots.set(`${room.key}:${i}`, { feet, corY: room.corY, approach: [{ x: doorX, y: room.corY }, { x: doorX, y: feet.y }, feet] }); });
      continue;
    }
    const v = GEO.sizes[room.size]?.variants[key];
    if (!v) continue;
    const doorX = x0 + v.door.x + 14;
    room.sessionIds.forEach((id, i) => {
      const side = room.sessionIds.length === 1 || i % 2 === 0 ? 't' : 'b';
      const p = v.seats[side][Math.floor(i / 2)]; if (!p) return;
      const feet = { x: x0 + p.x + 7.5, y: room.y + (side === 't' ? v.table[1]! - 19 : v.table[1]! + v.table[3]! - 8) + BOT };
      seats.set(id, { feet, corY: room.corY, approach: [{ x: doorX, y: room.corY }, { x: doorX, y: room.y + (room.door === 'S' ? 172 : 20) }, { x: feet.x, y: feet.y }, feet] });
    });
  }
  for (const z of floor.zones) for (const [i, p] of (GEO.zones[z.kind]?.spots ?? []).entries()) {
    const feet = { x: 9 + z.x + p.x, y: z.y + p.y };
    spots.set(`${z.id}:${i}`, { feet, corY: z.corY, approach: [{ x: feet.x, y: z.corY }, feet] });
  }
  return { seats, spots, guests, entrance };
}
export function route(a: Place, b: Place): Point[] {
  const back = [...a.approach].reverse();
  return [...back, ...(a.corY === b.corY ? [] : [{ x: SPINE_X, y: a.corY }, { x: SPINE_X, y: b.corY }]), ...b.approach];
}
const dueRest = (s: Session, now: number) => s.state === 'idle' && now - Date.parse(s.lastActivityAt) >= 300_000;
/** Live positions. The first snapshot seats agents immediately; later changes follow corridors and doors. */
export function usePresence(floor: FloorLayout, sessions: readonly Session[], now: number, instant: boolean): ReadonlyMap<string, Presence> {
  const world = useMemo(() => buildWorld(floor), [floor]);
  const worldRef = useRef(world), positions = useRef(new Map<string, Presence>()), booted = useRef(false);
  const [, repaint] = useState(0);
  useEffect(() => {
    const previous = worldRef.current; worldRef.current = world;
    const wanted = sessions.filter(s => !s.offline && s.state !== 'exited' && world.seats.has(s.id));
    const taken = new Set([...positions.current.values()].map(p => p.spotId).filter((s): s is string => !!s));
    const free = () => [...world.spots.keys()].find(id => !taken.has(id));
    const move = (id: string, from: Place, to: Place, dest: Presence['dest'], spotId?: string) => {
      const path = route(from, to), first = path[0] ?? from.feet;
      positions.current.set(id, { at: 'walk', x: first.x, y: first.y, path, step: 0, dest, spotId });
    };
    for (const s of wanted) {
      const seat = world.seats.get(s.id)!, prior = positions.current.get(s.id), rest = dueRest(s, now);
      if (!prior) {
        const spotId = rest ? free() : undefined; if (spotId) taken.add(spotId);
        const dest = spotId ? world.spots.get(spotId)! : seat;
        if (!booted.current || instant) positions.current.set(s.id, { at: spotId ? 'spot' : 'seat', x: dest.feet.x, y: dest.feet.y, spotId });
        else move(s.id, world.entrance, dest, spotId ? 'spot' : 'seat', spotId);
      } else if (prior.at !== 'walk' && prior.at === 'seat' && rest) {
        const spotId = free(); if (!spotId) continue; taken.add(spotId);
        const spot = world.spots.get(spotId)!;
        if (instant) positions.current.set(s.id, { at: 'spot', x: spot.feet.x, y: spot.feet.y, spotId });
        else move(s.id, previous.seats.get(s.id) ?? seat, spot, 'spot', spotId);
      } else if (prior.at !== 'walk' && prior.at === 'spot' && !rest) {
        const from = previous.spots.get(prior.spotId ?? '') ?? world.entrance;
        if (instant) positions.current.set(s.id, { at: 'seat', x: seat.feet.x, y: seat.feet.y });
        else move(s.id, from, seat, 'seat');
      }
    }
    const ids = new Set(wanted.map(s => s.id));
    for (const [id, p] of positions.current) if (!ids.has(id) && p.dest !== 'exit') {
      const from = (p.at === 'spot' ? previous.spots.get(p.spotId ?? '') : previous.seats.get(id)) ?? world.entrance;
      if (instant) positions.current.delete(id); else move(id, from, world.entrance, 'exit');
    }
    booted.current = true; repaint(v => v + 1);
  }, [floor, sessions, now, instant]);
  useEffect(() => {
    if (instant) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const current = performance.now(), dist = Math.min(50, (current - last) * .15); last = current; let changed = false;
      for (const [id, p] of positions.current) {
        if (p.at !== 'walk' || !p.path) continue;
        let left = dist;
        while (left > 0 && p.step! < p.path.length - 1) {
          const target = p.path[p.step! + 1]!, dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
          if (d <= left) { p.x = target.x; p.y = target.y; p.step!++; left -= d; }
          else { p.x += dx / d * left; p.y += dy / d * left; left = 0; }
        }
        if (p.step === p.path.length - 1) { if (p.dest === 'exit') positions.current.delete(id); else { p.at = p.dest!; delete p.path; delete p.step; } }
        changed = true;
      }
      if (changed) repaint(v => v + 1);
    }, 33);
    return () => clearInterval(timer);
  }, [instant]);
  return positions.current;
}
