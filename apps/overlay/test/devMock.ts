// Manual dev helper: `pnpm --filter overlay exec tsx test/devMock.ts`, then `pnpm --filter overlay dev`.
import { PROTOCOL_PORT } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from './mockDaemon';

const mock = await createMockDaemon({ port: PROTOCOL_PORT });
const team = [
  fakeSession('a'),
  fakeSession('b', { name: 'Pim', tool: 'codex', project: 'speos-api', startedAt: '2026-10-09T18:01:00.000Z' }),
  fakeSession('c', { name: 'Ada', tool: 'cursor', project: 'ledge', startedAt: '2026-10-09T18:02:00.000Z', state: 'idle', lastReply: { at: new Date().toISOString(), text: '## Settings view split in two\n\nHandle size and Window size are separate rows now, both remembered.\n\n### What I did\n\n- Two `UiScale` settings in `scale.ts`, migrated from `ledge.uiScale`\n- Settings rows and their e2e in `scale.spec.ts`\n\n### Open question\n\nShould a saved `ledge.uiScale` be copied to both sizes, or only to the handle?\n\n- Both\n- Handle only\n\n### Left to do\n\n1. The README note on the two sizes.' } }),
  fakeSession('d', { name: 'Bix', project: 'docs-site', startedAt: '2026-10-09T18:03:00.000Z' }),
  fakeSession('e', { name: 'Kit', tool: 'codex', project: 'infra', startedAt: '2026-10-09T18:04:00.000Z', source: 'hook_only' })
];
for (const s of team) mock.sessions.set(s.id, s);
let turn = 0;
setInterval(() => {
  // The previous asker goes back to work and the next bot asks.
  const prev = team[(turn + team.length - 1) % team.length]!; if (turn > 0) mock.upsert(prev);
  const s = team[turn++ % team.length]!;
  mock.upsert({ ...s, state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
}, 8000);
console.log(`mock daemon on ${mock.url} with ${team.length} sessions; one asks every 8 s`);
