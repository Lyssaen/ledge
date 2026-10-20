import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/daemon/store.js';
import { createOmpHost, ompArgs, type OmpHost } from '../src/daemon/omp/host.js';
import { answerFor, askAnswerFor, askQuestions, newTracking, project } from '../src/daemon/omp/project.js';
import { ompChoices } from '../src/daemon/omp/catalog.js';
import { until } from './helpers.js';
import { filesOf } from '../src/daemon/files.js';
import { History } from '../src/daemon/history.js';

const FAKE = [process.execPath, fileURLToPath(new URL('./fake-omp.mjs', import.meta.url))];
const T = '2026-10-20T12:00:00.000Z';
let store: Store; let host: OmpHost; let dir: string; let log: string;
const cmds = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { argv?: string[]; cmd?: { type: string; message?: string } }) : []);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledge-omp-')); log = join(dir, 'fake.log'); process.env.FAKE_OMP_LOG = log;
  store = new Store();
  host = createOmpHost({ store, env: async () => ({ ...process.env }), dir: join(dir, 'omp'), command: FAKE });
});
afterEach(async () => { await host.closeAll(); delete process.env.FAKE_OMP_LOG; delete process.env.FAKE_OMP_DIE; });

describe('ompArgs', () => {
  it('asks before writes and executions, names the session folder and the conversation file, never --no-ui or --yolo', () => {
    const a = ompArgs({ dir: '/s/1', cwd: '/w', dirs: ['/x', '/y'], model: 'anthropic/claude-opus-5-5', effort: 'high', resumeFile: '/s/1/a.jsonl' });
    expect(a).toEqual(['--mode', 'rpc-ui', '--session-dir', '/s/1', '--cwd', '/w', '--approval-mode', 'always-ask', '--model', 'anthropic/claude-opus-5-5', '--thinking', 'high', '--add-dir', '/x', '--add-dir', '/y', '--resume', '/s/1/a.jsonl']);
    expect(a).not.toContain('--no-ui'); expect(a.join(' ')).not.toMatch(/yolo|auto-approve/);
  });
  it('without a model or an effort, OMP keeps its own', () => {
    expect(ompArgs({ dir: '/s', cwd: '/w' })).toEqual(['--mode', 'rpc-ui', '--session-dir', '/s', '--cwd', '/w', '--approval-mode', 'always-ask']);
  });
});

describe('OmpHost', () => {
  it('launch: an idle session with no pane, the real conversation file and model, started in the folder with its own journal directory', async () => {
    const s = await host.launch({ cwd: tmpdir(), model: 'openai-codex/gpt-6.1-sol', effort: 'low' });
    expect(s).toMatchObject({ tool: 'omp', backend: 'omp-rpc', tmuxSession: null, state: 'idle', source: 'launcher', agentSessionId: 'fake-session', model: 'openai-codex/gpt-6.1-sol', effort: 'low' });
    expect(s.agentSessionFile).toBe(join(dir, 'omp', s.id, '2026-10-20T00-00-00-000Z_fake-session.jsonl'));
    expect(store.get(s.id)).toMatchObject({ id: s.id, state: 'idle' });
    expect(cmds()[0]!.argv).toContain(join(dir, 'omp', s.id));
  });
  it('launch failure (no credentials): throws OMP\'s reason and leaves nothing in the store', async () => {
    process.env.FAKE_OMP_DIE = '1';
    await expect(host.launch({ cwd: tmpdir() })).rejects.toThrow(/no credentials/);
    expect(store.all()).toEqual([]);
  });
  it('a turn: working with the prompt, idle with the reply only once the session settles, thread events for the tool', async () => {
    const s = await host.launch({ cwd: tmpdir() });
    const events: string[] = []; store.onEvent((id, e) => events.push(e.name));
    await host.send(s.id, 'hello');
    await until(() => store.get(s.id)!.state === 'idle' && !!store.get(s.id)!.lastReply);
    expect(store.get(s.id)).toMatchObject({ state: 'idle', topic: 'hello', lastReply: { text: 'done: hello' } });
    expect(events.filter(n => n !== 'AgentMessage')).toEqual(['UserPromptSubmit', 'Stop']);
  });
  it('an approval is a pending question with OMP\'s own options; answering by number or exact text unblocks the tool', async () => {
    const s = await host.launch({ cwd: tmpdir() });
    await host.send(s.id, 'run a tool');
    await until(() => store.get(s.id)!.state === 'waiting_input');
    expect(store.get(s.id)!.pending).toEqual({ kind: 'question', text: 'Allow tool: bash\nCommand: echo hi', options: ['Approve', 'Approve bash for this session', 'Deny'], requestId: 'q1', source: 'rpc', tool: 'omp' });
    expect(await host.answer(s.id, 'Maybe')).toMatch(/not one of the options/);
    expect(store.get(s.id)!.state).toBe('waiting_input');
    expect(await host.answer(s.id, '1')).toBeNull();
    await until(() => store.get(s.id)!.state === 'idle');
    expect(store.get(s.id)!.lastReply?.text).toBe('done: run a tool');
    expect(await host.answer(s.id, '1')).toBe('nothing to answer'); // no second answer to a request that is gone
  });
  it('denying reaches OMP as its own Deny option', async () => {
    const s = await host.launch({ cwd: tmpdir() });
    await host.send(s.id, 'run a tool');
    await until(() => store.get(s.id)!.state === 'waiting_input');
    expect(await host.answer(s.id, 'Deny')).toBeNull();
    await until(() => store.get(s.id)!.state === 'idle');
  });
  it('send while OMP works queues a follow_up; interrupt aborts the work and the session settles', async () => {
    const s = await host.launch({ cwd: tmpdir() });
    await host.send(s.id, 'slow one');
    await until(() => store.get(s.id)!.state === 'working');
    await host.send(s.id, 'and then this', 'follow_up');
    await host.interrupt(s.id);
    expect(cmds().filter(c => c.cmd).map(c => c.cmd!.type)).toEqual(['negotiate_protocol', 'set_ask_dialog', 'set_subagent_subscription', 'get_state', 'prompt', 'follow_up', 'abort']);
  });
  it('a follow_up waits for the turn to end, and its prompt enters the thread when its turn starts, once; the first prompt is not recorded twice', async () => {
    const s = await host.launch({ cwd: tmpdir() });
    const texts: string[] = []; store.onEvent((_id, e) => { if (e.name === 'UserPromptSubmit' && e.text) texts.push(e.text); });
    await host.send(s.id, 'first turn with a tool');
    await until(() => store.get(s.id)!.state === 'waiting_input'); // the turn is still running
    await host.send(s.id, 'and then this', 'follow_up');
    expect(await host.answer(s.id, '1')).toBeNull();
    await until(() => store.get(s.id)!.state === 'idle' && store.get(s.id)!.lastReply?.text === 'done: and then this');
    expect(texts).toEqual(['first turn with a tool', 'and then this']);
  });
  it('an unexpected exit ends the session with its signal state; a requested close reports nothing of its own', async () => {
    const a = await host.launch({ cwd: tmpdir() });
    await host.close(a.id);
    expect(store.get(a.id)!.state).toBe('idle'); // the caller records a requested end
    expect(host.isLive(a.id)).toBe(false);
    const b = await host.launch({ cwd: tmpdir() });
    await host.send(b.id, 'slow one');
    process.kill(host.pidOf(b.id)!, 'SIGKILL');
    await until(() => store.get(b.id)!.state === 'exited');
    expect(store.get(b.id)).toMatchObject({ state: 'exited', exitCode: null });
    expect(host.isLive(b.id)).toBe(false);
    await expect(host.send(b.id, 'again')).rejects.toThrow('not running');
  });
  it('catalog: the models OMP offers, once, in a process of its own', async () => {
    const c = await host.catalog(tmpdir());
    expect(c.models).toHaveLength(3);
    expect(cmds().at(0)!.argv).toContain('--no-session');
  });
});

describe('project', () => {
  const run = (frames: Array<Record<string, unknown>>) => { const t = newTracking(); return { t, events: frames.flatMap(f => project(f as { type: string }, t, T)) }; };
  it('one agent_start per turn, however many turns the agent restarts itself', () => {
    expect(run([{ type: 'agent_start' }, { type: 'agent_start' }]).events.map(e => e.name)).toEqual(['UserPromptSubmit']);
  });
  it('the reply is the last assistant text, carried by the Stop of session_settled, not by agent_end', () => {
    const msg = (text: string) => ({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } });
    const { events } = run([{ type: 'agent_start' }, msg('first'), { type: 'agent_end', messages: [] }]);
    expect(events.map(e => e.name)).toEqual(['UserPromptSubmit']); // an agent_end alone settles nothing: a task may restart the agent
    expect(run([{ type: 'agent_start' }, msg('first'), msg('final'), { type: 'session_settled' }]).events.at(-1)).toMatchObject({ name: 'Stop', text: 'final' });
  });
  it('tools: by toolCallId, results as text, a failure with its message', () => {
    const { events } = run([
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: { command: 'ls' }, intent: 'Listing' },
      { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', result: { content: [{ type: 'text', text: 'a\nb' }] }, isError: false },
      { type: 'tool_execution_end', toolCallId: 'c2', toolName: 'edit', result: { content: [{ type: 'text', text: 'no match' }] }, isError: true }
    ]);
    expect(events[0]).toMatchObject({ name: 'PreToolUse', tool: 'bash', toolUseId: 'c1', text: 'Listing', toolInput: { command: 'ls' } });
    expect(events[1]).toMatchObject({ name: 'PostToolUse', toolUseId: 'c1', output: 'a\nb' });
    expect(events[2]).toMatchObject({ name: 'PostToolUseFailure', toolUseId: 'c2', error: 'no match' });
  });
  it('dialogs: the first holds the card, the next waits; a cancel from OMP closes it without any answer attributed to the user', () => {
    const ask = (id: string, title: string) => ({ type: 'extension_ui_request', id, method: 'select', title, options: ['A', 'B'] });
    const { t, events } = run([ask('1', 'first'), ask('2', 'second'), { type: 'extension_ui_request', id: 'x', method: 'setWidget' }]);
    expect(events).toHaveLength(1); expect(t.requests.map(r => r.id)).toEqual(['1', '2']);
    const after = project({ type: 'extension_ui_request', method: 'cancel', targetId: '1', id: 'c' }, t, T);
    expect(after.map(e => e.name)).toEqual(['Decided', 'NativeRequest']);
    expect(after[0]!.decision).toBeUndefined(); expect(after[1]).toMatchObject({ text: 'second' });
  });
  it('a failed instruction is an error state; a completed one says nothing', () => {
    expect(run([{ type: 'prompt_result', id: 'p', status: 'completed' }]).events).toEqual([]);
    expect(run([{ type: 'prompt_result', id: 'p', status: 'failed', error: 'quota' }]).events[0]).toMatchObject({ name: 'StopFailure', text: 'quota' });
  });
  it('answerFor: options by number or exact text; confirm as a boolean; input as text; nothing else', () => {
    const sel = { id: 'q', method: 'select' as const, title: 't', options: ['Approve', 'Deny'] };
    expect(answerFor(sel, '2')).toEqual({ frame: { type: 'extension_ui_response', id: 'q', value: 'Deny' } });
    expect(answerFor(sel, 'Approve')).toEqual({ frame: { type: 'extension_ui_response', id: 'q', value: 'Approve' } });
    expect(answerFor(sel, '3')).toMatchObject({ refused: expect.any(String) });
    expect(answerFor({ id: 'c', method: 'confirm', title: 't' }, '1')).toEqual({ frame: { type: 'extension_ui_response', id: 'c', confirmed: true } });
    expect(answerFor({ id: 'c', method: 'confirm', title: 't' }, 'No')).toEqual({ frame: { type: 'extension_ui_response', id: 'c', confirmed: false } });
    expect(answerFor({ id: 'i', method: 'input', title: 't' }, 'some text')).toEqual({ frame: { type: 'extension_ui_response', id: 'i', value: 'some text' } });
    expect(answerFor({ id: 'i', method: 'input', title: 't' }, '  ')).toEqual({ refused: 'empty reply' });
  });
});

describe('streamed text', () => {
  it('a message is one card of the thread that grows, its id never reused by a resumed process; the Stop adds no second card', async () => {
    const h = new History(); store.onEvent((id, e) => h.record(id, e));
    const s = await host.launch({ cwd: tmpdir() });
    await host.send(s.id, 'stream something');
    await until(() => h.items(s.id).some(i => i.kind === 'reply'));
    const first = h.items(s.id).find(i => i.kind === 'reply') as { id: string; text: string };
    expect(first.text.length).toBeLessThan('done: stream something'.length); // seen while the message is still being written
    await until(() => store.get(s.id)!.state === 'idle' && !!store.get(s.id)!.lastReply);
    const replies = h.items(s.id).filter(i => i.kind === 'reply') as Array<{ id: string; text: string }>;
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id: first.id, text: 'done: stream something' });
    expect(store.get(s.id)!.lastReply!.text).toBe('done: stream something');
    await host.close(s.id);
    const again = await host.launch({ id: s.id, name: s.name, cwd: tmpdir(), resumeFile: s.agentSessionFile });
    await host.send(again.id, 'second');
    await until(() => (h.items(s.id).filter(i => i.kind === 'reply').length === 2));
    expect(new Set(h.items(s.id).filter(i => i.kind === 'reply').map(i => i.id)).size).toBe(2);
  });
});

describe('files changed by OMP (spec §3.2: a change counts once its result says it happened)', () => {
  const frames = (name: string, args: unknown, details: unknown, isError = false) => [
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: name, args },
    { type: 'tool_execution_end', toolCallId: 'c1', toolName: name, result: { content: [{ type: 'text', text: 'ok' }], details }, isError }
  ];
  const events = (fs: Array<Record<string, unknown>>) => { const t = newTracking(); return fs.flatMap(f => project(f as { type: string }, t, T)); };
  it('a write is listed from its path and content; an edit from the path and the diff OMP reports, without its line numbers', () => {
    expect(filesOf('write', { path: 'a.txt', content: 'hello\nworld' })).toEqual([{ path: 'a.txt', change: 'write', diff: '+ hello\n+ world' }]);
    expect(filesOf('edit', { input: '[b.txt#0127]\nPUT 2.=2:\n+2' })).toEqual([]); // the call alone names no file
    expect(filesOf('edit', { path: '/w/b.txt', diff: ' 1|one\n-2|two\n+2|2' })).toEqual([{ path: '/w/b.txt', change: 'edit', diff: '- two\n+ 2' }]);
    expect(filesOf('write', { file_path: '/x', path: 'y' })).toEqual([]); // not another harness's Write
  });
  it('the finished edit carries path and diff for the thread; a failed one carries nothing', () => {
    const ok = events(frames('edit', { input: 'x' }, { path: '/w/b.txt', diff: ' 1|one\n-2|two\n+2|2' }));
    expect(ok[1]).toMatchObject({ name: 'PostToolUse', tool: 'edit', toolInput: { path: '/w/b.txt', diff: ' 1|one\n-2|two\n+2|2' } });
    expect(events(frames('edit', { input: 'x' }, { path: '/w/b.txt', diff: '+1|a' }, true))[1]).not.toHaveProperty('toolInput');
    expect(events(frames('write', { path: 'a.txt', content: 'hi' }, { resolvedPath: '/w/a.txt' }))[1]).toMatchObject({ toolInput: { path: '/w/a.txt', content: 'hi' } });
  });
  it('in the thread: an edit denied is a failed action with no file, one that succeeded lists its file with the diff', () => {
    const h = new History();
    for (const e of events(frames('edit', { input: 'x' }, { path: '/w/b.txt', diff: ' 1|one\n-2|two\n+2|2' }))) h.record('s', e);
    expect(h.items('s')[0]).toMatchObject({ kind: 'tool', tool: 'edit', status: 'success', files: [{ path: '/w/b.txt', change: 'edit', diff: '- two\n+ 2' }] });
    for (const e of events(frames('edit', { input: 'x' }, {}, true))) h.record('t', e);
    expect(h.items('t')[0]).toMatchObject({ status: 'failed', files: [] });
  });
});

describe('ask: every question of one call, answered together', () => {
  const raw = [{ id: 'color', question: 'Favorite color?', header: 'Color', multi: true, options: [{ label: 'red' }, { label: 'blue', description: 'the sea' }] }, { id: 'name', question: 'Your name?', options: [{ label: 'skip' }] }];
  const req = { id: 'r', method: 'ask' as const, title: 't', questions: askQuestions(raw)! };
  it('reads the questions as OMP sends them, and nothing from a shape it does not know', () => {
    expect(req.questions).toEqual([{ id: 'color', question: 'Favorite color?', header: 'Color', multi: true, options: [{ label: 'red' }, { label: 'blue', description: 'the sea' }] }, { id: 'name', question: 'Your name?', options: [{ label: 'skip' }] }]);
    expect(askQuestions('x')).toBeUndefined(); expect(askQuestions([{ id: 1 }])).toBeUndefined();
  });
  it('an unreadable ask is not shown (and so never answered blind); a readable one is a pending question with its questions and request id', () => {
    const t = newTracking();
    expect(project({ type: 'extension_ui_request', id: 'r', method: 'ask', questions: [{}] }, t, T)).toEqual([]);
    const [e] = project({ type: 'extension_ui_request', id: 'r', method: 'ask', questions: raw } as never, newTracking(), T);
    expect(e).toMatchObject({ name: 'NativeRequest', text: 'Favorite color? · Your name?', requestId: 'r', questions: req.questions });
    expect(e).not.toHaveProperty('options'); // several questions: no one-tap answer
    const lone = project({ type: 'extension_ui_request', id: 'r', method: 'ask', questions: [raw[1]] } as never, newTracking(), T)[0]!;
    expect(lone.options).toEqual(['skip']);
  });
  it('askAnswerFor: one answer per question in order, choices among the labels, one only unless multi, free text kept as customInput', () => {
    expect(askAnswerFor(req, [{ id: 'color', selected: ['red', 'blue'] }, { id: 'name', selected: [], text: ' Joe ' }])).toEqual({ frame: { type: 'extension_ui_response', id: 'r', answers: [{ id: 'color', selectedOptions: ['red', 'blue'] }, { id: 'name', selectedOptions: [], customInput: 'Joe' }] } });
    expect(askAnswerFor(req, [{ id: 'color', selected: ['red'] }])).toMatchObject({ refused: 'OMP asks 2 questions' });
    expect(askAnswerFor(req, [{ id: 'name', selected: ['skip'] }, { id: 'color', selected: ['red'] }])).toMatchObject({ refused: expect.stringContaining('not for') });
    expect(askAnswerFor(req, [{ id: 'color', selected: ['green'] }, { id: 'name', selected: ['skip'] }])).toMatchObject({ refused: expect.stringContaining('not a choice') });
    expect(askAnswerFor(req, [{ id: 'color', selected: [] }, { id: 'name', selected: ['skip'] }])).toMatchObject({ refused: expect.stringContaining('no answer') });
    expect(askAnswerFor(req, [{ id: 'color', selected: ['red'] }, { id: 'name', selected: ['skip', 'skip'] }])).toMatchObject({ refused: expect.any(String) });
    const single = { ...req, questions: [{ ...req.questions[0]!, multi: false }] };
    expect(askAnswerFor(single, [{ id: 'color', selected: ['red', 'blue'] }])).toMatchObject({ refused: expect.stringContaining('takes one choice') });
  });
  it('answerFor: a digit answers a lone single-choice question; several questions are refused there', () => {
    expect(answerFor({ ...req, questions: [req.questions[1]!] }, '1')).toEqual({ frame: { type: 'extension_ui_response', id: 'r', answers: [{ id: 'name', selectedOptions: ['skip'] }] } });
    expect(answerFor(req, '1')).toMatchObject({ refused: expect.stringContaining('card') });
  });
  it('through the host: the card answers with the right request id, a stale id or a second answer writes nothing, cancel declines', async () => {
    const s = await host.launch({ cwd: tmpdir() });
    await host.send(s.id, 'ask two things');
    await until(() => store.get(s.id)!.state === 'waiting_input');
    expect(store.get(s.id)!.pending).toMatchObject({ requestId: 'ask1', questions: expect.any(Array), source: 'rpc' });
    expect(await host.answerAsk(s.id, 'old', [])).toBe('the request changed, look again');
    expect(await host.answerAsk(s.id, 'ask1', [{ id: 'color', selected: ['red'] }])).toMatch(/asks 2 questions/);
    expect(store.get(s.id)!.state).toBe('waiting_input');
    expect(await host.answerAsk(s.id, 'ask1', [{ id: 'color', selected: ['red', 'blue'] }, { id: 'name', selected: [], text: 'Joe' }])).toBeNull();
    await until(() => store.get(s.id)!.state === 'idle');
    expect(await host.answerAsk(s.id, 'ask1', [])).toBe('the request changed, look again');
    await host.send(s.id, 'ask two more');
    await until(() => store.get(s.id)!.state === 'waiting_input');
    expect(await host.answerAsk(s.id, 'ask1', [], true)).toBeNull();
    await until(() => store.get(s.id)!.state === 'idle');
  });
});

describe('subagents (task)', () => {
  it('a helper starts with its kind, learns its task from its assignment, owns its actions and message, and ends with its report; the parent\'s state is untouched', async () => {
    const h = new History(); store.onEvent((id, e) => h.record(id, e));
    const s = await host.launch({ cwd: tmpdir() });
    await host.send(s.id, 'launch a subagent please');
    await until(() => store.get(s.id)!.state === 'idle' && !!store.get(s.id)!.lastReply);
    expect(store.get(s.id)!.helpers).toEqual([expect.objectContaining({ id: 'EchoSub', kind: 'sonic', task: 'Run the bash command: echo sub', state: 'exited' })]);
    const items = h.items(s.id);
    expect(items.find(i => i.kind === 'helper')).toMatchObject({ id: 'EchoSub', task: 'Run the bash command: echo sub', state: 'exited', agentType: 'sonic' });
    expect(items.find(i => i.kind === 'tool' && i.tool === 'bash')).toMatchObject({ helperId: 'EchoSub', status: 'success' });
    expect(items.find(i => i.kind === 'reply' && i.helperId === 'EchoSub')).toMatchObject({ text: 'The output is sub' });
    expect(items.find(i => i.kind === 'reply' && i.helperId === 'EchoSub' && i.id.startsWith('report-'))).toMatchObject({ text: 'The output is sub' });
    expect(items.filter(i => i.kind === 'reply' && !i.helperId)).toHaveLength(1); // the parent's own reply, once
  });
  it('a helper still running when the turn ends keeps working until its own end', async () => {
    const s = await host.launch({ cwd: tmpdir() });
    await host.send(s.id, 'launch a subagent please and be slow');
    await until(() => store.get(s.id)!.helpers.length === 1);
    expect(store.get(s.id)!.helpers[0]).toMatchObject({ id: 'EchoSub', state: 'working' });
    await host.interrupt(s.id);
    await until(() => store.get(s.id)!.helpers[0]!.state === 'exited');
  });
});

describe('the work plan (todo)', () => {
  it('a finished todo call carries the whole plan OMP reports, which the thread keeps as the action\'s input', () => {
    const phases = [{ name: 'Tasks', tasks: [{ content: 'alpha', status: 'completed' }, { content: 'beta', status: 'pending' }] }];
    const t = newTracking(); const h = new History();
    for (const f of [{ type: 'tool_execution_start', toolCallId: 'c', toolName: 'todo', args: { op: 'init', items: ['alpha', 'beta'] } },
      { type: 'tool_execution_end', toolCallId: 'c', toolName: 'todo', result: { content: [{ type: 'text', text: 'ok' }], details: { op: 'done', phases } }, isError: false }])
      for (const e of project(f as { type: string }, t, T)) h.record('s', e);
    const item = h.items('s')[0] as { input: string };
    expect(JSON.parse(item.input)).toEqual({ phases });
  });
});

describe('ompChoices', () => {
  it('provider/id identifies the model, the current one is the default, efforts are the model\'s own, flag-looking ids are dropped', () => {
    const c = ompChoices({ current: { id: 'claude-opus-5-5', provider: 'anthropic' }, models: [
      { id: 'claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5', thinking: { efforts: ['low', 'max', 'Not An Effort'] } },
      { id: 'gpt-6.1-sol', provider: 'openai-codex', name: 'GPT-6.1-Sol' },
      { id: '-p', provider: 'evil' }, { provider: 'x' }, 'nope'
    ] });
    expect(c).toEqual([
      { id: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5', description: 'anthropic', efforts: ['low', 'max'], isDefault: true },
      { id: 'openai-codex/gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'openai-codex' }
    ]);
  });
});
