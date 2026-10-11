#!/usr/bin/env node
import { stdin, stdout, stderr, env, argv, exit } from 'node:process';
let q = ''; stdin.setEncoding('utf8'); for await (const c of stdin) q += c;
const say = o => stdout.write(JSON.stringify(o) + '\n');
const resumeAt = argv.indexOf('resume');
const sid = argv.includes('--session-id') ? argv[argv.indexOf('--session-id') + 1]
  : argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1]
  : resumeAt >= 0 && argv[resumeAt + 1] && !argv[resumeAt + 1].startsWith('-') ? argv[resumeAt + 1]
  : 'none';
const mode = env.FAKE_CLAUDE_MODE ?? 'ok';
const agent = env.FAKE_AGENT ?? 'claude';
if (mode === 'fail') { stderr.write('No conversation found with session ID: ' + sid + '\n'); exit(1); }
if (agent === 'codex') {
  say({ type: 'thread.started', thread_id: sid === 'none' ? 'codex-thread' : sid });
  say({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'cat ' + process.cwd() + '/sessions.md' } });
  if (mode === 'slow') await new Promise(r => setTimeout(r, 5000));
  say({ type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Deux compagnons travaillent. Question : ' + q.trim() } });
} else if (agent === 'cursor') {
  say({ type: 'system', subtype: 'init', session_id: sid === 'none' ? 'cursor-thread' : sid, cwd: process.cwd() });
  say({ type: 'tool_call', subtype: 'started', tool_call: { readToolCall: { args: { path: process.cwd() + '/sessions.md' } } } });
  if (mode === 'slow') await new Promise(r => setTimeout(r, 5000));
  for (const t of ['Deux ', 'compagnons ', 'travaillent.']) say({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Deux compagnons travaillent. Question : ' + q.trim(), session_id: sid });
} else {
  say({ type: 'system', subtype: 'init', session_id: sid, cwd: process.cwd() });
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: process.cwd() + '/sessions.md' } }] } });
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: process.cwd() + '/pane-a.txt' } }] } });
  if (mode === 'slow') await new Promise(r => setTimeout(r, 5000));
  for (const t of ['Deux ', 'compagnons ', 'travaillent.']) say({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Deux compagnons travaillent. Question : ' + q.trim(), session_id: sid });
}
