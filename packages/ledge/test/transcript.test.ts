import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentMessages, tailLines, TAIL_BYTES } from '../src/daemon/transcript.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-')); });
const claude = (uuid: string, ts: string, content: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ uuid, timestamp: ts, type: 'assistant', message: { role: 'assistant', content }, ...extra });
const codex = (id: string, ts: string, type: string, text: string, kind = 'event_msg') => JSON.stringify({ timestamp: ts, type: kind, payload: { type: 'item_completed', thread_id: 't', turn_id: 'u', item: { type, id, content: [{ type: 'Text', text }] } } });

describe('transcript tail', () => {
  it('returns whole lines only, dropping a cut first line and an unfinished last one', () => {
    const p = join(dir, 't.jsonl');
    writeFileSync(p, 'first line that is cut\n{"a":1}\n{"b":2}\n{"c":');
    expect(tailLines(p, 24)).toEqual(['{"a":1}', '{"b":2}']);
    expect(tailLines(join(dir, 'missing.jsonl'))).toEqual([]);
    expect(TAIL_BYTES).toBe(512 * 1024);
  });
});

describe('agentMessages', () => {
  it('reads a Claude transcript: text blocks of assistant entries, not thinking, tool use or sidechains', () => {
    const p = join(dir, 'c.jsonl');
    writeFileSync(p, [
      JSON.stringify({ uuid: 'u0', timestamp: '2026-10-13T10:00:00.000Z', type: 'user', message: { role: 'user', content: 'Fais le plan' } }),
      claude('u1', '2026-10-13T10:00:01.000Z', [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Je regarde le reducer. ' }]),
      claude('u2', '2026-10-13T10:00:02.000Z', [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }]),
      claude('u3', '2026-10-13T10:00:03.000Z', [{ type: 'text', text: 'Side' }], { isSidechain: true }),
      claude('u4', '2026-10-13T10:00:04.000Z', [{ type: 'text', text: 'Trois consommateurs.' }])
    ].join('\n') + '\n');
    expect(agentMessages(p)).toEqual([
      { id: 'u1', at: '2026-10-13T10:00:01.000Z', text: 'Je regarde le reducer.' },
      { id: 'u4', at: '2026-10-13T10:00:04.000Z', text: 'Trois consommateurs.' }
    ]);
  });
  it('reads a Codex rollout: completed AgentMessage items once, response_item copies ignored', () => {
    const p = join(dir, 'r.jsonl');
    writeFileSync(p, [
      JSON.stringify({ timestamp: '2026-10-13T10:00:00.000Z', type: 'session_meta', payload: { id: 'x', cwd: '/w' } }),
      codex('i1', '2026-10-13T10:00:01.000Z', 'AgentMessage', 'Je lance les tests.'),
      codex('i1', '2026-10-13T10:00:01.000Z', 'AgentMessage', 'Je lance les tests.', 'response_item'),
      codex('i2', '2026-10-13T10:00:02.000Z', 'CommandExecution', 'pnpm test'),
      codex('i3', '2026-10-13T10:00:03.000Z', 'Reasoning', '…'),
      '{"truncated":'
    ].join('\n'));
    expect(agentMessages(p)).toEqual([{ id: 'i1', at: '2026-10-13T10:00:01.000Z', text: 'Je lance les tests.' }]);
  });
  it('reads a Claude helper transcript, where every entry is a sidechain, only when told it is one', () => {
    const p = join(dir, 'agent-h1.jsonl');
    const side = { isSidechain: true, agentId: 'h1' };
    writeFileSync(p, [
      JSON.stringify({ uuid: 'a0', timestamp: '2026-10-13T10:00:00.000Z', type: 'user', message: { role: 'user', content: 'find reducer consumers' }, ...side }),
      claude('a1', '2026-10-13T10:00:01.000Z', [{ type: 'text', text: 'Searching the callers of reduce().' }, { type: 'tool_use', id: 'toolu_7', name: 'Grep', input: {} }], side),
      JSON.stringify({ uuid: 'a2', timestamp: '2026-10-13T10:00:02.000Z', type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_7', content: 'a.ts' }] }, ...side }),
      claude('a3', '2026-10-13T10:00:03.000Z', [{ type: 'thinking', thinking: 'ok' }, { type: 'text', text: 'Three consumers.' }], side)
    ].join('\n') + '\n');
    expect(agentMessages(p)).toEqual([]); // read as a main transcript, a helper's lines are all filtered out
    expect(agentMessages(p, { sidechain: true })).toEqual([
      { id: 'a1', at: '2026-10-13T10:00:01.000Z', text: 'Searching the callers of reduce().' },
      { id: 'a3', at: '2026-10-13T10:00:03.000Z', text: 'Three consumers.' }
    ]);
  });
});
