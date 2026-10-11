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
      kind: 'permission', text: 'echo ledge-perm-probe'
    });
  });
  it('joins a command wrapped over several lines (a subagent\'s find)', () => {
    expect(cursorAdapter.detectPrompt(fx('cursor-permission-wrapped'))).toEqual({
      kind: 'permission',
      text: `find "/tmp/ledge-cursor-sub/proj" \\( -path '*/.git/objects' -o -path '*/.git/objects/*' \\) -prune -o -print 2>/dev/null | sort`
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
