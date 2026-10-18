import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Pending } from '@ledge/protocol';
import { codexAdapter, REPLY_ENTER_DELAY_MS } from '../src/adapters/codex.js';
import { adapterFor } from '../src/adapters/index.js';
import { buildPreview } from '../src/adapters/preview.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
/** What the server's verify step sees: the last `n` lines, trailing whitespace trimmed like Tmux.capture. */
const tail = (pane: string, n = 5) => pane.replace(/\s+$/g, '').split('\n').slice(-n).join('\n');
const pending = (kind: Pending['kind'], extra: Partial<Pending> = {}): Pending => ({ kind, text: '', source: 'hook', ...extra });

const DIALOGS = ['codex-permission-exec', 'codex-permission-patch', 'codex-question', 'codex-plan', 'codex-hooks-review'];
const AT_REST = ['codex-idle-after-turn', 'codex-idle-draft', 'codex-interrupted-idle'];

describe('codex adapter: detection (Codex CLI 0.162 captures)', () => {
  it('detects a command approval with the command and its options', () => {
    expect(codexAdapter.detectPrompt(fx('codex-permission-exec'))).toEqual({
      kind: 'permission', text: "printf '%s\\n' hi > hello.txt", command: { lines: ["printf '%s\\n' hi > hello.txt"], ends: [32] },
      options: ['Yes, proceed', "Yes, and don't ask again for commands that start with `printf '%s\\n' hi > hello.txt`", 'No, and tell Codex what to do differently']
    });
  });
  it('detects an edit approval as the destination file, its wrapped lines joined', () => {
    expect(codexAdapter.detectPrompt(fx('codex-permission-patch'))).toEqual({
      kind: 'permission', text: 'Edit /home/dev/demo/README.md',
      options: ['Yes, proceed', "Yes, and don't ask again for these files", 'No, and tell Codex what to do differently']
    });
  });
  it('detects a request_user_input question with its option labels and their descriptions', () => {
    expect(codexAdapter.detectPrompt(fx('codex-question'))).toEqual({
      kind: 'question', text: 'Which color should the banner be?',
      options: ['Blue (Recommended)', 'Red', 'Green', 'None of the above'],
      optionDetails: ['Uses a versatile, calm color that works well for most banners.', 'Creates a bold, urgent, high-attention banner.', 'Creates a positive, natural, success-oriented banner.', 'Optionally, add details in notes (tab)']
    });
  });
  it('detects the plan approval at the end of a Plan mode turn', () => {
    expect(codexAdapter.detectPrompt(fx('codex-plan'))).toEqual({
      kind: 'plan', text: 'Implement this plan?',
      options: ['Yes, implement this plan', 'Yes, clear context and implement', 'No, stay in Plan mode']
    });
  });
  it('detects the hooks review shown at startup once new hooks are installed', () => {
    expect(codexAdapter.detectPrompt(fx('codex-hooks-review'))).toEqual({
      kind: 'permission', text: 'Trust the new Codex hooks? 11 hooks are new or changed.',
      options: ['Review hooks', 'Trust all and continue', "Continue without trusting (hooks won't run)"]
    });
  });
  it.each(AT_REST.concat('codex-working'))('detects nothing on %s', name => {
    expect(codexAdapter.detectPrompt(fx(name))).toBeNull();
    expect(codexAdapter.promptStillVisible(tail(fx(name)))).toBe(false);
  });
  it.each(DIALOGS)('sees %s still on screen from the last five lines', name => {
    expect(codexAdapter.promptStillVisible(tail(fx(name)))).toBe(true);
  });
  it('does not detect a dialog quoted in the transcript above the input box', () => {
    const dialog = fx('codex-permission-exec').split('\n').slice(-15).join('\n');
    const idle = fx('codex-idle-after-turn').split('\n');
    const pane = [...idle.slice(0, 30), dialog, ...idle.slice(30)].join('\n');
    expect(codexAdapter.detectPrompt(pane)).toBeNull();
    expect(codexAdapter.atRest!(pane)).toBe(true);
  });
  it('does not take a user prompt that looks like an option for a dialog', () => {
    const pane = fx('codex-idle-after-turn').replace('› Ask Codex to do anything', '› 1. Yes, proceed (y)');
    expect(codexAdapter.detectPrompt(pane)).toBeNull();
  });
  it('is the adapter registered for codex', () => {
    expect(adapterFor('codex')).toBe(codexAdapter);
  });
});

describe('codex adapter: rest and preview', () => {
  it.each(AT_REST)('%s is at rest', name => {
    expect(codexAdapter.atRest!(fx(name))).toBe(true);
  });
  it('a prompt in the transcript is not the input box: the lock shown by a resume of a conversation open elsewhere', () => {
    const transcript = '› Reply with the single word beta. No tools.\n\n• beta\n\n› Count slowly from 1 to 200.\n\n■ Conversation interrupted - use /feedback if something went wrong\n';
    const pane = transcript + fx('codex-resume-locked');
    expect(codexAdapter.atRest!(pane)).toBe(false);
    expect(codexAdapter.detectPrompt(pane)).toBeNull();
    expect(buildPreview(pane, codexAdapter).at(-1)).toBe('   r retry   f fork   esc/^c/q exit   ^t transcript');
  });
  it.each(DIALOGS.concat('codex-working'))('%s is not at rest', name => {
    expect(codexAdapter.atRest!(fx(name))).toBe(false);
  });
  it('drops the input box and status lines from the preview', () => {
    const lines = buildPreview(fx('codex-idle-after-turn'), codexAdapter);
    expect(lines.at(-1)).toBe('  Worked for 20s • 14:57');
    expect(lines.some(l => l.includes('Ask Codex to do anything'))).toBe(false);
    expect(buildPreview(fx('codex-idle-draft'), codexAdapter).some(l => l.includes('draft not sent'))).toBe(false);
  });
  it('keeps the running status line, drops the input box under it', () => {
    expect(buildPreview(fx('codex-working'), codexAdapter).at(-1)).toBe('• Working (2s • esc to interrupt)');
  });
  it('keeps a dialog whole in the preview', () => {
    expect(buildPreview(fx('codex-permission-exec'), codexAdapter).at(-1)).toBe('  Press enter to confirm or esc to cancel');
  });
});

describe('codex adapter: keys', () => {
  it('accepts an approval with y (run once) and denies it with Esc', () => {
    const p = fx('codex-permission-exec');
    expect(codexAdapter.keysFor('accept', pending('permission'), p)).toEqual([{ text: 'y' }]);
    expect(codexAdapter.keysFor('deny', pending('permission'), p)).toEqual([{ keys: ['Escape'] }]);
    expect(codexAdapter.keysFor('accept', pending('diff'), fx('codex-permission-patch'))).toEqual([{ text: 'y' }]);
  });
  it('accepts a plan with the implement option and denies it by staying in Plan mode', () => {
    const p = fx('codex-plan');
    expect(codexAdapter.keysFor('accept', pending('plan', { source: 'pane' }), p)).toEqual([{ text: '1' }]);
    expect(codexAdapter.keysFor('deny', pending('plan', { source: 'pane' }), p)).toEqual([{ text: '3' }]);
  });
  it('a question takes option 1 on accept and Esc on deny', () => {
    const p = fx('codex-question');
    expect(codexAdapter.keysFor('accept', pending('question'), p)).toEqual([{ text: '1' }]);
    expect(codexAdapter.keysFor('deny', pending('question'), p)).toEqual([{ keys: ['Escape'] }]);
  });
  it('trusts the hooks by moving to "Trust all" then Enter (a digit only moves the cursor there)', () => {
    const p = fx('codex-hooks-review');
    expect(codexAdapter.keysFor('accept', pending('permission', { source: 'pane' }), p)).toEqual([{ text: '2' }, { keys: ['Enter'] }]);
    expect(codexAdapter.keysFor('deny', pending('permission', { source: 'pane' }), p)).toEqual([{ keys: ['Escape'] }]);
  });
  it('a reply is typed, then Enter after a pause (Enter inside a paste burst is a newline)', () => {
    expect(codexAdapter.replyPlan('run the\ntests')).toEqual([{ text: 'run the tests' }, { waitMs: REPLY_ENTER_DELAY_MS }, { keys: ['Enter'] }]);
  });
  it('a digit answers a question at once', () => {
    expect(codexAdapter.replyPlan('2', pending('question'))).toEqual([{ text: '2' }]);
  });
  it('interrupts with Esc (Ctrl+C twice would quit Codex)', () => {
    expect(codexAdapter.interruptKeys()).toEqual(['Escape']);
  });
});

describe('codex adapter: always and a note (lot 6a)', () => {
  const perm = pending('permission'); const diff = pending('diff'); const plan = pending('plan', { source: 'pane' });
  type Until = { until: (p: string) => boolean };
  it('always takes the option letter that stops asking', () => {
    expect(codexAdapter.keysFor('always', perm, fx('codex-permission-exec'))).toEqual([{ text: 'p' }]);
    expect(codexAdapter.keysFor('always', diff, fx('codex-permission-patch'))).toEqual([{ text: 'a' }]);
  });
  it('always with no such option on screen is refused', () => {
    expect(() => codexAdapter.keysFor('always', plan, fx('codex-plan'))).toThrow('no "always" option in this dialog, answer in the terminal');
    expect(() => codexAdapter.keysFor('always', perm, fx('codex-hooks-review'))).toThrow('no "always" option in this dialog, answer in the terminal');
  });
  it('deny with a note on a plan: stay in Plan mode, then the note', () => {
    expect(codexAdapter.keysFor('deny', plan, fx('codex-plan'), 'Garde la v1')).toEqual([{ text: '3' }, { until: expect.any(Function), denied: true }, { text: 'Garde la v1' }, { waitMs: REPLY_ENTER_DELAY_MS }, { keys: ['Enter'] }]);
  });
  it('deny with a note on an approval: Escape, the note once the input is back, Enter after the pause', () => {
    const keys = codexAdapter.keysFor('deny', perm, fx('codex-permission-exec'), 'Use\npnpm');
    expect(keys).toEqual([{ keys: ['Escape'] }, { until: expect.any(Function), denied: true }, { text: 'Use pnpm' }, { waitMs: REPLY_ENTER_DELAY_MS }, { keys: ['Enter'] }]);
    const rest = (keys[1] as Until).until;
    expect(rest(tail(fx('codex-idle-after-turn'), 30))).toBe(true);
    expect(rest(tail(fx('codex-permission-exec'), 30))).toBe(false);
    expect(() => codexAdapter.keysFor('deny', perm, fx('codex-hooks-review'), 'non')).toThrow(/answer in the terminal/);
  });
});

describe('codex adapter: the dialog on screen must be the request (lot 6a review)', () => {
  it('a plan question up while an approval is pending, or the other way round: nothing is typed', () => {
    for (const d of ['accept', 'always', 'deny'] as const) {
      expect(() => codexAdapter.keysFor(d, pending('permission'), fx('codex-plan'))).toThrow('the request changed, look again');
      expect(() => codexAdapter.keysFor(d, pending('diff'), fx('codex-plan'))).toThrow('the request changed, look again');
      expect(() => codexAdapter.keysFor(d, pending('plan', { source: 'pane' }), fx('codex-permission-exec'))).toThrow('the request changed, look again');
    }
    expect(() => codexAdapter.keysFor('accept', pending('question'), fx('codex-permission-exec'))).toThrow('the request changed, look again');
    expect(() => codexAdapter.keysFor('accept', pending('permission'), fx('codex-question'))).toThrow('the request changed, look again');
    expect(() => codexAdapter.keysFor('accept', pending('plan', { source: 'pane' }), fx('codex-hooks-review'))).toThrow('the request changed, look again');
  });
  it('the matching dialog still takes its keys; no readable dialog keeps the fallbacks', () => {
    expect(codexAdapter.keysFor('accept', pending('diff'), fx('codex-permission-patch'))).toEqual([{ text: 'y' }]);
    expect(codexAdapter.keysFor('accept', pending('permission'))).toEqual([{ text: 'y' }]);
  });
});
