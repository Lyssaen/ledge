import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentThought } from '../src/daemon/transcript';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const journal = (rows: unknown[]) => { const dir = mkdtempSync(join(tmpdir(), 'ledge-thought-')); dirs.push(dir); const path = join(dir, 'session.jsonl'); writeFileSync(path, rows.map(x => JSON.stringify(x)).join('\n') + '\n'); return path; };
describe('ephemeral office thoughts', () => {
  it('takes the latest Claude thinking block and skips helper sidechains', () => {
    const path = journal([
      { type: 'assistant', message: { content: [{ type: 'thinking', text: 'Analyser les tests' }] } },
      { type: 'assistant', isSidechain: true, message: { content: [{ type: 'thinking', text: 'Secret helper' }] } },
      { type: 'assistant', message: { content: [{ type: 'thinking', text: ' Corriger   le  rendu ' }] } }
    ]);
    expect(agentThought(path)).toBe('Corriger le rendu');
  });
  it('takes a Codex reasoning summary and caps it at 80 characters', () => {
    const path = journal([{ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentReasoning', summary: 'A'.repeat(100) } } }]);
    expect(agentThought(path)).toBe('A'.repeat(80));
  });
  it('returns nothing for redacted reasoning', () => {
    expect(agentThought(journal([{ type: 'assistant', message: { content: [{ type: 'thinking', text: '' }] } }]))).toBeUndefined();
  });
});
