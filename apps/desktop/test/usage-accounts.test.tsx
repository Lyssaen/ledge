import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { HarnessUsage, UsageStateMessage } from '@ledge/protocol';
import { accountRows } from '../src/usage/accounts';

afterEach(() => cleanup());

/** « Comptes lus » (docs/mockups/ledge-usage-sign-in.html, #301; design-ux 09:43Z): the states, the order. */
const NOW = Date.now();
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const h = (harness: HarnessUsage['harness'], status: HarnessUsage['status'], readAt: string | null): HarnessUsage => ({ harness, account: null, status, readAt, windows: [] });
const msg = (harnesses: HarnessUsage[]): UsageStateMessage => ({ type: 'usage.state', harnesses, alerts: [], prefs: { alert: 0.8 } });

describe('accountRows', () => {
  it('refused → sign-in needed; ok → read; stale, unreachable or offline → last read, else unreachable; first read → never', () => {
    const states = new Map([
      ['local', msg([h('cursor', 'ok', ago(2)), h('claude', 'expired', null)])],
      ['ec2', msg([h('codex', 'stale', ago(12)), h('claude', 'loading', null)])],
      ['pi', msg([h('claude', 'unreachable', null), h('cursor', 'ok', ago(3))])]
    ]);
    const rows = accountRows(states, ['local', 'ec2', 'pi'], id => id !== 'pi');
    expect(rows.map(r => `${r.harness}@${r.machine}:${r.state.kind}`)).toEqual([
      'claude@local:signIn', 'claude@ec2:never', 'claude@pi:unreachable',
      'codex@ec2:last',
      'cursor@local:read', 'cursor@pi:last'
    ]);
  });
});
