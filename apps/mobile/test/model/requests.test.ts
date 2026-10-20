import { describe, expect, it } from 'vitest';
import type { PhoneSession } from '@ledge/protocol';
import { ageLabel, filterItems, headline, requestsOf, type InboxItem } from '../../src/model/requests';
import { pending as pend, session, T } from './fixtures';

const s = (id: string, extra: Partial<PhoneSession> = {}) => session(id, { state: 'waiting_permission', ...extra });

describe('requestsOf', () => {
  it('reads the risk and its reason', () => {
    const [a, b] = requestsOf([
      s('a', { lastActivityAt: '2026-10-14T09:00:00.000Z', pending: pend({ key: 'a', risk: 'low', riskReason: 'read_only_command' }) }),
      s('b', { lastActivityAt: '2026-10-14T09:01:00.000Z', pending: pend({ key: 'b', risk: 'high', riskReason: 'pushes' }) })
    ]);
    expect(a).toMatchObject({ risk: 'low', riskReason: 'read_only_command' });
    expect(b).toMatchObject({ risk: 'high', riskReason: 'pushes' });
  });

  it('lists the oldest request first and skips a request without a key', () => {
    const items = requestsOf([
      s('new', { lastActivityAt: '2026-10-14T10:05:00.000Z', pending: pend({ key: 'n' }) }),
      s('old', { lastActivityAt: '2026-10-14T09:00:00.000Z', pending: pend({ key: 'o' }) }),
      s('keyless', { pending: pend({ key: '' }) }),
      s('none')
    ]);
    expect(items.map(i => i.key)).toEqual(['o', 'n']);
    expect(items[0]).toMatchObject({ sessionId: 'old', filter: 'permission', since: '2026-10-14T09:00:00.000Z' });
  });

  it('falls back to the project when there is no topic or repo, and carries what the detail needs', () => {
    const [a] = requestsOf([s('a', { pending: pend() })]);
    expect(a).toMatchObject({ task: 'x', repo: 'x' });
    expect(a).not.toHaveProperty('cut');
    const [b] = requestsOf([s('b', { topic: 'Ranger', repo: 'harness', branch: 'main', worktree: true, pending: pend({ kind: 'question', options: ['A'], optionDetails: ['a'] }) })]);
    expect(b).toMatchObject({ task: 'Ranger', repo: 'harness', branch: 'main', worktree: true, filter: 'question', options: ['A'], optionDetails: ['a'] });
    const [c] = requestsOf([s('c', { pending: pend({ kind: 'plan', text: 'Plan', body: '# Plan', cut: true }) })]);
    expect(c).toMatchObject({ body: '# Plan', cut: true });
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
