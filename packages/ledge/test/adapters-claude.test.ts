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
  it('detects a question with its options, the lines under each as its description', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-question'))).toEqual({
      kind: 'question', text: 'Which color do you prefer?',
      options: ['Red', 'Blue', 'Type something.', 'Chat about this'],
      optionDetails: ['Choose red as your preferred color.', 'Choose blue as your preferred color.', '', '']
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
    expect(claudeAdapter.replyPlan('0', { kind: 'question', text: 'Which?', source: 'hook' }, fx('claude2-question'))[0]).toEqual({ text: '3' });
  });
  it('with nothing pending a number is ordinary input: typed then Enter', () => {
    expect(claudeAdapter.replyPlan('2')).toEqual([{ text: '2' }, { keys: ['Enter'] }]);
  });
  it('answers a question in free text through its "Type something." row: its digit, then the text once it has the cursor, then Enter', () => {
    const plan = claudeAdapter.replyPlan('fix all three\nthen run tests', q, fx('claude2-question'));
    expect(plan.filter(s => !('until' in s))).toEqual([{ text: '3' }, { text: 'fix all three then run tests' }, { keys: ['Enter'] }]);
    const wait = plan[1] as { until: (p: string) => boolean };
    expect(wait.until(tail(fx('claude2-question-other-focused'), 30))).toBe(true);
    expect(wait.until(tail(fx('claude2-question'), 30))).toBe(false);
  });
  it('finds the "Type something." row on screen when the hook options leave it out', () => {
    const hook = { kind: 'question' as const, text: 'Which color do you prefer?', options: ['Red', 'Blue'], source: 'hook' as const };
    expect(claudeAdapter.replyPlan('Green', hook, fx('claude2-question'))[0]).toEqual({ text: '3' });
  });
  it('refuses free text when the dialog on screen has no "Type something." row', () => {
    expect(() => claudeAdapter.replyPlan('Green', q, fx('claude2-question-multi-review'))).toThrow(/answer in the terminal/);
    expect(() => claudeAdapter.replyPlan('Green', q)).toThrow(/answer in the terminal/);
  });
  it('a reply with nothing pending is typed literally then Enter, multi-line joined by spaces', () => {
    expect(claudeAdapter.replyPlan('fix all three\nthen run tests')).toEqual([{ text: 'fix all three then run tests' }, { keys: ['Enter'] }]);
  });
  it('never emits a text step containing a newline or carriage return', () => {
    for (const input of ['a\nb', 'a\r\nb', 'a\rb', '\n\na\n\n\nb\n', '\n2\n']) {
      const texts = claudeAdapter.replyPlan(input, q, fx('claude2-question')).filter((s): s is { text: string } => 'text' in s);
      for (const s of texts) expect(s.text).not.toMatch(/[\r\n]/);
    }
    expect(claudeAdapter.replyPlan('a\nb')).toEqual([{ text: 'a b' }, { keys: ['Enter'] }]);
  });
  it('interrupt is Escape', () => {
    expect(claudeAdapter.interruptKeys()).toEqual(['Escape']);
  });
  it('adapterFor returns the claude adapter', () => {
    expect(adapterFor('claude')).toBe(claudeAdapter);
  });
});

describe('claude adapter: start-up and plan dialogs (Claude Code 2.1 captures)', () => {
  it('detects the workspace trust dialog, whose options are not numbered', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-trust'))).toEqual({
      kind: 'permission', text: 'Trust this folder? /home/dev/demo', options: ['No, exit', 'Yes, I trust this folder']
    });
    expect(claudeAdapter.promptStillVisible(tail(fx('claude2-trust')))).toBe(true);
  });
  it('accepts the trust dialog by moving to the trust option, denies it with Esc', () => {
    const p = { kind: 'permission' as const, text: 'Trust this folder? /home/dev/demo', source: 'pane' as const };
    expect(claudeAdapter.keysFor('accept', p, fx('claude2-trust'))).toEqual([{ keys: ['Down', 'Enter'] }]);
    expect(claudeAdapter.keysFor('deny', p, fx('claude2-trust'))).toEqual([{ keys: ['Escape'] }]);
  });
  it('detects the plan approval dialog as a plan, footer included', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-plan'))).toEqual({
      kind: 'plan', text: 'Claude has written up a plan and is ready to execute. Would you like to proceed?',
      options: ['Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change']
    });
    expect(claudeAdapter.promptStillVisible(tail(fx('claude2-plan')))).toBe(true);
  });
  it('accepts a plan without changing the permission mode: the "manually approve" option', () => {
    const p = { kind: 'plan' as const, text: '# Plan', source: 'hook' as const };
    expect(claudeAdapter.keysFor('accept', p, fx('claude2-plan'))).toEqual([{ text: '2' }]);
    expect(claudeAdapter.keysFor('deny', p, fx('claude2-plan'))).toEqual([{ keys: ['Escape'] }]);
  });
});

describe('claude adapter: several questions in one AskUserQuestion (Claude Code 2.1.296 captures)', () => {
  const color = { kind: 'question' as const, text: 'Color?', options: ['Red', 'Blue'], source: 'hook' as const };
  const size = { kind: 'question' as const, text: 'Size?', source: 'pane' as const };
  it('detects each tab as a question, the answered mark dropped from the option', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-question-multi-first'))).toEqual({
      kind: 'question', text: 'Color?', options: ['Red', 'Blue', 'Type something.', 'Chat about this']
    });
    expect(claudeAdapter.detectPrompt(fx('claude2-question-multi-second'))?.text).toBe('Size?');
  });
  it('detects the review screen, which has no footer, as a question', () => {
    expect(claudeAdapter.detectPrompt(fx('claude2-question-multi-review'))).toEqual({
      kind: 'question', text: 'Ready to submit your answers?', options: ['Submit answers', 'Cancel']
    });
    expect(claudeAdapter.promptStillVisible(tail(fx('claude2-question-multi-review')))).toBe(true);
    expect(claudeAdapter.atRest!(fx('claude2-question-multi-review'))).toBe(false);
  });
  it('does not take chat quoting the review screen for one', () => {
    const pane = fx('claude2-question-multi-review') + '\n' + fx('claude2-idle');
    expect(claudeAdapter.detectPrompt(pane)).toBeNull();
    expect(claudeAdapter.promptStillVisible(tail(pane))).toBe(false);
  });
  it('a question is answered once the next tab or the review replaces it', () => {
    expect(claudeAdapter.promptGone!(fx('claude2-question-multi-first'), color)).toBe(false);
    expect(claudeAdapter.promptGone!(fx('claude2-question-multi-second'), color)).toBe(true);
    expect(claudeAdapter.promptGone!(fx('claude2-question-multi-review'), size)).toBe(true);
    expect(claudeAdapter.promptGone!(fx('claude2-idle'), color)).toBe(true);
  });
  it('a hook question whose text the pane wraps or cuts is still the same question', () => {
    const long = { ...color, text: 'Color?\nPick the one you like best for the background.' };
    expect(claudeAdapter.promptGone!(fx('claude2-question-multi-first'), long)).toBe(false);
  });
  it('an approval is gone only when no dialog is left, whatever the hook named it', () => {
    const perm = { kind: 'permission' as const, text: 'Bash: mkdir zz-ledge-probe (create the folder)', source: 'hook' as const };
    expect(claudeAdapter.promptGone!(fx('claude2-permission-bash'), perm)).toBe(false);
    expect(claudeAdapter.promptGone!(fx('claude2-idle'), perm)).toBe(true);
  });
});

describe('claude adapter: at rest', () => {
  it('is at rest on the input box with no turn running', () => {
    expect(claudeAdapter.atRest!(fx('claude2-idle'))).toBe(true);
    expect(claudeAdapter.atRest!(fx('claude2-fullscreen-idle'))).toBe(true);
    expect(claudeAdapter.atRest!(fx('claude2-rest-after-deny'))).toBe(true);
  });
  it('is not at rest while a turn runs or a dialog replaces the input box', () => {
    expect(claudeAdapter.atRest!(fx('claude2-working-status'))).toBe(false);
    expect(claudeAdapter.atRest!(fx('claude-working'))).toBe(false);
    for (const f of ['claude2-plan', 'claude2-trust', 'claude2-permission-bash', 'claude2-question']) expect(claudeAdapter.atRest!(fx(f)), f).toBe(false);
  });
});

describe('claude adapter: titled input box', () => {
  it('drops the input box from the preview when its top rule carries the conversation title', () => {
    const lines = claudeAdapter.previewLines!(fx('claude2-rest-after-deny'));
    expect(lines.some(l => l.includes('add-readme-file') || l.trim() === '❯')).toBe(false);
    expect(lines.some(l => l.includes('Cooked for 7s'))).toBe(true);
  });
});

describe('claude adapter: pane title', () => {
  const box = (top: string) => `● Done.\n\n${top}\n❯ \n${'─'.repeat(40)}\n  ⏸ manual mode on · ? for shortcuts`;
  it('reads the conversation title from the input box top rule', () => {
    expect(claudeAdapter.paneTitle!(box(`${'─'.repeat(28)} add-readme-file ─`))).toBe('add-readme-file');
    expect(claudeAdapter.paneTitle!(box(`${'─'.repeat(20)} Fix the flaky test ────`))).toBe('Fix the flaky test');
  });
  it('is null on an untitled box, a dialog or plain output', () => {
    expect(claudeAdapter.paneTitle!(box('─'.repeat(40)))).toBeNull();
    expect(claudeAdapter.paneTitle!(fx('claude2-permission-bash'))).toBeNull();
    expect(claudeAdapter.paneTitle!('just text\nmore text')).toBeNull();
  });
});

describe('claude adapter: always and a note (lot 6a)', () => {
  const perm = { kind: 'permission' as const, text: 'mkdir zz-ledge-probe', tool: 'Bash', source: 'hook' as const };
  const diff = { kind: 'diff' as const, text: 'Write a.txt', tool: 'Write', source: 'hook' as const };
  const plan = { kind: 'plan' as const, text: '# Plan', source: 'hook' as const };
  type Until = { until: (p: string) => boolean };
  it('always picks the option that stops asking, never auto mode, read from the dialog', () => {
    expect(claudeAdapter.keysFor('always', perm, fx('claude2-permission-bash'))).toEqual([{ text: '2' }]);   // Yes, and always allow access to
    expect(claudeAdapter.keysFor('always', diff, fx('claude2-permission-write'))).toEqual([{ text: '2' }]);  // accept edits … for this session
    expect(claudeAdapter.keysFor('always', plan, fx('claude2-plan'))).toEqual([{ text: '1' }]);             // Yes, and use auto mode
    expect(() => claudeAdapter.keysFor('always', perm, fx('claude2-question'))).toThrow('the request changed, look again'); // a question dialog is not the permission
  });
  it('always on a permission whose only lasting option is auto mode is refused, not auto mode', () => {
    const pane = fx('claude2-permission-bash').replace('2. Yes, and always allow access to', '2. Yes, once more');
    expect(() => claudeAdapter.keysFor('always', perm, pane)).toThrow('no "always" option in this dialog, answer in the terminal');
    expect(() => claudeAdapter.keysFor('always', perm)).toThrow('no "always" option in this dialog, answer in the terminal');
  });
  it('always on a plan never clears the context (Claude Code 2.0.x lists that variant first; edited capture)', () => {
    const v20 = fx('claude2-plan')
      .replace('❯ 1. Yes, and use auto mode', '❯ 1. Yes, clear context and auto-accept edits (shift+tab)')
      .replace('  2. Yes, manually approve edits', '  2. Yes, auto-accept edits')
      .replace('  3. Tell Claude what to change', '  3. Yes, manually approve edits\n     4. Tell Claude what to change');
    expect(claudeAdapter.keysFor('always', plan, v20)).toEqual([{ text: '2' }]);
    const onlyClear = fx('claude2-plan').replace('❯ 1. Yes, and use auto mode', '❯ 1. Yes, clear context and auto-accept edits (shift+tab)');
    expect(() => claudeAdapter.keysFor('always', plan, onlyClear)).toThrow('no "always" option in this dialog, answer in the terminal');
  });
  it('deny with a note: Escape, then the note once the input is back; a plan takes it in its own row', () => {
    expect(claudeAdapter.keysFor('deny', perm, fx('claude2-permission-bash'), 'Use\npnpm')).toEqual([{ keys: ['Escape'] }, { until: expect.any(Function) }, { text: 'Use pnpm' }, { keys: ['Enter'] }]);
    expect(claudeAdapter.keysFor('deny', plan, fx('claude2-plan'), 'Garde la v1')).toEqual([{ text: '3' }, { until: expect.any(Function) }, { text: 'Garde la v1' }, { keys: ['Enter'] }]);
  });
  it('the note waits for the screen it is meant for: the input at rest, or the plan row selected', () => {
    const rest = (claudeAdapter.keysFor('deny', perm, fx('claude2-permission-bash'), 'Use pnpm')[1] as Until).until;
    expect(rest(tail(fx('claude2-rest-after-deny'), 30))).toBe(true);
    expect(rest(tail(fx('claude2-permission-bash'), 30))).toBe(false);
    const row = (claudeAdapter.keysFor('deny', plan, fx('claude2-plan'), 'Garde la v1')[1] as Until).until;
    const focused = fx('claude2-plan').replace('❯ 1. Yes, and use auto mode', '  1. Yes, and use auto mode').replace('  3. Tell Claude what to change', '❯ 3. Tell Claude what to change');
    expect(row(tail(focused, 30))).toBe(true);
    expect(row(tail(fx('claude2-plan'), 30))).toBe(false);
  });
  it('a plan dialog without its own row takes the note like a permission; the trust dialog takes none', () => {
    const noRow = fx('claude2-plan').replace('3. Tell Claude what to change', '3. Keep planning');
    expect(claudeAdapter.keysFor('deny', plan, noRow, 'Garde la v1')).toEqual([{ keys: ['Escape'] }, { until: expect.any(Function) }, { text: 'Garde la v1' }, { keys: ['Enter'] }]);
    expect(() => claudeAdapter.keysFor('deny', perm, fx('claude2-trust'), 'non')).toThrow(/answer in the terminal/);
  });
});

describe('claude adapter: the dialog on screen must be the request (lot 6a review)', () => {
  const perm = { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const };
  const diff = { kind: 'diff' as const, text: 'Write a.txt', tool: 'Write', source: 'hook' as const };
  const plan = { kind: 'plan' as const, text: '# Plan', source: 'hook' as const };
  const q = { kind: 'question' as const, text: 'Which?', source: 'hook' as const };
  it('a plan dialog up while a permission is pending: nothing is typed (« always » would be « use auto mode »)', () => {
    for (const d of ['accept', 'always', 'deny'] as const) {
      expect(() => claudeAdapter.keysFor(d, perm, fx('claude2-plan'))).toThrow('the request changed, look again');
      expect(() => claudeAdapter.keysFor(d, diff, fx('claude2-plan'))).toThrow('the request changed, look again');
    }
    expect(() => claudeAdapter.keysFor('deny', perm, fx('claude2-plan'), 'Use pnpm')).toThrow('the request changed, look again');
  });
  it('a permission, a question or the trust dialog up while a plan is pending, and the other way round: nothing is typed', () => {
    expect(() => claudeAdapter.keysFor('accept', plan, fx('claude2-permission-bash'))).toThrow('the request changed, look again');
    expect(() => claudeAdapter.keysFor('accept', plan, fx('claude2-trust'))).toThrow('the request changed, look again');
    expect(() => claudeAdapter.keysFor('accept', plan, fx('claude2-question'))).toThrow('the request changed, look again');
    expect(() => claudeAdapter.keysFor('accept', perm, fx('claude2-question'))).toThrow('the request changed, look again');
    expect(() => claudeAdapter.keysFor('accept', q, fx('claude2-permission-bash'))).toThrow('the request changed, look again');
  });
  it('the matching dialog still takes its keys; a diff is a permission dialog; no readable dialog keeps the fallbacks', () => {
    expect(claudeAdapter.keysFor('accept', diff, fx('claude2-permission-write'))).toEqual([{ text: '1' }]);
    expect(claudeAdapter.keysFor('accept', perm, fx('claude2-trust'))).toEqual([{ keys: ['Down', 'Enter'] }]);
    expect(claudeAdapter.keysFor('accept', q, fx('claude2-question'))).toEqual([{ text: '1' }]);
    expect(claudeAdapter.keysFor('accept', perm)).toEqual([{ text: '1' }]);
  });
});
