import { describe, expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import type { ChangedFile } from '../../src/session/changedFiles';
import { changeTotals, projectLabel, providerOf, tabAlert, tabView } from '../../src/workspace/sessionTab';

const S = (o: Partial<Session> = {}): Session => ({ id: 'a', tool: 'claude', source: 'launcher', state: 'working', ...o }) as Session;
const omp = (o: Partial<Session> = {}): Session => S({ tool: 'omp', source: 'rig', ...o });

describe('providerOf', () => {
  it('maps the four tools', () => {
    expect(providerOf('claude')).toBe('anthropic');
    expect(providerOf('codex')).toBe('openai');
    expect(providerOf('omp')).toBe('omp');
    expect(providerOf('cursor')).toBeNull();
  });
});

describe('tabView', () => {
  const tab = (view?: 'thread' | 'terminal' | 'role') => ({ kind: 'session' as const, ref: 'a', ...(view ? { view } : {}) });
  it('a Claude session opens on its thread, or its terminal when the tab says so', () => {
    expect(tabView(tab(), S())).toBe('thread');
    expect(tabView(tab('terminal'), S())).toBe('terminal');
  });
  it('a running OMP seat opens on its terminal unless the tab chose the thread', () => {
    expect(tabView(tab(), omp())).toBe('terminal');
    expect(tabView(tab('thread'), omp())).toBe('thread');
  });
  it('a stopped or archived OMP seat shows its thread whatever the tab says', () => {
    expect(tabView(tab('terminal'), omp({ state: 'exited' }))).toBe('thread');
    expect(tabView(tab('terminal'), omp({ archivedAt: '2026-11-06T10:00:00.000Z' }))).toBe('thread');
  });
  it('role.md comes in lot 7: the thread', () => { expect(tabView(tab('role'), S())).toBe('thread'); });
  it('an unknown session follows the tab', () => { expect(tabView(tab('terminal'), undefined)).toBe('terminal'); });
});

describe('tabAlert', () => {
  it('maps approval and question', () => {
    expect(tabAlert(S({ state: 'waiting_permission' }))).toBe('perm');
    expect(tabAlert(S({ state: 'waiting_input' }))).toBe('ask');
    expect(tabAlert(S({ state: 'working' }))).toBeNull();
    expect(tabAlert(undefined)).toBeNull();
  });
  it('an offline session raises nothing', () => { expect(tabAlert(S({ state: 'waiting_permission', offline: true }))).toBeNull(); });
});

describe('changeTotals', () => {
  const f = (plus: number, minus: number) => ({ plus, minus }) as ChangedFile;
  it('sums files and lines', () => { expect(changeTotals([f(3, 1), f(0, 4)])).toEqual({ files: 2, plus: 3, minus: 5 }); });
  it('is zero for none', () => { expect(changeTotals([])).toEqual({ files: 0, plus: 0, minus: 0 }); });
});

describe('projectLabel', () => {
  const name = () => 'ledge';
  it('a seat reads rig · role', () => { expect(projectLabel(S({ rig: { seat: 'dev@x', name: 'ledge-dev', role: 'dev.build' } }), name)).toBe('ledge-dev · dev.build'); });
  it('without a role, the rig', () => { expect(projectLabel(S({ rig: { seat: 'dev@x', name: 'ledge-dev' } }), name)).toBe('ledge-dev'); });
  it('without a rig, the project', () => { expect(projectLabel(S(), name)).toBe('ledge'); });
});
