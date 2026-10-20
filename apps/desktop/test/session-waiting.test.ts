import { describe, expect, it } from 'vitest';
import type { HelperItem, ThreadItem, ToolItem } from '@ledge/protocol';
import { T0 } from '@ledge/fleet/test/mockDaemon';
import { exchanges } from '../src/session/exchanges';
import { seedOf, stageOf, waitOf } from '../src/session/waiting';

const ms = (s: number) => Date.parse(T0) + s * 1000;
const at = (s: number) => new Date(ms(s)).toISOString();
const prompt: ThreadItem = { kind: 'prompt', id: 'p1', at: at(0), turn: 1, text: 'Revois le daemon' };
const tool = (id: string, s: number, name: string, label: string, extra: Partial<ToolItem> = {}): ToolItem =>
  ({ kind: 'tool', id, at: at(s), turn: 1, tool: name, label, status: 'success', files: [], ...extra });
const last = (items: ThreadItem[]) => exchanges(items).at(-1)!;
const named = (h: HelperItem) => h.agentType ?? 'Subagent';
const never = () => undefined;

describe('waiting line', () => {
  it('after your message, the agent reads it, counted from the prompt', () => {
    expect(waitOf(last([prompt]), named, never)).toEqual({ cause: { kind: 'prompt', from: 'you' }, since: ms(0) });
  });

  it('after an action, it looks at its result, counted from its end', () => {
    const w = waitOf(last([prompt, tool('t1', 1, 'Read', 'a.ts', { durationMs: 200 }), tool('t2', 2, 'Bash', 'npm test', { durationMs: 3000, status: 'failed' })]), named, never);
    expect(w).toEqual({ cause: { kind: 'tool', verb: 'command', target: 'npm test', failed: true }, since: ms(5) });
  });

  it('after a subagent, it takes up its report, counted from its end when known', () => {
    const h: HelperItem = { kind: 'helper', id: 'h1', at: at(1), turn: 1, task: 'Lire', agentType: 'Explore', state: 'exited' };
    expect(waitOf(last([prompt, h]), named, () => ms(40))).toEqual({ cause: { kind: 'helper', name: 'Explore' }, since: ms(40) });
    expect(waitOf(last([prompt, h]), named, never).since).toBe(ms(1));
  });

  it('after a decision, it resumes; after a message, it goes on', () => {
    const perm: ThreadItem = { kind: 'permission', id: 'k', at: at(3), turn: 1, tool: 'Bash', text: 'rm', decision: 'accept' };
    expect(waitOf(last([prompt, perm]), named, never).cause).toEqual({ kind: 'decision' });
    const msg: ThreadItem = { kind: 'message', id: 'm', at: at(4), turn: 1, text: 'Je regarde.' };
    expect(waitOf(last([prompt, msg]), named, never)).toEqual({ cause: { kind: 'said' }, since: ms(4) });
  });

  it('a message from another session that opens the exchange is read', () => {
    const r: ThreadItem = { kind: 'received', id: 'r', at: at(2), turn: 1, from: 'otto-id', peer: 'Otto', text: 'Salut' };
    expect(waitOf(last([r]), named, never)).toEqual({ cause: { kind: 'received', from: 'Otto' }, since: ms(2) });
  });

  it('an exchange opened by a notice alone goes on, counted from the notice', () => {
    const n = { kind: 'notice', id: 'n1', at: at(3), turn: 1, notice: 'idle', name: 'nova', peer: 'nova', time: '09:17', summary: 'Prêt', text: '[Cross-session idle notice]' } as ThreadItem;
    expect(waitOf(last([n]), named, never)).toEqual({ cause: { kind: 'said' }, since: ms(3) });
  });

  it('climbs the staircase: fact, bank in turn, then long', () => {
    const cause = { kind: 'said' } as const;
    expect(stageOf(cause, 0, 2, 8)).toEqual({ stage: 'fact', cause });
    expect(stageOf(cause, 7.9, 2, 8).stage).toBe('fact');
    expect(stageOf(cause, 8, 2, 8)).toEqual({ stage: 'bank', index: 2 });
    expect(stageOf(cause, 12, 2, 8)).toEqual({ stage: 'bank', index: 3 });
    expect(stageOf(cause, 28, 7, 8)).toEqual({ stage: 'bank', index: 4 });
    expect(stageOf(cause, 30, 2, 8)).toEqual({ stage: 'long' });
  });

  it('an exchange always starts the bank on the same phrase', () => {
    expect(seedOf('turn-1', 8)).toBe(seedOf('turn-1', 8));
    expect(seedOf('turn-1', 8)).toBeGreaterThanOrEqual(0);
    expect(seedOf('turn-1', 8)).toBeLessThan(8);
  });
});
