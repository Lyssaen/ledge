import { describe, it, expect, vi } from 'vitest';
import type { Session } from '@ledge/protocol';

vi.mock('../src/mobile/risk.js', () => ({ riskOf: () => undefined }));
const { toPhoneSession } = await import('../src/mobile/project.js');

const T = '2026-10-20T10:00:00.000Z';

describe('a request with no risk verdict', () => {
  it('is projected as high / unknown, not left out', () => {
    const s: Session = {
      id: 's1', name: 'one', tool: 'claude', cwd: '/w', project: 'repo', title: 't', tmuxSession: 'ledge-s1', state: 'waiting_permission', helpers: [],
      startedAt: T, lastActivityAt: T, source: 'launcher', pending: { kind: 'permission', text: 'x', tool: 'Bash', source: 'hook' }
    };
    expect(toPhoneSession(s, T).pending).toMatchObject({ risk: 'high', riskReason: 'unknown' });
  });
});
