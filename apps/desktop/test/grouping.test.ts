import { describe, it, expect } from 'vitest';
import { story, tables } from '../src/grouping/groups';
import { MESSAGES } from '../src/i18n/messages';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';

const t = MESSAGES.en;
const s = (id: string, extra: Partial<Session> = {}) => fakeSession(id, extra);   // Session de @ledge/protocol

describe('story key', () => {
  it('reads the branch first, then the topic', () => {
    expect(story({ branch: 'release/LEDGE-42-v0.5.0' })).toEqual({ key: 'LEDGE-42', keys: ['LEDGE-42'], ambiguous: false, source: 'branch' });
    expect(story({ branch: 'docs/protocol', topic: 'LEDGE-42 · Documenter le protocole' })).toEqual({ key: 'LEDGE-42', keys: ['LEDGE-42'], ambiguous: false, source: 'topic' });
    expect(story({ branch: 'feat/bot-motion' })).toEqual({ key: null, keys: [], ambiguous: false, source: null });
  });
  it('the same key twice is one key; two keys are ambiguous', () => {
    expect(story({ branch: 'feat/LEDGE-42-and-LEDGE-42' }).key).toBe('LEDGE-42');
    expect(story({ branch: 'feat/LEDGE-42-WEB-18' })).toEqual({ key: null, keys: ['LEDGE-42', 'WEB-18'], ambiguous: true, source: 'branch' });
  });
  it('lowercase and digit-first tokens are not keys', () => {
    expect(story({ branch: 'fix/ledge-42' }).key).toBeNull();
    expect(story({ topic: 'A1-2 edge' }).key).toBe('A1-2');
  });
});

describe('tables', () => {
  const eight = [
    s('otto', { branch: 'release/LEDGE-42-v0.5.0', machineId: 'local', machineName: 'Local' }),
    s('nova', { branch: 'fix/LEDGE-42-ssh-reconnect', machineId: 'devbox', machineName: 'Devbox' }),
    s('pim', { branch: 'feat/bot-motion', machineId: 'local', machineName: 'Local' }),
    s('bix', { branch: 'docs/protocol', topic: 'LEDGE-42 · Documenter le protocole', machineId: 'local', machineName: 'Local' }),
    s('luna', { branch: 'feat/WEB-18-homepage', machineId: 'local', machineName: 'Local' }),
    s('milo', { branch: 'fix/WEB-18-mobile-layout', machineId: 'devbox', machineName: 'Devbox' }),
    s('echo', { branch: 'test/LEDGE-42-notifications', machineId: 'local', machineName: 'Local' }),
    s('rio', { branch: 'feat/WEB-18-accessibility', machineId: 'devbox', machineName: 'Devbox' })
  ];
  it('all together: one table of eight', () => {
    const out = tables(eight, 'all', t);
    expect(out.map(x => [x.id, x.kind, x.sessions.length])).toEqual([['all', 'all', 8]]);
  });
  it('by machine: 5 and 3, first-seen order', () => {
    expect(tables(eight, 'machine', t).map(x => [x.id, x.label, x.sessions.length])).toEqual([['local', 'Local', 5], ['devbox', 'Devbox', 3]]);
  });
  it('by Jira key: 4 / 3 / 1 unassigned, with a stable order', () => {
    expect(tables(eight, 'jira', t).map(x => [x.id, x.kind, x.sessions.length])).toEqual([['LEDGE-42', 'story', 4], ['unassigned', 'unassigned', 1], ['WEB-18', 'story', 3]]);
    expect(tables(eight, 'jira', t)[1]!.label).toBe(t.room.tables.unassigned);
  });
  it('a session with two keys sits at the "to clarify" table', () => {
    const out = tables([...eight, s('zed', { branch: 'feat/LEDGE-42-WEB-18' })], 'jira', t);
    expect(out.find(x => x.kind === 'ambiguous')).toMatchObject({ id: 'ambiguous', label: t.room.tables.ambiguous });
    expect(out.find(x => x.kind === 'ambiguous')!.sessions.map(x => x.id)).toEqual(['zed']);
  });
  it('a machine without id goes to an unknown machine table', () => {
    expect(tables([s('x')], 'machine', t).map(x => x.id)).toEqual(['unknown']);
  });
  it('an empty list makes no table', () => { expect(tables([], 'jira', t)).toEqual([]); });
});
