import { expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import { finishedSince } from '../../../src/ide/atoi/AtoiPage';

const s = (id: string, o: Partial<Session>): Session => ({ id, name: id, tool: 'claude', cwd: '/w', project: 'p', title: id, tmuxSession: id, state: 'idle', helpers: [], startedAt: '2026-11-09T08:00:00.000Z', lastActivityAt: '2026-11-09T08:00:00.000Z', source: 'launcher', ...o });

it('« Terminé depuis ton passage »: idle, not archived, the last reply after the visit, the latest first', () => {
  const since = Date.parse('2026-11-09T10:00:00.000Z');
  const out = finishedSince([
    s('old', { lastReply: { text: 'a', at: '2026-11-09T09:00:00.000Z' } }),
    s('a', { lastReply: { text: 'b', at: '2026-11-09T10:10:00.000Z' } }),
    s('b', { lastReply: { text: 'c', at: '2026-11-09T10:20:00.000Z' } }),
    s('busy', { state: 'working', lastReply: { text: 'd', at: '2026-11-09T10:30:00.000Z' } }),
    s('none', {})
  ], since);
  expect(out.map(x => x.id)).toEqual(['b', 'a']);
});
