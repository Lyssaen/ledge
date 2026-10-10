import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { claudeAdapter } from '../src/adapters/claude.js';
import { adapterFor } from '../src/adapters/index.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
/** What the server's verify step sees: the last `n` lines, trailing whitespace trimmed like Tmux.capture. */
const tail = (pane: string, n = 5) => pane.replace(/\s+$/g, '').split('\n').slice(-n).join('\n');

describe('claude adapter: detection (Claude Code 2.x captures)', () => {
  it('detects a Bash permission with the command between the dashed rules', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-permission-bash'))).toEqual({
      kind: 'permission', text: 'mkdir zz-ledge-probe',
      options: ['Yes', 'Yes, and always allow access to', 'Yes, and switch to auto mode · auto mode handles these prompts for you', 'No']
    });
  });
  it('detects a file-creation permission as title + file name', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-permission-write'))).toEqual({
      kind: 'permission', text: 'Create file a.txt',
      options: ['Yes', 'Yes, and switch to accept edits (auto-approve file edits and common file', 'No']
    });
  });
  it('detects a question with its options, without description lines', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-question'))).toEqual({
      kind: 'question', text: 'Which color do you prefer?',
      options: ['Red', 'Blue', 'Type something.', 'Chat about this']
    });
  });
  it('reads only the last dialog when an older one is still in scrollback', () => {
    const pane = fx('claude2-question') + '\n● You chose Blue.\n\n' + fx('claude2-permission-write');
    expect(claudeAdapter.detectPrompt(pane)?.text).toBe('Create file a.txt');
  });
  it('does not detect the idle input box (empty ❯ line between rules)', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-idle'))).toBeNull();
    expect(claudeAdapter.promptStillVisible(fx('claude2-idle'))).toBe(false);
    expect(claudeAdapter.promptStillVisible(tail(fx('claude2-idle')))).toBe(false);
  });
  it('does not detect a user prompt that looks like an option', () => {
    const pane = fx('claude2-idle').replace('❯ \n', '❯ 1. Yes\n');
    expect(claudeAdapter.detectPrompt(pane)).toBeNull();
    expect(claudeAdapter.promptStillVisible(tail(pane))).toBe(false);
  });
  it('is not fooled by chat output quoting a dialog without its footer', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-trap-chat'))).toBeNull();
    expect(claudeAdapter.promptStillVisible(fx('claude2-trap-chat'))).toBe(false);
  });
  it('is not fooled by a quoted dialog with its footer when the idle box is below it', () => {
    const pane = fx('claude2-permission-bash') + '\n' + fx('claude2-idle');
    expect(claudeAdapter.detectPrompt(pane)).toBeNull();
    expect(claudeAdapter.promptStillVisible(tail(pane))).toBe(false);
  });
  it('detects a dialog taller than the 30-line preview (top rule 40+ lines up)', () => {
    const body = Array.from({ length: 30 }, (_, i) => `  ${i + 1} line ${i + 1}`).join('\n');
    const pane = fx('claude2-permission-write').replace('  1 hi', body);
    const lines = pane.replace(/\s+$/, '').split('\n');
    expect(lines.length - lines.findIndex(l => l.startsWith('────'))).toBeGreaterThan(30);
    expect(claudeAdapter.detectPrompt(lines.slice(-60).join('\n'))?.text).toBe('Create file a.txt');
  });
  it('returns null while working', () => {
    expect(claudeAdapter.detectPrompt(fx('claude-working'))).toBeNull();
  });
  it('a footer without numbered options is not a dialog', () => {
    expect(claudeAdapter.detectPrompt('────\n Something\n\n Esc to cancel · Tab to amend')).toBeNull();
    expect(claudeAdapter.promptStillVisible('Something\n\n Esc to cancel · Tab to amend')).toBe(false);
  });
});

describe('claude adapter: promptStillVisible on the 5-line verify capture', () => {
  it.each(['claude2-permission-bash', 'claude2-permission-write', 'claude2-question'])('is true on the bottom of %s', name => {
    expect(claudeAdapter.promptStillVisible(tail(fx(name)))).toBe(true);
  });
  it('is false once the dialog is replaced by the idle screen', () => {
    expect(claudeAdapter.promptStillVisible(tail(fx('claude2-idle')))).toBe(false);
  });
});

describe('claude adapter: keys', () => {
  const perm = { kind: 'permission' as const, text: 'npm test', source: 'hook' as const };
  const q = { kind: 'question' as const, text: 'Which?', options: ['A', 'B'], source: 'pane' as const };
  it('accept presses 1 alone (a digit selects immediately in 2.x)', () => {
    expect(claudeAdapter.keysFor('accept', perm)).toEqual([{ text: '1' }]);
    expect(claudeAdapter.keysFor('accept', q)).toEqual([{ text: '1' }]);
  });
  it('deny presses Escape', () => {
    expect(claudeAdapter.keysFor('deny', perm)).toEqual([{ keys: ['Escape'] }]);
  });
  it('a question answered by a valid option number sends that digit alone', () => {
    expect(claudeAdapter.replyPlan('2', q)).toEqual([{ text: '2' }]);
    expect(claudeAdapter.replyPlan(' 1 ', q)).toEqual([{ text: '1' }]);
  });
  it('any digit 1-9 is a selection, even past the known options (hooks omit "Type something." / "Chat about this")', () => {
    expect(claudeAdapter.replyPlan('3', q)).toEqual([{ text: '3' }]);
    expect(claudeAdapter.replyPlan('9', q)).toEqual([{ text: '9' }]);
    expect(claudeAdapter.replyPlan('4', { kind: 'question', text: 'Which?', source: 'hook' })).toEqual([{ text: '4' }]);
    expect(claudeAdapter.replyPlan('0', { kind: 'question', text: 'Which?', source: 'hook' })).toEqual([{ text: '0' }, { keys: ['Enter'] }]);
  });
  it('with nothing pending a number is ordinary input: typed then Enter', () => {
    expect(claudeAdapter.replyPlan('2')).toEqual([{ text: '2' }, { keys: ['Enter'] }]);
  });
  it('a free text reply is typed literally then Enter, multi-line joined by spaces', () => {
    expect(claudeAdapter.replyPlan('fix all three\nthen run tests', q)).toEqual([{ text: 'fix all three then run tests' }, { keys: ['Enter'] }]);
  });
  it('never emits a text step containing a newline or carriage return', () => {
    for (const input of ['a\nb', 'a\r\nb', 'a\rb', '\n\na\n\n\nb\n', '\n2\n']) {
      const texts = claudeAdapter.replyPlan(input, q).filter((s): s is { text: string } => 'text' in s);
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
