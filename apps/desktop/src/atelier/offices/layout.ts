/** Pure layout of the Bureaux floor. Coordinates are in sprite pixels. */
export const ROOM_HEIGHT = 192, SPINE = 44, EXT = 9, CORRIDOR = 60;
export type RoomSize = 'ledge' | 'tech' | 's' | 'm' | 'l' | 'o2' | 'o4' | 'o6' | 'rs' | 'rm' | 'rl';
export type Team = { id: string; name: string; kind: 'project' | 'rig' | 'none'; sessionIds: string[] };
export type Room = { key: string; name: string; size: RoomSize; sessionIds: string[]; x: number; y: number; door: 'N' | 'S'; win: boolean; corY: number };
export type Zone = { id: string; kind: string; x: number; y: number; corY: number; capacity: number };
export type FloorLayout = { rooms: Room[]; zones: Zone[]; corridors: { y: number; wing: number }[]; width: number; height: number; wings: number };
const WIDTH: Record<RoomSize, number> = { ledge: 160, tech: 144, s: 176, m: 208, l: 240, o2: 208, o4: 272, o6: 320, rs: 144, rm: 272, rl: 384 };
const REST_CAP: Record<'rs' | 'rm' | 'rl', number> = { rs: 5, rm: 9, rl: 13 };
const ZONES = [ ['lounge', 112, 5], ['cafe', 104, 4], ['games', 112, 4], ['reading', 96, 3] ] as const;
const NOOKS = [ ['nook-coffee', 48, 1], ['nook-chair', 48, 1], ['nook-bench', 56, 2], ['nook-poufs', 56, 2] ] as const;
type Draft = Pick<Room, 'key' | 'name' | 'size' | 'sessionIds'> & { x?: number };
export function roomsOf(team: Team): Draft[] {
  const cap = team.kind === 'none' ? 12 : 6, out: Draft[] = [];
  for (let i = 0; i < team.sessionIds.length; i += cap) {
    const ids = team.sessionIds.slice(i, i + cap), part = i / cap + 1;
    const size: RoomSize = team.kind === 'none' ? ids.length <= 4 ? 'o2' : ids.length <= 8 ? 'o4' : 'o6' : ids.length <= 2 ? 's' : ids.length <= 4 ? 'm' : 'l';
    out.push({ key: part === 1 ? team.id : `${team.id}#${part}`, name: part === 1 ? team.name : `${team.name} · ${part}`, size, sessionIds: ids });
  }
  return out;
}
export function planRest(need: number): ('rs' | 'rm' | 'rl')[] {
  const out: ('rs' | 'rm' | 'rl')[] = [];
  while (need > 0) { const size = (Object.keys(REST_CAP) as (keyof typeof REST_CAP)[]).find(k => REST_CAP[k] >= need) ?? 'rl'; out.push(size); need -= REST_CAP[size]; }
  return out;
}
export function buildLayout(width: number, teams: readonly Team[], cores: number, rest: readonly ('rs' | 'rm' | 'rl')[] = []): FloorLayout {
  const bw = Math.max(width, SPINE + WIDTH.rl + 16);
  const offices: Draft[] = [{ key: '__ledge', name: 'Ledge', size: 'ledge', sessionIds: [] }];
  for (let i = 0; i < cores; i += 4) offices.push({ key: `__tech${i}`, name: 'OpenRig', size: 'tech', sessionIds: [] });
  offices.push(...teams.flatMap(roomsOf));
  const rows: Draft[][] = [], left: number[] = [];
  for (const room of offices) {
    const w = WIDTH[room.size]; let row = left.findIndex(free => free >= w);
    if (row < 0) { row = rows.length; rows.push([]); left.push(bw - SPINE); }
    rows[row]!.push(room); left[row]! -= w;
  }
  const gaps = rows.map((row, i) => {
    const free = left[i]!, middle = row.length < 2 ? row.length : Math.ceil(row.length / 2);
    let x = SPINE, gap: { x: number; w: number } | null = null;
    row.forEach((room, j) => { if (j === middle && free >= 24) { gap = { x, w: free }; x += free; } room.x = x; x += WIDTH[room.size]; });
    return free >= 24 ? gap ?? { x, w: free } : null;
  });
  rest.forEach((size, index) => {
    const w = WIDTH[size], room: Draft = { key: `__rest${index}`, name: 'Repos', size, sessionIds: [] };
    const i = gaps.findIndex(g => g !== null && g.w >= w);
    if (i >= 0) { const gap = gaps[i]!; room.x = gap.x; rows[i]!.push(room); gaps[i] = gap.w - w >= 24 ? { x: gap.x + w, w: gap.w - w } : null; }
    else { room.x = SPINE; rows.push([room]); const free = bw - SPINE - w; gaps.push(free >= 24 ? { x: SPINE + w, w: free } : null); }
  });
  const rooms: Room[] = [], zones: Zone[] = [], corridors: FloorLayout['corridors'] = [];
  let y = EXT, zoneIndex = 0;
  for (let i = 0; i < rows.length; i += 2) {
    const wing = i / 2, a = rows[i]!, b = rows[i + 1] ?? [], corY = y + ROOM_HEIGHT + CORRIDOR / 2;
    for (const r of a) rooms.push({ ...r, x: r.x!, y, door: 'S', win: wing === 0, corY });
    const zoneAt = (gap: { x: number; w: number } | null, yy: number) => {
      if (!gap) return;
      for (let band = 0; band < 2; band++) {
        let x = gap.x + 4, end = gap.x + gap.w - 4;
        while (end - x >= 48) {
          const pool = end - x >= 104 ? ZONES : NOOKS;
          const found = [...pool.slice(zoneIndex % pool.length), ...pool.slice(0, zoneIndex % pool.length)].find(z => z[1] <= end - x);
          if (!found) break;
          zones.push({ id: `z${i}-${band}-${zoneIndex++}`, kind: found[0], x, y: yy + band * 96, corY, capacity: found[2] }); x += found[1] + 4;
        }
      }
    };
    zoneAt(gaps[i] ?? null, y); y += ROOM_HEIGHT;
    corridors.push({ y, wing }); y += CORRIDOR;
    if (b.length) { for (const r of b) rooms.push({ ...r, x: r.x!, y, door: 'N', win: i + 2 >= rows.length, corY }); zoneAt(gaps[i + 1] ?? null, y); y += ROOM_HEIGHT; }
  }
  return { rooms, zones, corridors, width: bw + 2 * EXT, height: y + EXT, wings: Math.ceil(rows.length / 2) };
}
export function layout(width: number, teams: readonly Team[], cores: number, restDemand: number): FloorLayout {
  let rest: ('rs' | 'rm' | 'rl')[] = [], floor = buildLayout(width, teams, cores);
  for (let i = 0; i < 6; i++) {
    const next = planRest(Math.max(0, restDemand - floor.zones.reduce((n, z) => n + z.capacity, 0)));
    if (next.join() === rest.join()) break;
    rest = next; floor = buildLayout(width, teams, cores, rest);
  }
  return floor;
}
