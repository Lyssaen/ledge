import type { Session } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { story } from './story';
export { story } from './story';

export type Grouping = 'all' | 'machine' | 'jira';
export interface Table { id: string; kind: 'all' | 'machine' | 'story' | 'ambiguous' | 'unassigned'; label: string; sessions: Session[] }

/** Tables in first-appearance order, as the mockup lays them out (spec §8). */
export function tables(sessions: Session[], mode: Grouping, t: Messages): Table[] {
  const out: Table[] = []; const by = new Map<string, Table>();
  const at = (id: string, kind: Table['kind'], label: string, s: Session) => { let g = by.get(id); if (!g) { g = { id, kind, label, sessions: [] }; by.set(id, g); out.push(g); } g.sessions.push(s); };
  for (const s of sessions) {
    if (mode === 'all') at('all', 'all', t.room.tables.all, s);
    else if (mode === 'machine') at(s.machineId ?? 'unknown', 'machine', s.machineName ?? t.room.tables.unknownMachine, s);
    else { const st = story(s); if (st.key) at(st.key, 'story', st.key, s); else if (st.ambiguous) at('ambiguous', 'ambiguous', t.room.tables.ambiguous, s); else at('unassigned', 'unassigned', t.room.tables.unassigned, s); }
  }
  return out;
}
