#!/usr/bin/env node
// A scripted stand-in for `omp --mode rpc-ui` (frames recorded from OMP 18.12.3). FAKE_OMP_LOG: a file receiving each argv and command.
import { appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i === -1 ? undefined : argv[i + 1]; };
const log = o => { if (process.env.FAKE_OMP_LOG) appendFileSync(process.env.FAKE_OMP_LOG, `${JSON.stringify(o)}\n`); };
log({ argv });
const out = f => process.stdout.write(`${JSON.stringify(f)}\n`);

if (process.env.FAKE_OMP_DIE) { process.stderr.write('omp: no credentials\n'); process.exit(Number(process.env.FAKE_OMP_DIE)); }

const dir = arg('--session-dir');
const resume = arg('--resume');
let sessionFile = resume;
if (!sessionFile && dir) { mkdirSync(dir, { recursive: true }); sessionFile = join(dir, '2026-10-20T00-00-00-000Z_fake-session.jsonl'); if (!existsSync(sessionFile)) writeFileSync(sessionFile, ''); }
const model = { id: arg('--model')?.split('/').pop() ?? 'claude-opus-5-5', provider: arg('--model')?.split('/')[0] ?? 'anthropic', name: 'Fake', reasoning: true, thinking: { mode: 'anthropic-adaptive', efforts: ['low', 'medium', 'high'] } };
let thinking = arg('--thinking') ?? 'high';
let settled = true; let queued = { steering: [], followUp: [] };
const state = () => ({ model, thinkingLevel: thinking, isStreaming: !settled, isCompacting: false, sessionFile, sessionId: 'fake-session', isSettled: settled, queuedMessageCount: queued.steering.length + queued.followUp.length, queuedMessages: { ...queued, liveSteered: 0 }, hasPendingAsyncWork: false, todoPhases: [], messageCount: 0 });

out({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576, maxReassembledFrameBytes: 67108864 });
out({ type: 'extension_ui_request', id: 'w1', method: 'setWidget', widgetKey: 'autoresearch' });

let waiting = null; // the open dialog: resolves with the response frame
const ask = frame => new Promise(res => { waiting = res; out({ type: 'extension_ui_request', ...frame }); });
const text = t => ({ role: 'assistant', content: [{ type: 'text', text: t }], provider: model.provider, model: model.id });

async function turn(id, message) {
  settled = false;
  if (id) out({ id, type: 'response', command: 'prompt', success: true });
  out({ type: 'agent_start' }); out({ type: 'turn_start' });
  out({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text: message }], attribution: 'user' }, messageId: 'msg-1' });
  out({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: message }], attribution: 'user' }, messageId: 'msg-1' });
  if (message.includes('tool')) {
    out({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'echo hi' }, intent: 'Running echo' });
    const r = await ask({ id: 'q1', method: 'select', title: 'Allow tool: bash\nCommand: echo hi', options: ['Approve', 'Approve bash for this session', 'Deny'] });
    if (r.cancelled || r.value === 'Deny') out({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'denied' }] }, isError: true });
    else out({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'bash', result: { content: [{ type: 'text', text: 'hi\n' }] }, isError: false });
  }
  if (message.includes('slow')) await new Promise(r => { waiting = r; });
  const reply = `done: ${message}`;
  out({ type: 'message_start', message: text(reply), messageId: 'msg-2' });
  out({ type: 'message_end', message: text(reply), messageId: 'msg-2' });
  out({ type: 'turn_end', message: text(reply) });
  out({ type: 'agent_end', messages: [] });
  const next = queued.steering.shift() ?? queued.followUp.shift();
  if (id) out({ type: 'prompt_result', id, agentInvoked: true, status: 'completed', sessionSettled: next === undefined });
  if (next !== undefined) return turn(null, next);
  settled = true;
  out({ type: 'session_settled' });
}

let buf = '';
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); handle(JSON.parse(line)); }
});
process.stdin.on('end', () => process.exit(0));

function handle(c) {
  log({ cmd: c });
  if (c.type === 'extension_ui_response') { if (waiting) { const w = waiting; waiting = null; w(c); } return; }
  switch (c.type) {
    case 'get_state': return out({ id: c.id, type: 'response', command: 'get_state', success: true, data: state() });
    case 'get_available_models': return out({ id: c.id, type: 'response', command: 'get_available_models', success: true, data: { models: [
      { id: 'claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5', reasoning: true, thinking: { efforts: ['low', 'medium', 'high', 'xhigh', 'max'] } },
      { id: 'gpt-6.1-sol', provider: 'openai-codex', name: 'GPT-6.1-Sol', reasoning: false },
      { id: '-p', provider: 'evil', name: 'Evil' }
    ] } });
    case 'prompt': return void turn(c.id, c.message);
    case 'follow_up': case 'steer': (c.type === 'steer' ? queued.steering : queued.followUp).push(c.message); return out({ id: c.id, type: 'response', command: c.type, success: true });
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
