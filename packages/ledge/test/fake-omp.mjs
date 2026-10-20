#!/usr/bin/env node
// A scripted stand-in for `omp --mode rpc-ui` (frames recorded from OMP 18.12.3). FAKE_OMP_LOG: a file receiving each argv and command.
import { appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i === -1 ? undefined : argv[i + 1]; };
const log = o => { if (process.env.FAKE_OMP_LOG) appendFileSync(process.env.FAKE_OMP_LOG, `${JSON.stringify(o)}\n`); };
log({ argv });
let v2 = false; let chunkSeq = 0;
const SLICE = Number(process.env.FAKE_OMP_SLICE ?? 100000);
// Protocol 2 (as OMP 18.12.3 does): a frame over the limit travels as base64 chunks of its UTF-8 bytes, slices cut anywhere.
const out = f => {
  const text = JSON.stringify(f);
  const bytes = Buffer.from(text);
  if (!v2 || bytes.length <= 1048576 * (Number(process.env.FAKE_OMP_LIMIT ?? 1))) return process.stdout.write(`${text}\n`);
  const count = Math.ceil(bytes.length / SLICE); const chunkId = `rpc-${++chunkSeq}`;
  for (let i = 0; i < count; i++) process.stdout.write(`${JSON.stringify({ type: 'rpc_chunk', chunkId, index: i, count, byteLength: bytes.length, data: bytes.subarray(i * SLICE, (i + 1) * SLICE).toString('base64') })}\n`);
};

if (process.env.FAKE_OMP_DIE) { process.stderr.write('omp: no credentials\n'); process.exit(Number(process.env.FAKE_OMP_DIE)); }

const dir = arg('--session-dir');
const resume = arg('--resume');
let sessionFile = resume;
if (!sessionFile && dir) { mkdirSync(dir, { recursive: true }); sessionFile = join(dir, '2026-10-20T00-00-00-000Z_fake-session.jsonl'); if (!existsSync(sessionFile)) writeFileSync(sessionFile, ''); }
const model = { id: arg('--model')?.split('/').pop() ?? 'claude-opus-5-5', provider: arg('--model')?.split('/')[0] ?? 'anthropic', name: 'Fake', reasoning: true, thinking: { mode: 'anthropic-adaptive', efforts: ['low', 'medium', 'high'] } };
let thinking = arg('--thinking') ?? 'high';
const queueUpdate = () => out({ type: 'queue_update', steering: queued.steering, followUp: queued.followUp, liveSteered: 0 });
let settled = true; let queued = { steering: [], followUp: [] };
let sessionName = '';
const state = () => ({ sessionName, model, thinkingLevel: thinking, isStreaming: !settled, isCompacting: false, sessionFile, sessionId: 'fake-session', isSettled: settled, queuedMessageCount: queued.steering.length + queued.followUp.length, queuedMessages: { ...queued, liveSteered: 0 }, hasPendingAsyncWork: false, todoPhases: [], messageCount: 0 });

out({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864 });
out({ type: 'extension_ui_request', id: 'w1', method: 'setWidget', widgetKey: 'autoresearch' });

let msgs = 1; let waiting = null; // the open dialog: resolves with the response frame
const ask = frame => new Promise(res => { waiting = res; out({ type: 'extension_ui_request', ...frame }); });
const text = t => ({ role: 'assistant', content: [{ type: 'text', text: t }], provider: model.provider, model: model.id });

async function turn(id, message) {
  settled = false;
  if (id) out({ id, type: 'response', command: 'prompt', success: true });
  out({ type: 'agent_start' }); out({ type: 'turn_start' });
  out({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: message }], attribution: 'user' }, messageId: 'msg-1' });
  out({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: message }], attribution: 'user' }, messageId: 'msg-1' });
  if (message.includes('run a tool') || message.includes('with a tool')) {
    out({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'echo hi' }, intent: 'Running echo' });
    const r = await ask({ id: 'q1', method: 'select', title: 'Allow tool: bash\nCommand: echo hi', options: ['Approve', 'Approve bash for this session', 'Deny'] });
    if (r.cancelled || r.value === 'Deny') out({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'denied' }] }, isError: true });
    else out({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'hi\n' }] }, isError: false });
  }
  if (message.includes('a subagent')) {
    const P = { id: 'EchoSub', agent: 'sonic', parentToolCallId: 'task1', detached: true, status: 'started' };
    out({ type: 'tool_execution_start', toolCallId: 'task1', toolName: 'task', args: {} });
    out({ type: 'subagent_lifecycle', payload: P });
    out({ type: 'subagent_progress', payload: { index: 0, agent: 'sonic', assignment: '# Target\nRun the bash command: echo sub\n# Acceptance\nReport.', progress: { index: 0, id: 'EchoSub', status: 'running' } } });
    out({ type: 'subagent_event', payload: { id: 'EchoSub', event: { type: 'agent_start' } } });
    out({ type: 'subagent_event', payload: { id: 'EchoSub', event: { type: 'tool_execution_start', toolCallId: 'h1', toolName: 'bash', args: { command: 'echo sub' } } } });
    out({ type: 'subagent_event', payload: { id: 'EchoSub', event: { type: 'tool_execution_end', toolCallId: 'h1', toolName: 'bash', result: { content: [{ type: 'text', text: 'sub\n' }] }, isError: false } } });
    out({ type: 'subagent_event', payload: { id: 'EchoSub', event: { type: 'message_end', messageId: 'msg-1', message: text('The output is sub') } } });
    out({ type: 'tool_execution_end', toolCallId: 'task1', toolName: 'task', result: { content: [{ type: 'text', text: 'Spawned' }] }, isError: false });
    if (message.includes('slow')) await new Promise(r => { waiting = r; });
    out({ type: 'subagent_lifecycle', payload: { ...P, status: 'completed' } });
  }
  if (message.includes('ask two')) {
    // OMP announces the ask tool call after its dialog is requested.
    const pending = ask({ id: 'ask1', method: 'ask', questions: [
      { id: 'color', question: 'Favorite color?', header: 'Color', options: [{ label: 'red' }, { label: 'blue', description: 'the sea' }], multi: true },
      { id: 'name', question: 'Your name?', header: 'Name', options: [{ label: 'skip' }] }] });
    out({ type: 'tool_execution_start', toolCallId: 'a1', toolName: 'ask', args: {} });
    const r = await pending;
    const text = r.cancelled ? 'Ask tool was cancelled by the user' : r.answers?.length === 2 ? `User answers: ${JSON.stringify(r.answers)}` : 'Ask dialog response must carry 2 answers in question order';
    out({ type: 'tool_execution_end', toolCallId: 'a1', toolName: 'ask', result: { content: [{ type: 'text', text }], details: {} }, isError: !!r.cancelled || !r.answers });
  }
  if (message.includes('slow')) await new Promise(r => { waiting = r; });
  const reply = `done: ${message}`;
  const mid = `msg-${++msgs}`; const half = reply.slice(0, Math.ceil(reply.length / 2));
  out({ type: 'message_start', message: text(half), messageId: mid });
  out({ type: 'message_update', messageId: mid, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: half, partial: text(half) } });
  if (message.includes('stream')) await new Promise(r => setTimeout(r, 400));
  out({ type: 'message_update', messageId: mid, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: reply.slice(half.length), partial: text(reply) } });
  out({ type: 'message_update', messageId: mid, assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: reply, partial: text(reply) } });
  out({ type: 'message_end', message: text(reply), messageId: mid });
  out({ type: 'turn_end', message: text(reply) });
  out({ type: 'agent_end', messages: [] });
  const next = queued.steering.shift() ?? queued.followUp.shift();
  if (next !== undefined) queueUpdate();
  if (id) out({ type: 'prompt_result', id, agentInvoked: true, status: 'completed', sessionSettled: next === undefined });
  if (next !== undefined) return turn(null, next);
  settled = true;
  out({ type: 'session_settled' });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); handle(JSON.parse(line)); }
});
process.stdin.on('end', () => process.exit(0));

function handle(c) {
  log({ cmd: c });
  if (c.type === 'extension_ui_response') { if (waiting) { const w = waiting; waiting = null; w(c); } return; }
  switch (c.type) {
    case 'set_subagent_subscription': return out({ id: c.id, type: 'response', command: c.type, success: c.level === 'events', ...(c.level === 'events' ? { data: { level: c.level } } : { error: `Invalid subagent subscription level: ${c.level}` }) });
    case 'set_ask_dialog': return out({ id: c.id, type: 'response', command: c.type, success: true, data: { enabled: c.enabled === true } });
    case 'negotiate_protocol': v2 = c.protocolVersion === 2; return out({ id: c.id, type: 'response', command: c.type, success: true, data: { protocolVersion: v2 ? 2 : 1 } });
    case 'set_session_name': sessionName = c.name; return out({ id: c.id, type: 'response', command: c.type, success: true });
    case 'get_state': return out({ id: c.id, type: 'response', command: 'get_state', success: true, data: state() });
    case 'get_available_models': return out({ id: c.id, type: 'response', command: 'get_available_models', success: true, data: { models: [
      { id: 'claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5', reasoning: true, thinking: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] } },
      { id: 'gpt-6.1-sol', provider: 'openai-codex', name: 'GPT-6.1-Sol', reasoning: false },
      { id: '-p', provider: 'evil', name: 'Evil' }
    ] } });
    case 'prompt': return void turn(c.id, c.message);
    case 'follow_up': case 'steer': (c.type === 'steer' ? queued.steering : queued.followUp).push(c.message); queueUpdate(); return out({ id: c.id, type: 'response', command: c.type, success: true });
    case 'abort_and_restore_queue': { const data = { steering: queued.steering.map(text => ({ text })), followUp: queued.followUp.map(text => ({ text })) }; queued = { steering: [], followUp: [] }; queueUpdate(); settled = true; out({ id: c.id, type: 'response', command: c.type, success: true, data }); if (waiting) { const w = waiting; waiting = null; w({ cancelled: true }); } return; }
    case 'abort': settled = true; out({ id: c.id, type: 'response', command: 'abort', success: true }); if (waiting) { const w = waiting; waiting = null; w({ cancelled: true }); } return;
    case 'set_model':
      if (c.modelId === 'nope') return out({ id: c.id, type: 'response', command: 'set_model', success: false, error: `Model not found: ${c.provider}/${c.modelId}` });
      model.id = c.modelId; model.provider = c.provider; model.thinking = { efforts: c.provider === 'openai-codex' ? ['low', 'medium'] : ['low', 'medium', 'high'] };
      return out({ id: c.id, type: 'response', command: 'set_model', success: true, data: model });
    case 'get_available_thinking_levels': return out({ id: c.id, type: 'response', command: c.type, success: true, data: { levels: ['off', ...model.thinking.efforts] } });
    // Like OMP 18.12.3: an unknown level is not refused, it clears the level.
    case 'set_thinking_level': thinking = model.thinking.efforts.includes(c.level) ? c.level : undefined; return out({ id: c.id, type: 'response', command: 'set_thinking_level', success: true });
    default: return out({ id: c.id, type: 'response', command: c.type, success: false, error: `Unknown command: ${c.type}` });
  }
}
