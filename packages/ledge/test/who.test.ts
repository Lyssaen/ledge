import { describe, it, expect } from 'vitest';
import type { Session } from '@ledge/protocol';
import { formatWho, printWho } from '../src/cli/who.js';
import { agentNameArgs } from '../src/spawn.js';

const at = '2026-10-19T10:00:00.000Z';
const s = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: id, tool: 'claude', cwd: `/w/${id}`, project: id, title: id, tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...extra });

describe('ledge who', () => {
  it('lists the live sessions: name, tool, state, project and worktree, branch, topic; this session marked', () => {
    const out = formatWho([
      s('a1', { name: 'Pim', repo: 'ledge', branch: 'feat/x', worktree: true, cwd: '/w/ledge-wt-pim', topic: 'Notices cross-session' }),
      s('b2', { name: 'Nova', tool: 'codex', state: 'working', project: 'api' }),
      s('c3', { name: 'Old', state: 'exited' }),
      s('d4', { name: 'Gone', archivedAt: at }),
      s('e5', { name: 'Seen', source: 'hook_only' })
    ], 'a1');
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^\s+NOM\s+OUTIL\s+ÉTAT\s+PROJET\s+BRANCHE\s+SUJET/);
    expect(lines[1]).toMatch(/^\* Pim\s+claude\s+idle\s+ledge \(ledge-wt-pim\)\s+feat\/x\s+Notices cross-session$/);
    expect(lines[2]).toMatch(/^ {2}Nova\s+codex\s+working\s+api\s+-\s+-$/);
    expect(lines[3]).toMatch(/^ {2}Seen .* · lecture seule$/);
    expect(out).not.toContain('Old');
    expect(out).not.toContain('Gone');
    expect(formatWho([s('c3', { state: 'exited' })])).toBe('aucune autre session');
  });

  it('says so when the daemon is not running', async () => {
    expect(await printWho({ port: 1 })).toMatch(/daemon/);
  });
});

describe('agentNameArgs', () => {
  it('names Claude Code after the Ledge session unless its arguments already name it', () => {
    expect(agentNameArgs('claude', 'Pim', ['--continue'])).toEqual(['-n', 'Pim']);
    expect(agentNameArgs('claude', 'Pim', ['--name', 'mine'])).toEqual([]);
    expect(agentNameArgs('claude', 'Pim', ['-n=mine'])).toEqual([]);
    expect(agentNameArgs('codex', 'Pim', [])).toEqual([]);
  });
});
