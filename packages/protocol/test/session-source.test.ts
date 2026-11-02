import { describe, expect, it } from 'vitest';
import { SessionSchema } from '../src/session.js';

describe('a session kind this front does not know', () => {
  it('reads as read-only instead of failing the whole snapshot', () => {
    const s = { id: 'a', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto', tmuxSession: null, state: 'idle', helpers: [], startedAt: '2026-11-02T10:00:00.000Z', lastActivityAt: '2026-11-02T10:00:00.000Z' };
    expect(SessionSchema.parse({ ...s, source: 'something-new' }).source).toBe('hook_only');
    expect(SessionSchema.parse({ ...s, source: 'rig' }).source).toBe('rig');
  });
});
