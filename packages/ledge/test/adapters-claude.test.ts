import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { claudeAdapter } from '../src/adapters/claude.js';
import { adapterFor } from '../src/adapters/index.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');

describe('claude adapter: detection', () => {
  it('detects a permission prompt with the command', () => {
    const m = claudeAdapter.detectPrompt(fx('claude-permission'));
    expect(m).toEqual({ kind: 'permission', text: 'Bash(npm test)', options: ['Yes', "Yes, and don't ask again for npm test", 'No, and tell Claude what to do differently (esc)'] });
  });
  it('detects a question with its options', () => {
    const m = claudeAdapter.detectPrompt(fx('claude-question'));
    expect(m?.kind).toBe('question');
    expect(m?.text).toBe('Which migration strategy for the invoices table?');
    expect(m?.options).toEqual(['Backfill in place (Recommended)', 'Shadow table and swap', 'Dual write for a week', 'Other']);
  });
  it('returns null while working', () => {
    expect(claudeAdapter.detectPrompt(fx('claude-working'))).toBeNull();
  });
  it('is not fooled by prompt text quoted inside file contents', () => {
    expect(claudeAdapter.detectPrompt(fx('claude-trap-file-contents'))).toBeNull();
    expect(claudeAdapter.promptStillVisible(fx('claude-trap-file-contents'))).toBe(false);
  });
  it('promptStillVisible is true on a live prompt', () => {
    expect(claudeAdapter.promptStillVisible(fx('claude-permission'))).toBe(true);
  });
});

describe('claude adapter: keys', () => {
  const perm = { kind: 'permission' as const, text: 'npm test', source: 'hook' as const };
  it('accept presses 1 then Enter', () => {
    expect(claudeAdapter.keysFor('accept', perm)).toEqual([{ text: '1' }, { keys: ['Enter'] }]);
  });
  it('deny presses Escape', () => {
    expect(claudeAdapter.keysFor('deny', perm)).toEqual([{ keys: ['Escape'] }]);
  });
  it('a question answered by option number types the number then Enter', () => {
    const q = { kind: 'question' as const, text: 'Which?', options: ['A', 'B'], source: 'hook' as const };
    expect(claudeAdapter.replyPlan('2')).toEqual([{ text: '2' }, { keys: ['Enter'] }]);
    expect(claudeAdapter.keysFor('accept', q)).toEqual([{ text: '1' }, { keys: ['Enter'] }]);
  });
  it('a free text reply is typed literally then Enter, multi-line joined by spaces', () => {
    expect(claudeAdapter.replyPlan('fix all three\nthen run tests')).toEqual([{ text: 'fix all three then run tests' }, { keys: ['Enter'] }]);
  });
  it('never emits a text step containing a newline or carriage return', () => {
    for (const input of ['a\nb', 'a\r\nb', 'a\rb', '\n\na\n\n\nb\n']) {
      const texts = claudeAdapter.replyPlan(input).filter((s): s is { text: string } => 'text' in s);
      for (const s of texts) expect(s.text).not.toMatch(/[\r\n]/);
    }
    expect(claudeAdapter.replyPlan('a\nb')).toEqual([{ text: 'a b' }, { keys: ['Enter'] }]);
  });
  it('interrupt is Escape', () => {
    expect(claudeAdapter.interruptKeys()).toEqual(['Escape']);
  });
  it('adapterFor returns the claude adapter and throws for others', () => {
    expect(adapterFor('claude')).toBe(claudeAdapter);
    expect(() => adapterFor('codex')).toThrow(/not implemented/);
  });
});
