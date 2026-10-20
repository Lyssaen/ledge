import { describe, it, expect } from 'vitest';
import type { ChatProposal } from '@ledge/protocol';
import { launchFromChat, LaunchRefused } from '../src/chat/launch.js';

const row = (cwd: string, extra: Partial<ChatProposal> = {}): ChatProposal => ({ project: 'repo', tool: 'claude', cwd, prompt: 'go', ...extra } as ChatProposal);

function fake(rows: ChatProposal[]) {
  const marks: unknown[][] = [];
  const chat = {
    proposal: (_q: string, r = 0) => rows[r],
    markLaunched: (_q: string, id: string, _e: unknown, r = 0) => { marks.push(['launched', r, id]); rows[r] = { ...rows[r]!, launchedId: id }; },
    markFailed: (_q: string, m: string, _e: unknown, r = 0) => { marks.push(['failed', r, m]); }
  };
  return { chat, marks };
}

describe('launchFromChat', () => {
  it('launches the rows one after the other and marks each', async () => {
    const f = fake([row('/a'), row('/b')]);
    const seen: string[] = [];
    const out = await launchFromChat({ chat: f.chat, emit: () => {}, inFlight: new Set(), launch: async p => { seen.push(p.cwd); return `s${seen.length}`; } }, 'q', [1, 0]);
    expect(out).toEqual({ launched: ['s1', 's2'], failed: 0 });
    expect(seen).toEqual(['/b', '/a']);
    expect(f.marks).toEqual([['launched', 1, 's1'], ['launched', 0, 's2']]);
  });

  it('counts a launch error and goes on', async () => {
    const f = fake([row('/a'), row('/b')]);
    const out = await launchFromChat({ chat: f.chat, emit: () => {}, inFlight: new Set(), launch: async p => { if (p.cwd === '/a') throw new Error('no tmux'); return 's'; } }, 'q', [0, 1]);
    expect(out).toEqual({ launched: ['s'], failed: 1 });
    expect(f.marks[0]).toEqual(['failed', 0, 'no tmux']);
  });

  it('a refused proposal is failed without any launch', async () => {
    const f = fake([row('/home/me')]);
    let launches = 0;
    const out = await launchFromChat({ chat: f.chat, emit: () => {}, inFlight: new Set(), launch: async () => { launches++; return 's'; }, refuse: () => 'too wide' }, 'q');
    expect(out).toEqual({ launched: [], failed: 1 });
    expect(launches).toBe(0);
    expect(f.marks).toEqual([['failed', 0, 'too wide']]);
  });

  it('refuses a card already launched or unknown, and passes over a row in flight', async () => {
    const f = fake([row('/a', { launchedId: 'x' })]);
    const deps = { chat: f.chat, emit: () => {}, inFlight: new Set<string>(), launch: async () => 's' };
    await expect(launchFromChat(deps, 'q')).rejects.toThrow(new LaunchRefused('already launched'));
    await expect(launchFromChat(deps, 'q', [3])).rejects.toThrow('unknown proposal');
    const g = fake([row('/a')]);
    await expect(launchFromChat({ ...deps, chat: g.chat, inFlight: new Set(['q#0']) }, 'q')).rejects.toThrow('already launched');
  });
});
