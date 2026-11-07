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

const group = (key: string, harness: 'claude' | 'codex', ms: string[], pct: number | null): UsageGroup => ({
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
  it('agentLimit: the account on that machine, else the first of the harness', () => {
    const groups = [group('a', 'claude', ['local'], 84), group('b', 'claude', ['srv'], 10)];
    expect(agentLimit(groups, 'claude', 'srv', 0.8)).toEqual({ pct: 10, resetsAt: '2026-11-07T20:00:00.000Z', warn: false });
    expect(agentLimit(groups, 'claude', 'nas', 0.8)?.pct).toBe(84);
    expect(agentLimit(groups, 'claude', null, 0.8)?.pct).toBe(84);
    expect(agentLimit(groups, 'claude', 'local', 0.8)?.warn).toBe(true);
    expect(agentLimit([group('a', 'claude', ['local'], 79)], 'claude', 'local', 0.8)?.warn).toBe(false);
  });
  it('agentLimit: null for omp and cursor, for no group, and for a group without a 5 h window', () => {
    const groups = [group('a', 'claude', ['local'], 50)];
    expect(agentLimit(groups, 'omp', 'local', 0.8)).toBeNull();
    expect(agentLimit(groups, 'cursor', 'local', 0.8)).toBeNull();
    expect(agentLimit(groups, 'codex', 'local', 0.8)).toBeNull();
    expect(agentLimit([group('a', 'claude', ['local'], null)], 'claude', 'local', 0.8)).toBeNull();
  });
  it('openWhere: « + » always opens in the active pane; the others follow the setting', () => {
    expect(openWhere('right', 'plus')).toBe('active');
    expect(openWhere('right', 'other')).toBe('right');
    expect(openWhere('active', 'other')).toBe('active');
  });
});
