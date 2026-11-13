import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatPoint, PointItem, Session } from '@ledge/protocol';
import { Store } from '../../src/daemon/store.js';
import type { ChatDeps } from '../../src/chat/service.js';
import { runLead } from '../../src/operator/lead.js';

const logged = vi.hoisted(() => [] as string[]);
vi.mock('../../src/log.js', () => ({ log: (line: string) => { logged.push(line); } }));

const FAKE = fileURLToPath(new URL('../fake-claude.mjs', import.meta.url));
const tmux = { async capture() { return null; } } as never;
const AT = '2026-11-13T10:00:00.000Z';
const exited: Session = { id: 'a', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: 'l-a', state: 'exited', helpers: [], startedAt: AT, lastActivityAt: AT, source: 'launcher' };
const item = (id: string): PointItem => ({ id, event: 1, group: 'done', tone: 'idle', who: 'Otto', text: 'Finished', at: AT });
const point: ChatPoint = { since: AT, lead: 'x', leadBy: 'daemon', items: [item('session.finished:a'), item('session.finished:b')] };
const block = (args: object) => '```ledge-action\n' + JSON.stringify({ action: 'session.archive', args }) + '\n```';

function setup(env: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), 'ledge-lead-'));
  const store = new Store({ journalPath: join(home, 'j.json') });
  store.upsert(exited);
  const log = join(home, 'spawn.jsonl');
  const deps: ChatDeps = { store, tmux, home, env: async () => ({ ...process.env, FAKE_LOG: log, ...env }), bin: [process.execPath, FAKE] };
  return { deps, home, log };
}

describe('runLead', () => {
  it('returns the first sentence and maps an item block to that item', async () => {
    const answer = `Otto a fini. Le reste attend.\n${block({ session: 'a', item: 'session.finished:a' })}\n${block({ session: 'a' })}`;
    const { deps, home } = setup({ FAKE_ANSWER: answer });
    const r = await runLead({ deps, tool: 'claude', events: [], point });
    expect(r.error).toBeUndefined();
    expect(r.lead).toBe('Otto a fini.');
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ item: 'session.finished:a', action: { action: 'session.archive', args: { session: 'a' } } });
    expect(r.suggestions[0]!.action.args).not.toHaveProperty('item');
    // The second block has no item: it is the turn's plan.
    expect(r.actions).toHaveLength(1);
    // The temporary context folder is gone.
    expect(existsSync(join(home, 'chat', 'operator')) ? readdirSync(join(home, 'chat', 'operator')) : []).toEqual([]);
  });

  it('never resumes the day session', async () => {
    const { deps, log } = setup({ FAKE_ANSWER: 'Rien de neuf.' });
    await runLead({ deps, tool: 'claude', events: [], point });
    const line = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1)!) as { argv: string[]; stdin: string };
    expect(line.argv).not.toContain('--resume');
    expect(line.argv).toContain('--session-id');
    expect(line.stdin).toContain('session.finished:a');
  });

  it('timeout returns lead null with error', async () => {
    const { deps } = setup({ FAKE_CLAUDE_MODE: 'slow' });
    const r = await runLead({ deps, tool: 'claude', events: [], point, timeoutMs: 150 });
    expect(r.lead).toBeNull();
    expect(r.error).toMatch(/timed out/);
  });

  it('an invalid block is dropped with a log, the lead kept', async () => {
    logged.length = 0;
    const answer = `Otto a fini.\n${block({ item: 'session.finished:a' })}\n${block({ session: 'a', item: 'session.finished:zzz' })}`;
    const { deps } = setup({ FAKE_ANSWER: answer });
    const r = await runLead({ deps, tool: 'claude', events: [], point });
    expect(r.lead).toBe('Otto a fini.');
    expect(r.suggestions).toEqual([]);
    expect(logged.filter(l => l.startsWith('operator lead: action ignored'))).toHaveLength(2);
  });
});
