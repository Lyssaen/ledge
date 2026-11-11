// An answer that read the account limits (refonte mobile M3 Q31, docs/mobile-chat-m3-contract.md §2): the context's limits.md, and
// the turn's `limitsAt`, which a phone shows the limits under.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
import type { HarnessUsage } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createChat } from '../src/chat/service.js';
import { limitsMd } from '../src/chat/context.js';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmux = { async capture() { return null; } } as never;
const USAGE: HarnessUsage[] = [
  { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: '2026-10-11T09:40:00.000Z', windows: [
    { kind: 'five_hour', pct: 84, resetsAt: '2026-10-11T14:20:00.000Z' }, { kind: 'seven_day', pct: 41, resetsAt: '2026-10-13T00:00:00.000Z' }] },
  { harness: 'codex', account: null, status: 'stale', readAt: '2026-10-11T09:00:00.000Z', windows: [{ kind: 'five_hour', pct: 22, resetsAt: null }] }
];

function setup(o: { read?: string; usage?: HarnessUsage[] | undefined }) {
  const home = mkdtempSync(join(tmpdir(), 'ledge-limits-'));
  writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
  let limits: string | null = null;
  const spawn = ((file: string, a: string[], opts: object) => {
    const f = join(home, 'chat', 'context', 'limits.md'); limits = existsSync(f) ? readFileSync(f, 'utf8') : null;
    return nodeSpawn(file, a, opts as never);
  }) as unknown as typeof nodeSpawn;
  const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', now: () => '2026-10-11T09:41:00.000Z',
    env: async () => ({ ...process.env, ...(o.read ? { FAKE_READ: o.read } : {}) }), bin: [process.execPath, FAKE], spawn, ...('usage' in o ? { usage: () => o.usage } : {}) });
  return { chat, limits: () => limits };
}

describe('an answer that read the limits', () => {
  it('the context holds limits.md, and the turn that read it says when', async () => {
    const s = setup({ read: 'limits.md', usage: USAGE });
    const out: unknown[] = [];
    await s.chat.ask('q1', 'Et mes limites ?', m => out.push(m));
    expect(s.chat.history()[0]!.limitsAt).toBe('2026-10-11T09:41:00.000Z');
    expect(s.limits()).toContain('## Claude Code');
    expect(s.limits()).toContain('- 5-hour window: 84 % used, starts again at 2026-10-11T14:20:00.000Z');
    expect(s.limits()).toContain('- status: not read for more than 5 minutes');
    // Reading the limits is not a step of the answer.
    expect(s.chat.history()[0]!.steps.map(x => x.kind)).not.toContain('usage');
  });

  it('an answer that did not read them, or a PC without limits, has no limitsAt', async () => {
    const other = setup({ usage: USAGE });
    await other.chat.ask('q1', 'Où en est ledge-dev ?', () => {});
    expect(other.chat.history()[0]!.limitsAt).toBeUndefined();
    const none = setup({ read: 'limits.md' });
    await none.chat.ask('q1', 'Et mes limites ?', () => {});
    expect(none.limits()).toBeNull();
    expect(none.chat.history()[0]!.limitsAt).toBeUndefined();
  });

  it('limits.md says when nothing was read, and a window that is reached', () => {
    expect(limitsMd([], '2026-10-11T09:41:00.000Z')).toContain('- (no harness read on this PC)');
    const md = limitsMd([{ ...USAGE[0]!, windows: [{ kind: 'model', model: 'opus\nx', pct: 100, resetsAt: null }] }], '2026-10-11T09:41:00.000Z');
    expect(md).toContain('- week, one model (opus x): 100 % used (reached), reset time not given');
  });
});
