import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentMessages, claudeOpenCall, claudePlan, claudeToolAnswered, claudeTranscriptPath, codexPlan, labelTranscript, resumeLabel, tailLines, TAIL_BYTES } from '../src/daemon/transcript.js';

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

describe('codexPlan', () => {
  const plan = (turn: string, text: string) => JSON.stringify({ timestamp: '2026-10-14T08:03:51.956Z', type: 'event_msg', payload: { type: 'item_completed', thread_id: 'th', turn_id: turn, item: { type: 'Plan', id: `${turn}-plan`, text } } });
  it('gives the plan the turn proposed (Codex sends its Stop without a last message), never an older turn\'s', () => {
    const p = join(dir, 'plan.jsonl');
    writeFileSync(p, [
      plan('t1', '# Old plan\n'),
      JSON.stringify({ timestamp: '2026-10-14T08:03:51.960Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '<proposed_plan>\n# New plan\n</proposed_plan>' }] } }),
      plan('t2', '# New plan\n\n## Changes\n\n- Add README.md\n')
    ].join('\n') + '\n');
    expect(codexPlan(p, 't2')).toBe('# New plan\n\n## Changes\n\n- Add README.md');
    expect(codexPlan(p, 't3')).toBeUndefined();
    expect(codexPlan(join(dir, 'missing.jsonl'), 't2')).toBeUndefined();
  });
});

describe('Claude Code transcript without hooks', () => {
  it('lives under the projects folder, named after the cwd with every non alphanumeric character a dash', () => {
    expect(claudeTranscriptPath('/home/jde/.ledge/my_app', 'u-1', { HOME: '/home/jde' })).toBe('/home/jde/.claude/projects/-home-jde--ledge-my-app/u-1.jsonl');
    expect(claudeTranscriptPath('/w/p', 'u-1', { HOME: '/home/jde', CLAUDE_CONFIG_DIR: '/cfg/claude' })).toBe('/cfg/claude/projects/-w-p/u-1.jsonl');
    // Claude Code shortens a folder name over 200 characters with a hash of its own: no guess.
    expect(claudeTranscriptPath(`/${'a'.repeat(210)}`, 'u-1', { HOME: '/home/jde' })).toBeUndefined();
  });
  const entry = (type: string, content: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ type, uuid: `${type}-${Math.random()}`, timestamp: '2026-10-14T09:00:00.000Z', message: { role: type, content }, ...extra });
  const exit = (id: string, plan: string) => entry('assistant', [{ type: 'tool_use', id, name: 'ExitPlanMode', input: { plan, planFilePath: '/p.md' } }]);
  it('the plan waiting for approval is the last ExitPlanMode call that has no result yet', () => {
    const p = join(dir, 'claude-plan.jsonl');
    writeFileSync(p, [
      exit('toolu_1', '# Old plan'),
      entry('user', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'User rejected' }]),
      exit('toolu_2', '# New plan\n\n1. Add README.md'),
      JSON.stringify({ ...JSON.parse(exit('toolu_3', '# A helper plan')), isSidechain: true })
    ].join('\n') + '\n');
    expect(claudePlan(p)).toBe('# New plan\n\n1. Add README.md');
    writeFileSync(p, [exit('toolu_1', '# Old plan'), entry('user', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }])].join('\n') + '\n');
    expect(claudePlan(p)).toBeUndefined();
    expect(claudePlan(join(dir, 'none.jsonl'))).toBeUndefined();
  });
});

describe('Claude Code transcript: the call a request waits on (#35)', () => {
  const entry = (type: string, content: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ type, uuid: `${type}-${Math.random()}`, timestamp: '2026-10-19T09:20:41.699Z', message: { role: type, content }, ...extra });
  const ask = (id: string) => entry('assistant', [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [] } }]);
  const result = (id: string) => entry('user', [{ type: 'tool_result', tool_use_id: id, content: 'Your questions have been answered' }]);
  it('the open call is the last main-thread call of the tool without a result', () => {
    const p = join(dir, 'calls.jsonl');
    writeFileSync(p, [ask('toolu_1'), result('toolu_1'), ask('toolu_2'), JSON.stringify({ ...JSON.parse(ask('toolu_3')), isSidechain: true })].join('\n') + '\n');
    expect(claudeOpenCall(p, 'AskUserQuestion')).toBe('toolu_2');
    expect(claudeOpenCall(p, 'Bash')).toBeUndefined();
    expect(claudeToolAnswered(p, 'toolu_2')).toBe(false);
    expect(claudeToolAnswered(p, 'toolu_1')).toBe(true);
  });
  it('no open call once the last one has its result, nor without a file', () => {
    const p = join(dir, 'answered.jsonl');
    writeFileSync(p, [ask('toolu_1'), result('toolu_1')].join('\n') + '\n');
    expect(claudeOpenCall(p, 'AskUserQuestion')).toBeUndefined();
    expect(claudeOpenCall(join(dir, 'none.jsonl'), 'AskUserQuestion')).toBeUndefined();
    expect(claudeToolAnswered(join(dir, 'none.jsonl'), 'toolu_1')).toBe(false);
  });
});

describe('resumeLabel', () => {
  it('joins name and topic on one line, cut to 80 characters', () => {
    expect(resumeLabel('Pim', 'Refonte\n des noms')).toBe('Pim - Refonte des noms');
    const long = resumeLabel('Pim', 'x'.repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('labelTranscript', () => {
  const uuid = '6f1c0e52-3b0a-4a57-9a43-1d2f5a9c7e10';
  const title = (customTitle: string) => JSON.stringify({ type: 'custom-title', customTitle, sessionId: uuid });
  const file = (...lines: string[]) => { const p = join(dir, `${uuid}.jsonl`); writeFileSync(p, lines.map(l => `${l}\n`).join('')); return p; };
  const lastLine = (p: string) => JSON.parse(readFileSync(p, 'utf8').trimEnd().split('\n').at(-1)!);

  it('appends the label once', () => {
    const p = file(claude('u1', '2026-10-13T10:00:01.000Z', [{ type: 'text', text: 'Salut' }]));
    expect(labelTranscript(p, 'Pim', 'Pim - Sujet')).toBe(true);
    expect(lastLine(p)).toEqual({ type: 'custom-title', customTitle: 'Pim - Sujet', sessionId: uuid });
    const written = readFileSync(p, 'utf8');
    expect(labelTranscript(p, 'Pim', 'Pim - Sujet')).toBe(false);
    expect(readFileSync(p, 'utf8')).toBe(written);
  });

  it('replaces a title Ledge or a pre-change launch wrote, never the user\'s own', () => {
    for (const old of ['Pim', 'Pim - Ancien']) {
      const p = file(title(old));
      expect(labelTranscript(p, 'Pim', 'Pim - Sujet')).toBe(true);
      expect(lastLine(p).customTitle).toBe('Pim - Sujet');
    }
    const mine = file(title('mon titre'));
    const before = readFileSync(mine, 'utf8');
    expect(labelTranscript(mine, 'Pim', 'Pim - Sujet')).toBe(false);
    expect(readFileSync(mine, 'utf8')).toBe(before);
  });

  it('starts on its own line when the file does not end with a newline, and skips a missing file', () => {
    const p = join(dir, `${uuid}.jsonl`);
    writeFileSync(p, '{"type":"user"}');
    expect(labelTranscript(p, 'Pim', 'Pim - Sujet')).toBe(true);
    expect(readFileSync(p, 'utf8').split('\n')).toEqual(['{"type":"user"}', title('Pim - Sujet'), '']);
    expect(labelTranscript(join(dir, 'missing.jsonl'), 'Pim', 'Pim - Sujet')).toBe(false);
  });
});
