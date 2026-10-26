import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Projects, ServerMessage, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createChat, tooWide, TOO_MANY } from '../src/chat/service.js';

// The daemon's log lines, read here (a dropped project path is logged with its reason).
const logged = vi.hoisted(() => [] as string[]);
vi.mock('../src/log.js', () => ({ log: (line: string) => { logged.push(line); } }));

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));
const tmux = { async capture() { return null; } } as any;
describe('chat service', () => {
  it('resumes the day session, and starts a new one when the resume fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    let calls = 0;
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', uuid: () => '33333333-3333-4333-8333-333333333333',
      env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: calls++ === 0 ? 'fail' : 'ok' }), bin: [process.execPath, FAKE] });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m));
    expect(out.at(-1)?.type).toBe('chat.done');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toEqual({ day: '2026-10-11', sessionId: '33333333-3333-4333-8333-333333333333', tool: 'claude' });
  });
  it('a new day forgets yesterday\'s turns and session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-10', sessionId: '22222222-2222-4222-8222-222222222222' }));
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', uuid: () => '44444444-4444-4444-8444-444444444444', env: async () => ({ ...process.env }), bin: [process.execPath, FAKE] });
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8')).sessionId).toBe('44444444-4444-4444-8444-444444444444');
  });

  /** A chat over a temp home whose day file already names today (so the question resumes), counting spawns and keeping their env. */
  function setup(extra: Partial<Parameters<typeof createChat>[0]> = {}) {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    const spawned: NodeJS.ProcessEnv[] = [];
    const spawn = ((file: string, args: string[], o: { env: NodeJS.ProcessEnv }) => { spawned.push(o.env); return nodeSpawn(file, args, o as never); }) as unknown as typeof nodeSpawn;
    const store = new Store({ journalPath: join(home, 'j.json') });
    const chat = createChat({ store, tmux, home, today: () => '2026-10-11', env: async () => ({ ...process.env }), bin: [process.execPath, FAKE], spawn, ...extra });
    return { chat, spawned, store, home };
  }

  it('reads the daemon’s projects at each question: a change between two questions is in the next context', async () => {
    let home = '';
    const seen: (string | null)[] = [];
    const spawn = ((file: string, a: string[], o: object) => {
      const f = join(home, 'chat', 'context', 'projects.md');
      seen.push(existsSync(f) ? readFileSync(f, 'utf8') : null);
      return nodeSpawn(file, a, o as never);
    }) as unknown as typeof nodeSpawn;
    let projects: Projects = { projects: [], rules: [] };
    let reads = 0;
    const s = setup({ spawn, projects: () => { reads++; return projects; } });
    home = s.home;
    await s.chat.ask('q1', 'x', () => {});
    projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
    await s.chat.ask('q2', 'y', () => {});
    expect(reads).toBe(2);
    expect(seen[0]).toBeNull();
    expect(seen[1]).toContain('## Ledge');
  });

  it('a question about issues, PR/MR or CI gets the forge files the daemon read (#23); another question runs no forge command', async () => {
    let home = ''; const seen: Array<string | null> = [];
    const spawn = ((file: string, a: string[], o: object) => {
      const f = join(home, 'chat', 'context', 'forge.md'); seen.push(existsSync(f) ? readFileSync(f, 'utf8') : null);
      return nodeSpawn(file, a, o as never);
    }) as unknown as typeof nodeSpawn;
    const projects: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
    const writes: string[] = [];
    const forge = { async write(ctx: { dir: string; steps: Map<string, unknown> }, p: Projects) { writes.push(p.projects[0]!.id); writeFileSync(join(ctx.dir, 'forge.md'), '- Ledge: forge-ledge.md'); } };
    const s = setup({ spawn, projects: () => projects, forge }); home = s.home;
    await s.chat.ask('q1', 'où en sont les autres ?', () => {});
    await s.chat.ask('q2', 'quelles issues sont ouvertes ?', () => {});
    expect(writes).toEqual(['ledge']);
    expect(seen).toEqual([null, '- Ledge: forge-ledge.md']);
  });

  it('the chat context leaves archived sessions out', async () => {
    let home = ''; let sessions = '';
    const spawn = ((file: string, a: string[], o: object) => { sessions = readFileSync(join(home, 'chat', 'context', 'sessions.md'), 'utf8'); return nodeSpawn(file, a, o as never); }) as unknown as typeof nodeSpawn;
    const s = setup({ spawn }); home = s.home;
    const mkS = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w', project: 'w', title: `${name} · w`, tmuxSession: null, state: 'working', helpers: [], startedAt: '2026-10-11T08:00:00.000Z', lastActivityAt: '2026-10-11T08:00:00.000Z', source: 'hook_only', ...extra });
    s.store.upsert(mkS('a', 'Visible')); s.store.upsert(mkS('b', 'Hidden', { archivedAt: '2026-10-11T09:00:00.000Z' }));
    await s.chat.ask('q1', 'x', () => {});
    expect(sessions).toContain('Visible'); expect(sessions).not.toContain('Hidden');
  });

  it('reset clears the turns, forgets the day file, and the next question starts a new session (--session-id, not --resume)', async () => {
    const args: string[][] = [];
    const spawn = ((file: string, a: string[], o: object) => { args.push(a); return nodeSpawn(file, a, o as never); }) as unknown as typeof nodeSpawn;
    const { chat, home } = setup({ spawn, uuid: () => '55555555-5555-4555-8555-555555555555' });
    await chat.ask('q1', 'x', () => {});
    expect(args[0]).toContain('--resume');
    const out: ServerMessage[] = [];
    await chat.reset(m => out.push(m));
    expect(out).toEqual([{ type: 'chat.history', turns: [] }]);
    expect(chat.history()).toEqual([]);
    expect(existsSync(join(home, 'chat.json'))).toBe(false);
    await chat.ask('q2', 'y', () => {});
    expect(args[1]).not.toContain('--resume');
    expect(args[1]![args[1]!.indexOf('--session-id') + 1]).toBe('55555555-5555-4555-8555-555555555555');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8')).sessionId).toBe('55555555-5555-4555-8555-555555555555');
    await chat.ask('q3', 'z', () => {});
    expect(args[2]![args[2]!.indexOf('--resume') + 1]).toBe('55555555-5555-4555-8555-555555555555');
  });

  it('a reset while a question runs is ignored', async () => {
    const { chat, spawned } = setup({ env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'slow' }) });
    const asked = chat.ask('q1', 'x', () => {});
    while (spawned.length === 0) await new Promise(r => setTimeout(r, 10));
    const out: ServerMessage[] = [];
    await chat.reset(m => out.push(m));
    expect(out).toEqual([]); expect(chat.history()).toHaveLength(1);
    chat.cancel('q1'); await asked;
  });

  it('a timeout kills the run, says so, and is not retried with a fresh session', async () => {
    const { chat, spawned } = setup({ timeoutMs: 300, env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'slow' }) });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m));
    expect(out.at(-1)).toEqual({ type: 'chat.error', qid: 'q1', message: 'Claude Code did not answer within 3 minutes' });
    expect(spawned).toHaveLength(1);
    expect(chat.history()[0]?.error).toBe('Claude Code did not answer within 3 minutes');
  });

  it('cancel ends the turn with "cancelled" and emits chat.error so the overlay unlocks', async () => {
    const { chat, spawned } = setup({ env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'slow' }) });
    const out: ServerMessage[] = [];
    const asked = chat.ask('q1', 'x', m => out.push(m));
    while (spawned.length === 0) await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 100));
    chat.cancel('q1');
    await asked;
    expect(out.at(-1)).toEqual({ type: 'chat.error', qid: 'q1', message: 'cancelled' });
    expect(chat.history()[0]?.error).toBe('cancelled');
    expect(spawned).toHaveLength(1);
  });

  it('a cancel while the context is still being built stops before any spawn', async () => {
    const slowTmux = { async capture() { await new Promise(r => setTimeout(r, 200)); return 'line'; } } as any;
    const { chat, spawned, store, home } = setup({ tmux: slowTmux });
    store.upsert({ id: 'a', name: 'Otto', tool: 'claude', cwd: home, project: 'p', title: 'Otto · p', tmuxSession: 'ledge-a', state: 'working', helpers: [], startedAt: '2026-10-11T10:00:00.000Z', lastActivityAt: '2026-10-11T10:00:00.000Z', source: 'launcher' });
    const out: ServerMessage[] = [];
    const asked = chat.ask('q1', 'x', m => out.push(m));
    chat.cancel('q1');
    await asked;
    expect(spawned).toHaveLength(0);
    expect(out.at(-1)).toEqual({ type: 'chat.error', qid: 'q1', message: 'cancelled' });
    expect(chat.history()[0]?.error).toBe('cancelled');
  });

  it('runs claude as the chat: LEDGE_CHAT set, LEDGE_SESSION, LEDGE_NAME and ANTHROPIC_API_KEY removed', async () => {
    const { chat, spawned } = setup({ env: async () => ({ ...process.env, LEDGE_SESSION: 's', LEDGE_NAME: 'Otto', ANTHROPIC_API_KEY: 'sk-inherited' }) });
    await chat.ask('q1', 'x', () => {});
    expect(spawned[0]?.LEDGE_CHAT).toBe('1');
    expect(spawned[0]).not.toHaveProperty('LEDGE_SESSION');
    expect(spawned[0]).not.toHaveProperty('LEDGE_NAME');
    expect(spawned[0]).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('removes the context folder once the run has ended', async () => {
    const { chat, home } = setup();
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()[0]?.answer).toBeTruthy();
    expect(existsSync(join(home, 'chat', 'context'))).toBe(false);
  });

  it('announces the turn with chat.history before anything streams', async () => {
    const { chat } = setup();
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(structuredClone(m)));
    expect(out[0]).toMatchObject({ type: 'chat.history', turns: [{ qid: 'q1', question: 'x', steps: [] }] });
    expect((out[0] as Extract<ServerMessage, { type: 'chat.history' }>).turns[0]).not.toHaveProperty('answer');
    expect(out[1]?.type).toBe('chat.step');
  });

  it('records the sessions step once', async () => {
    const { chat } = setup();
    await chat.ask('q1', 'x', () => {});
    expect(chat.history().at(-1)?.steps).toEqual([{ kind: 'sessions' }]);
  });

  it('keeps only the last 50 turns (in-process fake child, no real spawn)', async () => {
    const spawn = (() => {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { child.emit('close', null); } });
      setImmediate(() => {
        child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }) + '\n');
        child.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', session_id: 's' }) + '\n');
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    }) as unknown as typeof nodeSpawn;
    const { chat } = setup({ spawn });
    for (let i = 0; i < 51; i++) await chat.ask(`q${i}`, 'x', () => {});
    expect(chat.history()).toHaveLength(50);
    expect(chat.history()[0]?.qid).toBe('q1');
  });

  it('runs OMP when asked: read-only whitelist, its conversation in a directory of its own, continued by the next question of the day', async () => {
    const args: string[][] = [];
    const spawn = ((file: string, a: string[], o: object) => { args.push(a); return nodeSpawn(file, a, o as never); }) as unknown as typeof nodeSpawn;
    const { chat, home } = setup({ spawn, env: async () => ({ ...process.env, FAKE_AGENT: 'omp' }) });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m), 'omp');
    expect(out.at(-1)).toMatchObject({ type: 'chat.done', text: 'Deux sessions : Nova travaille.' });
    expect(out.some(m => m.type === 'chat.delta')).toBe(true);
    expect(args[0]![args[0]!.indexOf('--tools') + 1]).toBe('read,grep,glob');
    const { sessionId } = JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8')) as { sessionId: string };
    expect(args[0]![args[0]!.indexOf('--session-dir') + 1]).toBe(join(home, 'chat', 'omp', sessionId));
    expect(args[0]).not.toContain('--continue'); // the day's first OMP question starts its conversation
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toMatchObject({ tool: 'omp' });
    await chat.ask('q2', 'y', () => {}, 'omp');
    expect(args[1]).toContain('--continue');
  });
  it('runs Codex when asked, and a later Claude question starts a new session', async () => {
    const args: string[][] = [];
    const spawn = ((file: string, a: string[], o: object) => { args.push(a); return nodeSpawn(file, a, o as never); }) as unknown as typeof nodeSpawn;
    const { chat, home } = setup({ spawn, env: async () => ({ ...process.env, FAKE_AGENT: 'codex' }) });
    await chat.ask('q1', 'x', () => {}, 'codex');
    expect(args[0]).toContain('exec');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toMatchObject({ tool: 'codex' });
    await chat.ask('q2', 'y', () => {}, 'claude');
    expect(args[1]).toContain('--session-id');
    expect(args[1]).not.toContain('exec');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toMatchObject({ tool: 'claude' });
  });

  const fence = (json: string) => 'Je te propose cette session.\n\n```ledge-session\n' + json + '\n```';

  it('gives Ledge the recent folders in folders.md', async () => {
    const { chat, store } = setup({ env: async () => ({ ...process.env, FAKE_CLAUDE_MODE: 'folders' }) });
    store.touchRecent('/w/ledge', 'ledge', '2026-10-11T09:00:00.000Z');
    await chat.ask('q1', 'x', () => {});
    expect(chat.history()[0]!.answer).toContain('- ledge: /w/ledge');
  });

  it('a valid block becomes the turn proposal, joined to chat.done, and leaves the text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(`{"cwd": "${dir}/", "prompt": " Corrige le build "}`) }) });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'ouvre une session pour corriger le build', m => out.push(m));
    const proposal = { cwd: dir, project: basename(dir), tool: 'claude', prompt: 'Corrige le build' };
    expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je te propose cette session.', at: expect.any(String), proposal, proposals: [proposal] });
    expect(chat.history()[0]).toMatchObject({ answer: 'Je te propose cette session.', proposal, proposals: [proposal] });
    expect(chat.proposal('q1')).toEqual(proposal);
  });

  describe('several sessions in one answer (#24)', () => {
    const fences = (...jsons: string[]) => 'Je lance ces sessions.\n\n' + jsons.map(j => '```ledge-session\n' + j + '\n```').join('\n');
    it('every valid block is a row, in order; the first stays the turn proposal for older clients', async () => {
      const a = mkdtempSync(join(tmpdir(), 'a-')), b = mkdtempSync(join(tmpdir(), 'b-'));
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fences(`{"cwd": "${a}"}`, `{"cwd": "${b}", "prompt": "Rebase"}`) }) });
      const out: ServerMessage[] = [];
      await chat.ask('q1', 'lance une session sur a et une sur b', m => out.push(m));
      const pa = { cwd: a, project: basename(a), tool: 'claude' }, pb = { cwd: b, project: basename(b), tool: 'claude', prompt: 'Rebase' };
      expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je lance ces sessions.', at: expect.any(String), proposal: pa, proposals: [pa, pb] });
      expect(chat.proposal('q1', 1)).toEqual(pb);
      expect(chat.proposal('q1', 2)).toBeUndefined();
    });
    it('a bad or missing folder drops its row only', async () => {
      const a = mkdtempSync(join(tmpdir(), 'a-'));
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fences('{"cwd": "/nope/ledge-missing"}', `{"cwd": "${a}"}`, '{"cwd":') }) });
      await chat.ask('q1', 'x', () => {});
      expect(chat.history()[0]!.proposals).toEqual([{ cwd: a, project: basename(a), tool: 'claude' }]);
    });
    it('keeps the first 8 rows and logs the rest', async () => {
      const dirs = Array.from({ length: 10 }, (_, i) => mkdtempSync(join(tmpdir(), `d${i}-`)));
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fences(...dirs.map(d => `{"cwd": "${d}"}`)) }) });
      logged.length = 0;
      await chat.ask('q1', 'x', () => {});
      expect(chat.history()[0]!.proposals!.map(p => p.cwd)).toEqual(dirs.slice(0, 8));
      expect(logged.some(l => l.includes('2 sessions beyond 8 ignored'))).toBe(true);
    });
    it('marks each row on its own; the first row mirrors the turn proposal', async () => {
      const a = mkdtempSync(join(tmpdir(), 'a-')), b = mkdtempSync(join(tmpdir(), 'b-'));
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fences(`{"cwd": "${a}"}`, `{"cwd": "${b}"}`) }) });
      await chat.ask('q1', 'x', () => {});
      const out: ServerMessage[] = [];
      chat.markLaunched('q1', 'n2', m => out.push(m), 1);
      expect(chat.proposal('q1', 1)).toMatchObject({ launchedId: 'n2' });
      expect(chat.history()[0]!.proposal).not.toHaveProperty('launchedId');
      chat.markFailed('q1', 'boom', m => out.push(m), 0);
      expect(chat.history()[0]!.proposal).toMatchObject({ error: 'boom' });
      expect(chat.history()[0]!.proposals![0]).toMatchObject({ error: 'boom' });
      chat.markLaunched('q1', 'n1', m => out.push(m));
      expect(chat.history()[0]!.proposal).toEqual({ cwd: a, project: basename(a), tool: 'claude', launchedId: 'n1' });
      expect(chat.history()[0]!.proposals![0]).toEqual(chat.history()[0]!.proposal);
      expect(out).toHaveLength(3);
      chat.markLaunched('q1', 'n9', m => out.push(m), 5);
      expect(out).toHaveLength(3);
    });
  });

  it('a ~ path resolves against the user home, a blank prompt means an empty session', async () => {
    const userHome = mkdtempSync(join(tmpdir(), 'home-')); mkdirSync(join(userHome, 'ledge'));
    const { chat } = setup({ userHome, env: async () => ({ ...process.env, FAKE_ANSWER: fence('{"cwd": "~/ledge/", "prompt": "   "}') }) });
    await chat.ask('q1', 'x', () => {});
    expect(chat.proposal('q1')).toEqual({ cwd: join(userHome, 'ledge'), project: 'ledge', tool: 'claude' });
  });

  it('no card for a missing folder, a file, or a bad block; the text is shown without the block', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'f-')), 'a.txt'); writeFileSync(file, 'x');
    for (const json of ['{"cwd": "/nope/ledge-missing"}', `{"cwd": "${file}"}`, '{"cwd":', '{"prompt": "x"}']) {
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(json) }) });
      const out: ServerMessage[] = [];
      await chat.ask('q1', 'x', m => out.push(m));
      const done = out.find(m => m.type === 'chat.done');
      expect(done).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je te propose cette session.', at: expect.any(String) });
      expect(chat.proposal('q1')).toBeUndefined();
    }
  });

  it('no card when the prompt would read as a flag', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(JSON.stringify({ cwd: dir, prompt: '  --dangerously-skip-permissions' })) }) });
    await chat.ask('q1', 'x', () => {});
    expect(chat.proposal('q1')).toBeUndefined();
  });

  it('markLaunched and markFailed update the proposal and tell every client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: fence(`{"cwd": "${dir}"}`) }) });
    await chat.ask('q1', 'x', () => {});
    const out: ServerMessage[] = [];
    chat.markFailed('q1', 'no such folder: /w', m => out.push(m));
    expect(out.at(-1)).toMatchObject({ type: 'chat.history', turns: [{ qid: 'q1', proposal: { cwd: dir, error: 'no such folder: /w' } }] });
    chat.markLaunched('q1', 'n1', m => out.push(m));
    expect(chat.proposal('q1')).toEqual({ cwd: dir, project: basename(dir), tool: 'claude', launchedId: 'n1' });
    expect(out).toHaveLength(2);
    chat.markLaunched('nope', 'n2', m => out.push(m)); chat.markFailed('nope', 'x', m => out.push(m));
    expect(out).toHaveLength(2);
  });
  describe('project proposal (lot 11 task 5)', () => {
    const projectFence = (json: string) => 'Je propose **Paper** avec ses dépôts.\n\n```ledge-project\n' + json + '\n```';
    it('keeps the paths that exist on this machine (resolved, ~ included, once each), drops an invented one, and joins the proposal to chat.done', async () => {
      const userHome = mkdtempSync(join(tmpdir(), 'home-')); mkdirSync(join(userHome, 'paper-fonts')); mkdirSync(join(userHome, 'paper-templates'));
      const block = JSON.stringify({ name: 'Paper', description: 'Les polices', addTo: 'Ledge', repos: [
        { path: '~/paper-fonts/', why: 'Nommé paper-*' }, { path: '/nope/invented-by-the-model', why: 'inventé' },
        { path: join(userHome, 'paper-templates'), why: 'Même préfixe' }, { path: join(userHome, 'paper-fonts'), why: 'en double' }] });
      const { chat } = setup({ userHome, env: async () => ({ ...process.env, FAKE_ANSWER: projectFence(block) }) });
      const out: ServerMessage[] = [];
      await chat.ask('q1', 'crée un projet Paper', m => out.push(m));
      const projectProposal = { name: 'Paper', description: 'Les polices', addTo: 'Ledge', repos: [
        { path: join(userHome, 'paper-fonts'), why: 'Nommé paper-*' }, { path: join(userHome, 'paper-templates'), why: 'Même préfixe' }] };
      expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je propose **Paper** avec ses dépôts.', at: expect.any(String), projectProposal });
      expect(chat.history()[0]).toMatchObject({ answer: 'Je propose **Paper** avec ses dépôts.', projectProposal });
      expect(chat.history()[0]).not.toHaveProperty('proposal');
    });
    it('no proposal when no path exists here, for a file, or for a bad block; the answer stands alone', async () => {
      const file = join(mkdtempSync(join(tmpdir(), 'f-')), 'a.txt'); writeFileSync(file, 'x');
      for (const json of [JSON.stringify({ name: 'Paper', repos: [{ path: '/nope/a', why: 'x' }, { path: file, why: 'y' }, { path: 'relative/b', why: 'z' }] }), '{"name": "Paper", "repos": []}', '{"name":']) {
        const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: projectFence(json) }) });
        const out: ServerMessage[] = [];
        await chat.ask('q1', 'x', m => out.push(m));
        expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je propose **Paper** avec ses dépôts.', at: expect.any(String) });
        expect(chat.history()[0]).not.toHaveProperty('projectProposal');
      }
    });
    it('drops / and a home (the user\'s, ~ included), as the Settings proposer does, and keeps the rest', async () => {
      const userHome = mkdtempSync(join(tmpdir(), 'home-')); mkdirSync(join(userHome, 'paper'));
      const block = JSON.stringify({ name: 'Paper', repos: [{ path: '/', why: 'root' }, { path: '~', why: 'home' }, { path: userHome + '/', why: 'home again' }, { path: '~/paper', why: 'kept' }] });
      const { chat } = setup({ userHome, env: async () => ({ ...process.env, FAKE_ANSWER: projectFence(block) }) });
      await chat.ask('q1', 'x', () => {});
      expect(chat.history()[0]!.projectProposal).toEqual({ name: 'Paper', repos: [{ path: join(userHome, 'paper'), why: 'kept' }] });
    });
    it('tooWide: the root, a home, what holds the user\'s home, a top-level folder, a folder of homes (WSL\'s Windows ones too); a repository is not', () => {
      const home = '/home/me';
      expect(tooWide('/', home)).toBe('the root');
      for (const p of ['/home/me', '/home/other', '/root', '/Users/kim', '/mnt/c/Users/kim']) expect(tooWide(p, home)).toBe('a home folder');
      expect(tooWide('/srv/me/home', '/srv/me/home')).toBe('a home folder');
      expect(tooWide('/srv/me', '/srv/me/home')).toBe('a folder holding the home');
      for (const p of ['/home', '/Users', '/mnt/c', '/mnt/d/Users', '/mnt/wsl']) expect(tooWide(p, home)).toBe('a folder of homes');
      for (const p of ['/usr', '/srv', '/tmp', '/w']) expect(tooWide(p, home)).toBe('a top-level folder');
      for (const p of ['/home/me/dev', '/home/me/dev/paper', '/w/ledge', '/mnt/c/Users/kim/dev', '/srv/me/other']) expect(tooWide(p, home)).toBeNull();
      expect(tooWide('/srv/me/homework', '/srv/me/home')).toBeNull();
    });
    it('drops what holds the user\'s home and a top-level folder, each with its log line, and keeps the rest', async () => {
      const outer = mkdtempSync(join(tmpdir(), 'outer-'));
      const userHome = join(outer, 'me'); mkdirSync(join(userHome, 'paper'), { recursive: true });
      const block = JSON.stringify({ name: 'Paper', repos: [{ path: outer, why: 'holds the home' }, { path: '/usr', why: 'top level' }, { path: '~/paper', why: 'kept' }] });
      const { chat } = setup({ userHome, env: async () => ({ ...process.env, FAKE_ANSWER: projectFence(block) }) });
      logged.length = 0;
      await chat.ask('q1', 'x', () => {});
      expect(chat.history()[0]!.projectProposal).toEqual({ name: 'Paper', repos: [{ path: join(userHome, 'paper'), why: 'kept' }] });
      expect(logged).toContain(`chat q1: project path dropped: a folder holding the home: ${outer}`);
      expect(logged).toContain('chat q1: project path dropped: a top-level folder: /usr');
    });
    it('only / and homes: no proposal', async () => {
      const userHome = mkdtempSync(join(tmpdir(), 'home-'));
      const { chat } = setup({ userHome, env: async () => ({ ...process.env, FAKE_ANSWER: projectFence(JSON.stringify({ name: 'P', repos: [{ path: '/', why: 'x' }, { path: '~', why: 'y' }] })) }) });
      await chat.ask('q1', 'x', () => {});
      expect(chat.history()[0]).not.toHaveProperty('projectProposal');
    });
    it('a blank description or addTo is left out', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'proj-'));
      const { chat } = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: projectFence(JSON.stringify({ name: 'Paper', description: '  ', addTo: ' ', repos: [{ path: dir, why: 'x' }] })) }) });
      await chat.ask('q1', 'x', () => {});
      expect(chat.history()[0]!.projectProposal).toEqual({ name: 'Paper', repos: [{ path: dir, why: 'x' }] });
    });
  });
  describe('close card (spec 2026-10-21 close §4)', () => {
    const closeFence = (...ids: string[]) => 'Je ferme ces sessions.\n\n' + ids.map(id => '```ledge-close\n{"session": "' + id + '"}\n```').join('\n');
    const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: id.toUpperCase(), tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${id} · ledge`,
      tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: '2026-10-11T08:00:00.000Z', lastActivityAt: '2026-10-11T08:00:00.000Z', source: 'launcher', ...extra });
    const askWith = async (answer: string, sessions: Session[]) => {
      const s = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: answer }), now: () => '2026-10-11T09:00:00.000Z' });
      for (const x of sessions) s.store.upsert(x);
      const out: ServerMessage[] = [];
      logged.length = 0;
      await s.chat.ask('q1', 'ferme Arlo et Bram', m => out.push(m));
      return { ...s, out, done: out.find(m => m.type === 'chat.done') as Extract<ServerMessage, { type: 'chat.done' }> };
    };

    it('keeps a close row per known session, in order, with the store\'s name and tool', async () => {
      const { chat, done } = await askWith(closeFence('a1', 'b2'), [session('a1', { name: 'Arlo' }), session('b2', { name: 'Bram', tool: 'codex' })]);
      const closes = [{ id: 'a1', name: 'Arlo', tool: 'claude' }, { id: 'b2', name: 'Bram', tool: 'codex' }];
      expect(chat.history()[0]!.closes).toEqual(closes);
      expect(done.closes).toEqual(closes);
      expect(done.text).toBe('Je ferme ces sessions.');
      expect(chat.history()[0]!.answer).not.toContain('```');
    });
    it('drops unknown, read-only, exited and repeated sessions', async () => {
      const { chat, done } = await askWith(closeFence('zz', 'h1', 'x1', 'a1', 'a1'), [session('a1', { name: 'Arlo' }), session('h1', { source: 'hook_only', tmuxSession: null }), session('x1', { state: 'exited' })]);
      expect(chat.history()[0]!.closes).toEqual([{ id: 'a1', name: 'Arlo', tool: 'claude' }]);
      expect(done.closes).toHaveLength(1);
      expect(logged.filter(l => l.includes('close ignored'))).toEqual([
        'chat q1: close ignored: unknown session zz', 'chat q1: close ignored: read-only session h1', 'chat q1: close ignored: session has exited x1', 'chat q1: close ignored: duplicate session a1'
      ]);
    });
    it('ignores close rows beyond 8', async () => {
      const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
      const { chat } = await askWith(closeFence(...ids), ids.map(id => session(id)));
      expect(chat.history()[0]!.closes!.map(c => c.id)).toEqual(ids.slice(0, 8));
      expect(logged.some(l => l.includes('2 sessions beyond 8 ignored'))).toBe(true);
    });
    it('gives no card when no close row is valid', async () => {
      const { chat, done } = await askWith(closeFence('zz'), []);
      expect(chat.history()[0]).not.toHaveProperty('closes');
      expect(done).not.toHaveProperty('closes');
    });
    it('gives no close card when the last block is not a close', async () => {
      const answer = closeFence('a1') + '\n```ledge-relay\n{"session": "a1", "text": "go"}\n```';
      const { chat, done } = await askWith(answer, [session('a1', { name: 'Arlo' })]);
      expect(chat.history()[0]).not.toHaveProperty('closes');
      expect(done).not.toHaveProperty('closes');
      expect(chat.relay('q1')).toEqual({ id: 'a1', name: 'Arlo', tool: 'claude', text: 'go' });
    });
    it('marks a close row closed or failed for every client', async () => {
      const { chat } = await askWith(closeFence('a1', 'b2'), [session('a1', { name: 'Arlo' }), session('b2', { name: 'Bram', tool: 'codex' })]);
      const out: ServerMessage[] = [];
      chat.markCloseFailed('q1', 1, 'busy', m => out.push(m));
      expect(chat.close('q1', 1)).toEqual({ id: 'b2', name: 'Bram', tool: 'codex', error: 'busy' });
      chat.markClosed('q1', 1, 'killed', m => out.push(m));
      expect(chat.close('q1', 1)).toEqual({ id: 'b2', name: 'Bram', tool: 'codex', closedAt: '2026-10-11T09:00:00.000Z', how: 'killed' });
      expect(chat.close('q1', 0)).toEqual({ id: 'a1', name: 'Arlo', tool: 'claude' });
      expect(out.map(m => m.type)).toEqual(['chat.history', 'chat.history']);
      expect(chat.close('q1', 5)).toBeUndefined();
      chat.markClosed('q1', 5, 'exit', m => out.push(m));
      expect(out).toHaveLength(2);
    });
  });
  describe('relay (spec 2026-10-12 relay §4)', () => {
    const relayFence = (json: string) => 'Je transmets à Otto.\n\n```ledge-relay\n' + json + '\n```';
    const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'codex', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge',
      tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: '2026-10-11T08:00:00.000Z', lastActivityAt: '2026-10-11T08:00:00.000Z', source: 'launcher', ...extra });
    const askWith = async (block: string, sessions: Session[], extra: Partial<Parameters<typeof createChat>[0]> = {}) => {
      const s = setup({ env: async () => ({ ...process.env, FAKE_ANSWER: relayFence(block) }), ...extra });
      for (const x of sessions) s.store.upsert(x);
      const out: ServerMessage[] = [];
      await s.chat.ask('q1', 'dis à Otto de lancer les tests', m => out.push(m));
      return { ...s, out };
    };

    it('a block naming a tracked session becomes the turn relay, joined to chat.done, with the session\'s own name and tool', async () => {
      const { chat, out } = await askWith('{"session": "s1", "text": " Lance les tests "}', [session('s1')]);
      const relay = { id: 's1', name: 'Otto', tool: 'codex', text: 'Lance les tests' };
      expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je transmets à Otto.', at: expect.any(String), relay });
      expect(chat.history()[0]).toMatchObject({ answer: 'Je transmets à Otto.', relay });
      expect(chat.relay('q1')).toEqual(relay);
      expect(chat.history()[0]).not.toHaveProperty('proposal');
    });

    it.each([
      ['unknown', '{"session": "nope", "text": "x"}', [session('s1')]],
      ['read-only', '{"session": "s1", "text": "x"}', [session('s1', { source: 'hook_only', tmuxSession: null })]],
      ['exited', '{"session": "s1", "text": "x"}', [session('s1', { state: 'exited' })]],
      ['invalid', '{"session": "s1", "text": "   "}', [session('s1')]],
      ['bash-mode', '{"session": "s1", "text": "  !rm -rf ~"}', [session('s1')]]
    ])('an %s session gives no card, the text stays', async (_why, block, sessions) => {
      const { chat, out } = await askWith(block, sessions);
      expect(out.find(m => m.type === 'chat.done')).toEqual({ type: 'chat.done', qid: 'q1', text: 'Je transmets à Otto.', at: expect.any(String) });
      expect(chat.relay('q1')).toBeUndefined();
    });

    it('markRelay replaces the state fields and tells every client; queuedRelays lists the queued ones, oldest first', async () => {
      const { chat } = await askWith('{"session": "s1", "text": "a"}', [session('s1')]);
      await chat.ask('q2', 'et dis-lui aussi b', () => {});
      const emitted: ServerMessage[] = [];
      chat.markRelay('q2', { status: 'queued' }, m => emitted.push(m));
      chat.markRelay('q1', { status: 'queued' }, m => emitted.push(m));
      expect(emitted.map(m => m.type)).toEqual(['chat.history', 'chat.history']);
      expect(chat.queuedRelays().map(r => r.qid)).toEqual(['q1', 'q2']);
      chat.markRelay('q1', { error: 'Otto stopped before it got the instruction' }, () => {});
      expect(chat.relay('q1')).toEqual({ id: 's1', name: 'Otto', tool: 'codex', text: 'a', error: 'Otto stopped before it got the instruction' });
      chat.markRelay('q1', { status: 'sent', sentAt: '2026-10-11T09:00:00.000Z' }, () => {});
      expect(chat.relay('q1')).toEqual({ id: 's1', name: 'Otto', tool: 'codex', text: 'a', status: 'sent', sentAt: '2026-10-11T09:00:00.000Z' });
      chat.markRelay('q2', {}, () => {});
      expect(chat.queuedRelays()).toEqual([]);
    });

    it('a reset or a new day takes the queue away', async () => {
      let day = '2026-10-11';
      const { chat } = await askWith('{"session": "s1", "text": "a"}', [session('s1')], { today: () => day });
      chat.markRelay('q1', { status: 'queued' }, () => {});
      day = '2026-10-12';
      const histories: ServerMessage[] = [];
      expect(chat.queuedRelays(m => histories.push(m))).toEqual([]);
      expect(chat.relay('q1')).toBeUndefined();
      expect(histories).toEqual([{ type: 'chat.history', turns: [] }]);
      const again = await askWith('{"session": "s1", "text": "a"}', [session('s1')]);
      again.chat.markRelay('q1', { status: 'queued' }, () => {});
      await again.chat.reset(() => {});
      expect(again.chat.queuedRelays()).toEqual([]);
    });
  });
});

describe('ledge-action blocks (spec 2026-10-26 action registry §3)', () => {
  const act = (action: string, args: object) => '```ledge-action\n' + JSON.stringify({ action, args }) + '\n```';
  const session = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: id.toUpperCase(), tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${id} · ledge`,
    tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: '2026-10-11T08:00:00.000Z', lastActivityAt: '2026-10-11T08:00:00.000Z', source: 'launcher', ...extra });
  const askWith = async (answer: string, sessions: Session[], extra: Partial<Parameters<typeof createChat>[0]> = {}) => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    writeFileSync(join(home, 'chat.json'), JSON.stringify({ day: '2026-10-11', sessionId: '22222222-2222-4222-8222-222222222222' }));
    const store = new Store({ journalPath: join(home, 'j.json') });
    for (const x of sessions) store.upsert(x);
    const chat = createChat({ store, tmux, home, today: () => '2026-10-11', now: () => '2026-10-11T09:00:00.000Z', env: async () => ({ ...process.env, FAKE_ANSWER: answer }), bin: [process.execPath, FAKE], ...extra });
    const out: ServerMessage[] = [];
    logged.length = 0;
    await chat.ask('q1', 'x', m => out.push(m));
    return { chat, done: out.find(m => m.type === 'chat.done') as Extract<ServerMessage, { type: 'chat.done' }> };
  };

  it('an earlier card written as ledge-action gives the same card', async () => {
    const { chat, done } = await askWith('Je ferme.\n\n' + act('session.close', { session: 'a1' }) + '\n' + act('session.close', { session: 'b2' }), [session('a1', { name: 'Arlo' }), session('b2', { name: 'Bram' })]);
    expect(done.closes).toEqual([{ id: 'a1', name: 'Arlo', tool: 'claude' }, { id: 'b2', name: 'Bram', tool: 'claude' }]);
    expect(done.text).toBe('Je ferme.');
    expect(chat.history()[0]).not.toHaveProperty('actions');
  });
  it('a launch written as ledge-action keeps the model and effort asked for', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const { done } = await askWith(act('session.launch', { cwd: dir, prompt: 'go', model: 'claude-opus-5-5', effort: 'high' }), []);
    expect(done.proposals).toEqual([{ cwd: dir, project: basename(dir), tool: 'claude', prompt: 'go', model: 'claude-opus-5-5', effort: 'high' }]);
  });
  it('a generic action becomes a row of turn.actions, joined to chat.done, with the names resolved', async () => {
    const { chat, done } = await askWith('Je range Arlo.\n\n' + act('session.archive', { session: 'Arlo' }), [session('a1', { name: 'Arlo' })]);
    const row = { action: 'session.archive', args: { session: 'a1' }, summary: 'Archiver **Arlo**', risk: 'reversible', session: 'a1' };
    expect(done.actions).toEqual([row]);
    expect(done.text).toBe('Je range Arlo.');
    expect(chat.history()[0]!.actions).toEqual([row]);
    expect(chat.action('q1', 0)).toEqual(row);
  });
  it('drops a refused or invalid action with a log line, and gives no row', async () => {
    const answer = act('session.archive', { session: 'Zed' }) + act('session.kill', { session: 'a1' }) + act('session.decide', { session: 'a1', decision: 'always' });
    const { chat, done } = await askWith(answer, [session('a1')]);
    expect(done).not.toHaveProperty('actions');
    expect(chat.history()[0]).not.toHaveProperty('actions');
    expect(logged.filter(l => l.includes('action ignored'))).toEqual([
      'chat q1: action ignored: unknown action session.kill', expect.stringContaining('chat q1: action ignored: invalid args for session.decide'), 'chat q1: action ignored: unknown session Zed'
    ]);
  });
  it('generic rows sit beside an earlier card: the last earlier block still decides that card', async () => {
    const answer = act('session.close', { session: 'a1' }) + act('session.archive', { session: 'b2' });
    const { done } = await askWith(answer, [session('a1', { name: 'Arlo' }), session('b2', { name: 'Bram' })]);
    expect(done.closes).toEqual([{ id: 'a1', name: 'Arlo', tool: 'claude' }]);
    expect(done.actions?.map(a => a.action)).toEqual(['session.archive']);
  });
  it('caps rows per action and at 8 in all', async () => {
    const pending = { kind: 'permission' as const, text: 'Bash: rm x', source: 'hook' as const };
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const answer = act('session.decide', { session: 's0', decision: 'deny' }) + act('session.decide', { session: 's0', decision: 'accept' }) + ids.map(id => act('session.archive', { session: id })).join('');
    const { done } = await askWith(answer, ids.map(id => session(id, id === 's0' ? { state: 'waiting_permission' as const, pending } : {})));
    expect(done.actions).toHaveLength(8);
    expect(done.actions!.filter(a => a.action === 'session.decide')).toHaveLength(1);
    expect(logged).toContain('chat q1: 1 session.decide beyond 1 ignored');
    expect(logged).toContain('chat q1: 3 actions beyond 8 ignored');
  });
  it('marks a row running, done or failed for every client', async () => {
    const { chat } = await askWith(act('session.archive', { session: 'a1' }), [session('a1')]);
    const out: ServerMessage[] = [];
    chat.markAction('q1', 0, { state: 'failed', error: 'busy' }, m => out.push(m));
    expect(chat.action('q1', 0)).toMatchObject({ state: 'failed', error: 'busy' });
    chat.markAction('q1', 0, { state: 'done', doneAt: '2026-10-11T09:00:00.000Z' }, m => out.push(m));
    expect(chat.action('q1', 0)).toMatchObject({ state: 'done', doneAt: '2026-10-11T09:00:00.000Z' });
    expect(chat.action('q1', 0)).not.toHaveProperty('error');
    chat.markAction('q1', 4, { state: 'done' }, m => out.push(m));
    expect(out.map(m => m.type)).toEqual(['chat.history', 'chat.history']);
  });
});

describe('chat service slots and idle', () => {
  const kid = (code: number) => (() => {
    const child: any = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { child.emit('close', null); } });
    setImmediate(() => setImmediate(() => child.emit('close', code)));
    return child;
  }) as unknown as typeof nodeSpawn;
  it('refuses with TOO_MANY when no slot is free, and gives the slot back whatever the outcome', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    let free = 1; const slots = { take: () => (free > 0 ? (free--, true) : false), give: () => { free++; } };
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', env: async () => ({ ...process.env }), spawn: kid(1), slots });
    const out: ServerMessage[] = [];
    await chat.ask('q1', 'x', m => out.push(m));
    expect(free).toBe(1);
    free = 0;
    await chat.ask('q2', 'x', m => out.push(m));
    expect(out.at(-1)).toEqual({ type: 'chat.error', qid: 'q2', message: TOO_MANY });
  });
  it('idle resolves at once without a question, and after the running one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-'));
    const chat = createChat({ store: new Store({ journalPath: join(home, 'j.json') }), tmux, home, today: () => '2026-10-11', env: async () => ({ ...process.env }), spawn: kid(1) });
    await chat.idle();
    const p = chat.ask('q1', 'x', () => {}); let idled = false;
    const i = chat.idle().then(() => { idled = true; });
    expect(idled).toBe(false);
    await p; await i; expect(idled).toBe(true);
  });
});
