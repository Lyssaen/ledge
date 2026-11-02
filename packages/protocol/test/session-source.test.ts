import { describe, expect, it } from 'vitest';
import { SessionSchema } from '../src/session.js';

describe('a session kind this front does not know', () => {
  it('reads as read-only instead of failing the whole snapshot', () => {
    const s = { id: 'a', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto', tmuxSession: null, state: 'idle', helpers: [], startedAt: '2026-11-02T10:00:00.000Z', lastActivityAt: '2026-11-02T10:00:00.000Z' };
    expect(SessionSchema.parse({ ...s, source: 'something-new' }).source).toBe('hook_only');
    expect(SessionSchema.parse({ ...s, source: 'rig' }).source).toBe('rig');
  });
});

describe('the names a new session must not take', () => {
  it('only those of sessions still there: neither ended nor archived', async () => {
    const { namesInUse, pickName } = await import('../src/names.js');
    const s = (name: string, state = 'idle', archivedAt?: string) => ({ name, state, ...(archivedAt ? { archivedAt } : {}) });
    expect(namesInUse([s('Otto'), s('Nova', 'exited'), s('Pim', 'idle', '2026-11-01T00:00:00.000Z')])).toEqual(['Otto']);
    // 197 archived sessions no longer push every new one to « Otto-N ».
    const archived = Array.from({ length: 200 }, (_, i) => s(i < 64 ? ['Otto', 'Nova'][i % 2]! : `Otto-${i}`, 'exited', '2026-11-01T00:00:00.000Z'));
    expect(pickName(namesInUse([...archived, s('Otto')]))).not.toMatch(/-\d+$/);
  });
});
