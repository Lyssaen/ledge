import type { PhonePending, PhoneSession } from '@ledge/protocol';

export const T = '2026-10-14T10:00:00.000Z';

/** A session as the phone gets it, idle and read unless told otherwise. */
export const session = (id: string, extra: Partial<PhoneSession> = {}): PhoneSession => ({
  id, name: 'Otto', tool: 'claude', project: 'x', title: 'Otto · x', state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, unread: false, ...extra
});

/** A low-risk command waiting for an answer. */
export const pending = (extra: Partial<PhonePending> = {}): PhonePending => ({
  key: 'p1', kind: 'permission', text: 'pnpm test', source: 'hook', risk: 'low', riskReason: 'read_only_command', ...extra
});
