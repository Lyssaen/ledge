import { describe, expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import { ageLabel, filterItems, headline, requestsOf, type InboxItem } from '../src/model/requests';

const T = '2026-10-14T10:00:00.000Z';
const s = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/x', project: 'x', title: 'Otto · x', tmuxSession: null, state: 'waiting_permission', helpers: [], startedAt: T, lastActivityAt: T, source: 'launcher', ...extra } as Session);
const pend = (extra: Partial<NonNullable<Session['pending']>> = {}) => ({ id: 'p1', version: 1, since: T, kind: 'permission' as const, text: 'pnpm test', source: 'hook' as const, ...extra });

describe('requestsOf', () => {
  it('reads the risk; a missing one is high (spec §4)', () => {
    const [a, b, c] = requestsOf([
      s('a', { pending: pend({ id: 'a', risk: 'low', riskReason: 'read_only_command', since: '2026-10-14T09:00:00.000Z' }) }),
      s('b', { pending: pend({ id: 'b', risk: 'high', riskReason: 'pushes', since: '2026-10-14T09:01:00.000Z' }) }),
      s('c', { pending: pend({ id: 'c', since: '2026-10-14T09:02:00.000Z' }) })
    ]);
    expect(a).toMatchObject({ risk: 'low', riskReason: 'read_only_command' });
    expect(b).toMatchObject({ risk: 'high', riskReason: 'pushes' });
    expect(c).toMatchObject({ risk: 'high' });
    expect(c).not.toHaveProperty('riskReason');
  });

  it('lists the oldest request first and skips pendings without id', () => {
    const items = requestsOf([
      s('new', { pending: pend({ id: 'n', since: '2026-10-14T10:05:00.000Z' }) }),
      s('old', { pending: pend({ id: 'o', since: '2026-10-14T09:00:00.000Z' }) }),
      s('legacy', { pending: pend({ id: undefined }) }),
      s('none')
    ]);
    expect(items.map(i => i.pendingId)).toEqual(['o', 'n']);
    expect(items[0]).toMatchObject({ sessionId: 'old', pendingVersion: 1, readOnly: false, filter: 'permission' });
  });

  it('falls back to the project when there is no topic or repo, and flags hook-only sessions read-only', () => {
    const [a] = requestsOf([s('a', { pending: pend(), source: 'hook_only' })]);
    expect(a).toMatchObject({ task: 'x', repo: 'x', readOnly: true });
    const [b] = requestsOf([s('b', { topic: 'Ranger', repo: 'harness', branch: 'main', worktree: true, pending: pend({ kind: 'question', options: ['A'], reason: 'why' }) })]);
    expect(b).toMatchObject({ task: 'Ranger', repo: 'harness', branch: 'main', worktree: true, filter: 'question', options: ['A'], reason: 'why' });
  });
});

describe('filterItems', () => {
  const mk = (kind: InboxItem['kind']) => ({ kind, filter: kind === 'question' ? 'question' : 'permission' }) as InboxItem;
  const all = [mk('permission'), mk('plan'), mk('diff'), mk('question')];
  it('Autorisations covers permission, plan and diff; Questions covers question', () => {
    expect(filterItems(all, 'all')).toHaveLength(4);
    expect(filterItems(all, 'permission').map(i => i.kind)).toEqual(['permission', 'plan', 'diff']);
    expect(filterItems(all, 'question').map(i => i.kind)).toEqual(['question']);
  });
});

describe('ageLabel', () => {
  it('formats ages', () => {
    const t = Date.parse(T);
    expect(ageLabel(T, t + 40_000)).toBe('40 s');
    expect(ageLabel(T, t + 180_000)).toBe('3 min');
    expect(ageLabel(T, t + 2 * 3_600_000)).toBe('2 h');
    expect(ageLabel(T, t + 86_400_000)).toBe('1 j');
    expect(ageLabel(T, t - 5000)).toBe('0 s');
  });
});

describe('headline', () => {
  const base = { text: '' } as InboxItem;
  it('is the question, the first command line, the edited file or the plan', () => {
    expect(headline({ ...base, kind: 'question', text: 'Quel thème ?' })).toBe('Quel thème ?');
    expect(headline({ ...base, kind: 'permission', text: 'pnpm test\n&& pnpm build' })).toBe('pnpm test');
    expect(headline({ ...base, kind: 'diff', text: 'src/a.ts\nplus' })).toBe('Modifier src/a.ts');
    expect(headline({ ...base, kind: 'plan', text: 'long' })).toBe('Plan à valider');
  });
});
