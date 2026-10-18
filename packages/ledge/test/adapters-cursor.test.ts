import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cursorAdapter } from '../src/adapters/cursor.js';
import { adapterFor, buildPreview } from '../src/adapters/index.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
const tail = (pane: string, n = 5) => pane.replace(/\s+$/g, '').split('\n').slice(-n).join('\n');
const perm = { kind: 'permission' as const, text: 'echo ledge-perm-probe', source: 'pane' as const };

describe('cursor adapter: permission (Cursor Agent 2026.10 capture)', () => {
  it('detects Run this command? at the bottom and extracts the shell command', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-permission'))).toEqual({
      kind: 'permission', text: 'echo ledge-perm-probe', command: { lines: ['echo ledge-perm-probe'], ends: [30] }
    });
  });
  it('joins a command wrapped over several lines (a subagent\'s find)', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-permission-wrapped'))).toEqual({
      kind: 'permission',
      text: `find "/tmp/ledge-cursor-sub/proj" \\( -path '*/.git/objects' -o -path '*/.git/objects/*' \\) -prune -o -print 2>/dev/null | sort`,
      // Its lines as drawn, and where each ends: the first one is full, the TUI wrapped it.
      command: { lines: [`find "/tmp/ledge-cursor-sub/proj" \\( -path '*/.git/objects' -o -path '*/.git/objects/*' \\) -prune -o -print`, '2>/dev/null | sort'], ends: [111, 27] }
    });
  });
  it('ignores a quoted dialog, the working chrome, the idle input and an answered trust box', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-trap-allow-in-file'))).toBeNull();
    expect(cursorAdapter.detectPrompt(fx('cursor-working'))).toBeNull();
    expect(cursorAdapter.detectPrompt(fx('cursor-idle'))).toBeNull();
    expect(cursorAdapter.detectPrompt(fx('cursor-skip-field'))).toBeNull();
  });
  it('promptStillVisible sees the live dialog footer and the skip field, not working chrome', () => {
    expect(cursorAdapter.promptStillVisible(tail(fx('cursor-permission')))).toBe(true);
    expect(cursorAdapter.promptStillVisible(tail(fx('cursor-skip-field')))).toBe(true);
    expect(cursorAdapter.promptStillVisible(tail(fx('cursor-working')))).toBe(false);
    expect(cursorAdapter.promptStillVisible(tail(fx('cursor-idle')))).toBe(false);
  });
  it('accept sends y (run once); never tab / shift+tab', () => {
    expect(cursorAdapter.keysFor('accept', perm, fx('cursor-permission'))).toEqual([{ text: 'y' }]);
  });
  it('deny sends n, and the Enter that skips the field only once the field is on screen (else Enter would run it)', () => {
    const plan = cursorAdapter.keysFor('deny', perm, fx('cursor-permission'));
    expect(plan).toHaveLength(3);
    expect(plan[0]).toEqual({ text: 'n' });
    expect(plan[2]).toEqual({ keys: ['Enter'] });
    const until = (plan[1] as { until: (p: string) => boolean }).until;
    expect(until(tail(fx('cursor-skip-field')))).toBe(true);
    expect(until(tail(fx('cursor-permission')))).toBe(false);
  });
  it('in the skip field (n pressed in the terminal): deny is the empty Enter, accept is Esc then y once the dialog is back', () => {
    expect(cursorAdapter.keysFor('deny', perm, fx('cursor-skip-field'))).toEqual([{ keys: ['Enter'] }]);
    const plan = cursorAdapter.keysFor('accept', perm, fx('cursor-skip-field'));
    expect(plan[0]).toEqual({ keys: ['Escape'] });
    expect(plan[2]).toEqual({ text: 'y' });
    const until = (plan[1] as { until: (p: string) => boolean }).until;
    expect(until(tail(fx('cursor-permission')))).toBe(true);
    expect(until(tail(fx('cursor-skip-field')))).toBe(false);
  });
  it('interrupt is Ctrl-C', () => {
    expect(cursorAdapter.interruptKeys()).toEqual(['C-c']);
  });
  it('a reply is flattened to one line, then Enter once the input line holds it (sent together, Enter is lost)', () => {
    const plan = cursorAdapter.replyPlan('run the\ntests');
    expect(plan[0]).toEqual({ text: 'run the tests' });
    expect(plan[2]).toEqual({ keys: ['Enter'] });
    const until = (plan[1] as { until: (p: string) => boolean }).until;
    const idle = fx('cursor-idle');
    expect(until(idle)).toBe(false);
    expect(until(idle.replace('→ Plan, search, build anything', '→ run the tests'))).toBe(true);
    // A short reply is not mistaken for a digit in the status line or for an earlier draft.
    expect(cursorAdapter.replyPlan('2').length).toBe(3);
    const two = (cursorAdapter.replyPlan('2')[1] as { until: (p: string) => boolean }).until;
    expect(two(idle)).toBe(false);
    expect(two(idle.replace('→ Plan, search, build anything', '→ 12'))).toBe(false);
    expect(two(idle.replace('→ Plan, search, build anything', '→ 2'))).toBe(true);
    // A long reply wraps over many lines under the arrow.
    const long = 'word '.repeat(200).trim();
    const wrapped = (long.match(/.{1,120}/g) ?? []).map((l, i) => (i ? '    ' : '  → ') + l).join('\n');
    const longUntil = (cursorAdapter.replyPlan(long)[1] as { until: (p: string) => boolean }).until;
    expect(longUntil(idle.replace('  → Plan, search, build anything', wrapped))).toBe(true);
  });
  it('adapterFor returns the cursor adapter', () => {
    expect(adapterFor('cursor')).toBe(cursorAdapter);
  });
});

describe('cursor adapter: workspace trust', () => {
  it('detects the live trust dialog with its wrapped path', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-trust'))).toEqual({
      kind: 'permission',
      text: 'Trust this folder? /tmp/claude-1000/-home-paradow-Workspace-harness-assistant/a6132808-ea85-4b33-89da-c4ad83796de8/scratchpad/untrusted',
      options: ['Trust this workspace', 'Quit']
    });
    expect(cursorAdapter.promptStillVisible(tail(fx('cursor-trust')))).toBe(true);
  });
  it('accept trusts with a, deny quits with q', () => {
    expect(cursorAdapter.keysFor('accept', perm, fx('cursor-trust'))).toEqual([{ text: 'a' }]);
    expect(cursorAdapter.keysFor('deny', perm, fx('cursor-trust'))).toEqual([{ text: 'q' }]);
  });
});

describe('cursor adapter: rest and preview', () => {
  it('at rest: the input line with no turn running; not while working, in a dialog or the skip field', () => {
    expect(cursorAdapter.atRest!(fx('cursor-idle'))).toBe(true);
    expect(cursorAdapter.atRest!(fx('cursor-working'))).toBe(false);
    expect(cursorAdapter.atRest!(fx('cursor-permission'))).toBe(false);
    expect(cursorAdapter.atRest!(fx('cursor-trust'))).toBe(false);
    expect(cursorAdapter.atRest!(fx('cursor-skip-field'))).toBe(false);
  });
  it('the preview drops the input line and the status under it, and keeps a dialog whole', () => {
    const working = buildPreview(fx('cursor-working'), cursorAdapter);
    expect(working.at(-1)).toContain('$ echo ledge-perm-probe');
    expect(working.join('\n')).not.toContain('ctrl+c to stop');
    expect(working.join('\n')).not.toContain('Grok');
    expect(buildPreview(fx('cursor-permission'), cursorAdapter).at(-1)).toContain('(esc or n)');
  });
});

describe('cursor adapter: questions (AskQuestion, no hook)', () => {
  const question = { kind: 'question' as const, text: 'x', source: 'pane' as const };
  it('detects the question on screen with its options, Other left out', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-question'))).toEqual({
      kind: 'question', text: 'notes.txt currently ends with lines a and b. Which new line should I append?', options: ['c', 'd']
    });
    expect(cursorAdapter.detectPrompt(fx('cursor-question-second'))).toEqual({
      kind: 'question', text: 'Which position should the letter be placed in notes.txt?', options: ['top', 'bottom']
    });
    expect(cursorAdapter.promptStillVisible(tail(fx('cursor-question')))).toBe(true);
    expect(cursorAdapter.atRest!(fx('cursor-question'))).toBe(false);
  });
  it('a digit moves to its option, ticks it once the cursor is there, then Enter once it is ticked', () => {
    const plan = cursorAdapter.replyPlan('2', question, fx('cursor-question'));
    expect(plan.map(s => ('until' in s ? 'until' : s))).toEqual([{ keys: ['Down'] }, 'until', { text: ' ' }, 'until', { keys: ['Enter'] }]);
    const [, onIt, , ticked] = plan as Array<{ until: (p: string) => boolean }>;
    expect(onIt!.until(fx('cursor-question'))).toBe(false);
    const moved = fx('cursor-question').replace('›', ' ').replace('     [ ] d', '   › [ ] d');
    expect(onIt!.until(moved)).toBe(true);
    expect(ticked!.until(moved)).toBe(false);
    expect(ticked!.until(moved.replace('› [ ] d', '› [x] d'))).toBe(true);
  });
  it('the first option needs no move; an option out of range is refused; text is typed as a reply', () => {
    expect(cursorAdapter.replyPlan('1', question, fx('cursor-question')).map(s => ('until' in s ? 'until' : s))).toEqual([{ text: ' ' }, 'until', { keys: ['Enter'] }]);
    expect(() => cursorAdapter.replyPlan('4', question, fx('cursor-question'))).toThrow('no option 4');
    expect(cursorAdapter.replyPlan('hello', question, fx('cursor-question'))[0]).toEqual({ text: 'hello' });
  });
  it('accept answers with the first option, deny skips with Esc', () => {
    expect(cursorAdapter.keysFor('accept', question, fx('cursor-question')).at(-1)).toEqual({ keys: ['Enter'] });
    expect(cursorAdapter.keysFor('deny', question, fx('cursor-question'))).toEqual([{ keys: ['Escape'] }]);
  });
  it('the next question is a new prompt, not a failed answer; the same one still on screen is not gone', () => {
    const first = { ...question, text: 'Which letter should be added to notes.txt?' };
    expect(cursorAdapter.promptGone!(fx('cursor-question-two'), first)).toBe(false);
    expect(cursorAdapter.promptGone!(fx('cursor-question-second'), first)).toBe(true);
  });
});

describe('cursor adapter: plan (Plan mode, no hook)', () => {
  const plan = { kind: 'plan' as const, text: 'Add line d to notes.txt', source: 'pane' as const };
  it('detects "Ready to build?" with the plan\'s title and its options', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-plan'))).toEqual({
      kind: 'plan', text: 'Add line d to notes.txt', options: ['Yes, build locally', 'Yes, build in cloud', 'No, propose changes'],
      body: 'Add line d to notes.txt\n\nnotes.txt (notes.txt) currently contains:\n\na\nb\n\nYou selected d. The change is to append that as a third line so the file becomes:\n\n'
        + 'a\nb\nd\n\nNo other files need to change. After you approve, I will edit notes.txt (notes.txt) only.'
    });
    expect(cursorAdapter.promptStillVisible(tail(fx('cursor-plan')))).toBe(true);
    expect(cursorAdapter.atRest!(fx('cursor-plan'))).toBe(false);
  });
  it('a plan box whose top scrolled out of the pane gives no body rather than half a plan', () => {
    const cut = fx('cursor-plan').split('\n').filter(l => !/Suggested Plan/.test(l)).join('\n');
    expect(cursorAdapter.detectPrompt(cut)).toMatchObject({ kind: 'plan', text: 'Ready to build?' });
    expect(cursorAdapter.detectPrompt(cut)).not.toHaveProperty('body');
  });
  it('accept builds locally (b, never the cloud); deny opens the revise field and waits for it', () => {
    expect(cursorAdapter.keysFor('accept', plan, fx('cursor-plan'))).toEqual([{ text: 'b' }]);
    const deny = cursorAdapter.keysFor('deny', plan, fx('cursor-plan'));
    expect(deny[0]).toEqual({ text: 'p' });
    const until = (deny[1] as { until: (p: string) => boolean }).until;
    expect(until(fx('cursor-plan'))).toBe(false);
    expect(until(fx('cursor-plan-revise'))).toBe(true);
  });
  it('the revise field is the agent waiting for text: no prompt, at rest, and a reply is typed there', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-plan-revise'))).toBeNull();
    expect(cursorAdapter.promptGone!(fx('cursor-plan-revise'), plan)).toBe(true);
    expect(cursorAdapter.atRest!(fx('cursor-plan-revise'))).toBe(true);
    const reply = cursorAdapter.replyPlan('use the letter z instead');
    expect((reply[1] as { until: (p: string) => boolean }).until(fx('cursor-plan-revise-typed'))).toBe(true);
  });
});

describe('cursor adapter: promptGone on approvals', () => {
  it('the approval answered is gone; the skip field is not; another command asked next is a new prompt', () => {
    expect(cursorAdapter.promptGone!(fx('cursor-permission'), perm)).toBe(false);
    expect(cursorAdapter.promptGone!(fx('cursor-skip-field'), perm)).toBe(false);
    expect(cursorAdapter.promptGone!(fx('cursor-working'), perm)).toBe(true);
    expect(cursorAdapter.promptGone!(fx('cursor-permission-wrapped'), perm)).toBe(true);
  });
});

describe('cursor adapter: a note (lot 6a)', () => {
  const plan = { kind: 'plan' as const, text: 'Add line d to notes.txt', source: 'pane' as const };
  type Until = { until: (p: string) => boolean };
  it('deny with a note types it in the skip field, or in the plan revision field', () => {
    expect(cursorAdapter.keysFor('deny', perm, fx('cursor-permission'), 'Use pnpm')).toEqual([{ text: 'n' }, { until: expect.any(Function) }, { text: 'Use pnpm' }, { until: expect.any(Function) }, { keys: ['Enter'] }]);
    expect(cursorAdapter.keysFor('deny', plan, fx('cursor-plan'), 'Garde la v1')).toEqual([{ text: 'p' }, { until: expect.any(Function) }, { text: 'Garde la v1' }, { until: expect.any(Function) }, { keys: ['Enter'] }]);
  });
  it('each step waits for its screen: the field, then the note in it', () => {
    const skip = cursorAdapter.keysFor('deny', perm, fx('cursor-permission'), 'Use\npnpm');
    expect(skip[2]).toEqual({ text: 'Use pnpm' });
    expect((skip[1] as Until).until(tail(fx('cursor-skip-field')))).toBe(true);
    expect((skip[1] as Until).until(tail(fx('cursor-permission')))).toBe(false);
    const typedIn = fx('cursor-skip-field').replace(/→ Tell the agent what to do instead.*$/m, '→ Use pnpm');
    expect((skip[3] as Until).until(tail(typedIn))).toBe(true);
    expect((skip[3] as Until).until(tail(fx('cursor-skip-field')))).toBe(false);
    const revise = cursorAdapter.keysFor('deny', plan, fx('cursor-plan'), 'use the letter z instead');
    expect((revise[1] as Until).until(fx('cursor-plan-revise'))).toBe(true);
    expect((revise[1] as Until).until(fx('cursor-plan'))).toBe(false);
    expect((revise[3] as Until).until(fx('cursor-plan-revise-typed'))).toBe(true);
    expect((revise[3] as Until).until(fx('cursor-plan-revise'))).toBe(false);
  });
  it('already in the skip field the note goes straight in; the trust box takes none; always is never offered', () => {
    expect(cursorAdapter.keysFor('deny', perm, fx('cursor-skip-field'), 'Use pnpm')).toEqual([{ text: 'Use pnpm' }, { until: expect.any(Function) }, { keys: ['Enter'] }]);
    expect(() => cursorAdapter.keysFor('deny', perm, fx('cursor-trust'), 'non')).toThrow(/answer in the terminal/);
    expect(() => cursorAdapter.keysFor('always', perm, fx('cursor-permission'))).toThrow('no "always" option in this dialog, answer in the terminal');
  });
});

describe('cursor adapter: the dialog on screen must be the request (lot 6a review)', () => {
  const plan = { kind: 'plan' as const, text: 'Add line d to notes.txt', source: 'pane' as const };
  const question = { kind: 'question' as const, text: 'Which letter should be added?', source: 'pane' as const };
  it('a plan up while a permission is pending, or the other way round: nothing is typed', () => {
    for (const d of ['accept', 'deny'] as const) {
      expect(() => cursorAdapter.keysFor(d, perm, fx('cursor-plan'))).toThrow('the request changed, look again');
      expect(() => cursorAdapter.keysFor(d, plan, fx('cursor-permission'))).toThrow('the request changed, look again');
      expect(() => cursorAdapter.keysFor(d, plan, fx('cursor-skip-field'))).toThrow('the request changed, look again');
      expect(() => cursorAdapter.keysFor(d, plan, fx('cursor-trust'))).toThrow('the request changed, look again');
      expect(() => cursorAdapter.keysFor(d, question, fx('cursor-permission'))).toThrow('the request changed, look again');
      expect(() => cursorAdapter.keysFor(d, perm, fx('cursor-question'))).toThrow('the request changed, look again');
    }
    expect(() => cursorAdapter.keysFor('deny', perm, fx('cursor-plan'), 'Use pnpm')).toThrow('the request changed, look again');
  });
  it('the matching dialog still takes its keys', () => {
    expect(cursorAdapter.keysFor('accept', plan, fx('cursor-plan'))).toEqual([{ text: 'b' }]);
    expect(cursorAdapter.keysFor('accept', perm, fx('cursor-trust'))).toEqual([{ text: 'a' }]);
  });
});
