import { describe, expect, it } from 'vitest';
import type { Project } from '@ledge/protocol';
import type { UsageGroup } from '../src/usage/model';
import { machine } from './fleet-helpers';
import { agentLimit, openWhere, projectRows } from '../src/launch/modalModel';

const projects: Project[] = [
  { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'srv', path: '/srv/ledge' }] },
  { id: 'empty', name: 'Empty', color: 'green', description: '', repos: [] },
  { id: 'pay', name: 'Payment', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] }
];
const machines = [machine('local'), { ...machine('srv'), status: 'unreachable' as const, ready: false }];

const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const group = (key: string, harness: 'claude' | 'codex' | 'cursor', ms: string[], pct: number | null): UsageGroup => ({
  key, harness, machines: ms, status: 'ok', readAt: null,
  windows: pct === null ? [{ kind: 'seven_day', pct: 5, resetsAt: null }] : [{ kind: 'seven_day', pct: 1, resetsAt: null }, { kind: 'five_hour', pct, resetsAt: '2026-11-07T20:00:00.000Z' }]
});

describe('launch modal model', () => {
  it('projectRows: projects in order, then their folders; a project without folder has no row', () => {
    const rows = projectRows(projects, machines);
    expect(rows.map(r => r.key)).toEqual(['ledge|local|/w/ledge', 'ledge|srv|/srv/ledge', 'pay|local|/w/pay']);
    expect(rows[1]).toEqual({ key: 'ledge|srv|/srv/ledge', project: 'ledge', projectName: 'Ledge', machine: 'srv', machineLabel: 'Srv', path: '/srv/ledge', up: false });
    expect(rows[0]!.up).toBe(true);
  });
  it('agentLimit: the account on that machine; no machine chosen, the harness\'s first; a machine no account lists, not read', () => {
    const groups = [group('a', 'claude', ['local'], 84), group('b', 'claude', ['srv'], 10)];
    expect(agentLimit(groups, 'claude', 'srv', 0.8, NOW)).toEqual({ pct: 10, resetsAt: '2026-11-07T20:00:00.000Z', tone: '', kind: 'five_hour' });
    expect(agentLimit(groups, 'claude', 'nas', 0.8, NOW)).toBeNull();
    expect(agentLimit(groups, 'claude', null, 0.8, NOW)?.pct).toBe(84);
  });
  it('agentLimit: the usage footer\'s tone, amber from the threshold, red at 100 %', () => {
    const at = (pct: number) => agentLimit([group('a', 'claude', ['local'], pct)], 'claude', 'local', 0.8, NOW)?.tone;
    expect(at(79)).toBe('');
    expect(at(80)).toBe('amber');
    expect(at(99)).toBe('amber');
    expect(at(100)).toBe('red');
  });
  it('agentLimit: Cursor reads its month window, else its week; a freshly read group with no window is not read', () => {
    const cursor = (windows: UsageGroup['windows'], over: Partial<UsageGroup> = {}): UsageGroup => ({ key: 'x', harness: 'cursor', machines: ['local'], status: 'ok', readAt: null, windows, ...over });
    const month = { kind: 'month' as const, pct: 42, resetsAt: '2026-12-01T00:00:00.000Z' };
    expect(agentLimit([cursor([month])], 'cursor', 'local', 0.8, NOW)).toEqual({ pct: 42, resetsAt: '2026-12-01T00:00:00.000Z', tone: '', kind: 'month' });
    expect(agentLimit([cursor([{ kind: 'seven_day', pct: 7, resetsAt: null }])], 'cursor', 'local', 0.8, NOW)).toEqual({ pct: 7, resetsAt: null, tone: '', kind: 'seven_day' });
    expect(agentLimit([cursor([{ kind: 'seven_day', pct: 7, resetsAt: null }, month])], 'cursor', 'local', 0.8, NOW)?.kind).toBe('month');
    expect(agentLimit([cursor([], { readAt: new Date(NOW - 60_000).toISOString() })], 'cursor', 'local', 0.8, NOW)).toBeNull();
    expect(agentLimit([cursor([{ kind: 'month', pct: 100, resetsAt: null }])], 'cursor', 'local', 0.8, NOW)?.tone).toBe('red');
  });
  it('agentLimit: null for omp, for no group, and for a group without a 5 h window', () => {
    const groups = [group('a', 'claude', ['local'], 50)];
    expect(agentLimit(groups, 'omp', 'local', 0.8, NOW)).toBeNull();
    expect(agentLimit(groups, 'codex', 'local', 0.8, NOW)).toBeNull();
    expect(agentLimit([group('a', 'claude', ['local'], null)], 'claude', 'local', 0.8, NOW)).toBeNull();
  });
  it('openWhere: « + » always opens in the active pane; the others follow the setting', () => {
    expect(openWhere('right', 'plus')).toBe('active');
    expect(openWhere('right', 'other')).toBe('right');
    expect(openWhere('active', 'other')).toBe('active');
  });
});
