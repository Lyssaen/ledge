import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { claudeAdapter } from '../src/adapters/claude.js';
import { buildPreview, tidyLines, PREVIEW_LINES } from '../src/adapters/preview.js';
import { DETECT_LINES } from '../src/daemon/poller.js';

const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
/** What Tmux.capture returns: trailing whitespace trimmed, last `n` lines. */
const capture = (pane: string, n: number) => pane.replace(/\s+$/g, '').split('\n').slice(-n).join('\n');
const rule = '─'.repeat(60);

describe('terminal preview', () => {
  it('fullscreen Claude Code: the conversation, not the blank gap and the input box', () => {
    const lines = buildPreview(capture(fx('claude2-fullscreen-idle'), 200), claudeAdapter);
    expect(lines.length).toBeLessThanOrEqual(PREVIEW_LINES);
    expect(lines.at(-1)).toBe('✻ Brewed for 3s · done 1:12 PM');
    expect(lines).toContain('● The src folder holds four files: client.ts, log.ts, names.ts and tmux.ts.');
    expect(lines).toContain('❯ Now list the files in src.');
    expect(lines.some(l => /^─+$/.test(l) || l === '❯' || l.includes('auto mode on'))).toBe(false);
    // No blank runs, no leading or trailing blank.
    expect(lines[0]).not.toBe('');
    expect(lines.some((l, i) => l === '' && lines[i + 1] === '')).toBe(false);
  });
  it('the old cut (last 30 raw lines) only showed blanks and the input box', () => {
    const raw = capture(fx('claude2-fullscreen-idle'), 60).split('\n').slice(-30).filter(l => l.trim());
    expect(raw.every(l => /^─+$/.test(l) || l.startsWith('❯') || l.includes('auto mode on'))).toBe(true);
  });
  it('prompt detection on the same fullscreen pane is unchanged: no dialog', () => {
    expect(claudeAdapter.detectPrompt(capture(fx('claude2-fullscreen-idle'), DETECT_LINES))).toBeNull();
  });
  it('inline Claude Code: the input box and status line are dropped', () => {
    const lines = buildPreview(fx('claude2-idle'), claudeAdapter);
    expect(lines.at(-1)).toBe('● Created a.txt containing the word hi.');
    expect(lines.some(l => l.startsWith('❯') || l.includes('manual mode on'))).toBe(false);
  });
  it('a placeholder or a multi-line draft in the input box is dropped too', () => {
    const pane = ['● Done.', '', rule, '❯ Try "fix typecheck errors"', rule, '  ⏵⏵ auto mode on'].join('\n');
    expect(buildPreview(pane, claudeAdapter)).toEqual(['● Done.']);
    const draft = ['● Done.', rule, '❯ first line', '  second line', '  third line', rule, '  ? for shortcuts', '  esc to clear'].join('\n');
    expect(buildPreview(draft, claudeAdapter)).toEqual(['● Done.']);
  });
  it('a dialog stays in the preview: it is what the user reviews', () => {
    const lines = buildPreview(fx('claude2-permission-bash'), claudeAdapter);
    expect(lines.at(-1)).toMatch(/Esc to cancel/);
    expect(lines.some(l => /❯ 1\. Yes/.test(l))).toBe(true);
  });
  it('rules that are not an input box (a chat that quotes one, a dialog) are kept', () => {
    const pane = ['● Here is a rule:', rule, '  some text', rule, '● and more', 'line', 'line', 'line', 'line'].join('\n');
    expect(buildPreview(pane, claudeAdapter)).toEqual(pane.split('\n'));
  });
  it('without an adapter hook (Codex, Cursor): raw lines, blank runs collapsed, trimmed, last 30', () => {
    expect(buildPreview('\n\n a\n\n\n\nb  \n\n')).toEqual([' a', '', 'b']);
    expect(buildPreview(Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n'))).toEqual(Array.from({ length: 30 }, (_, i) => `l${i + 20}`));
    expect(buildPreview('', {})).toEqual([]);
    // The cut never starts on a blank line.
    expect(buildPreview(['x', '', ...Array.from({ length: 29 }, (_, i) => `l${i}`)].join('\n'))).toEqual(Array.from({ length: 29 }, (_, i) => `l${i}`));
    expect(tidyLines(['', ' ', 'x', '  ', '', 'y', ''])).toEqual(['x', '', 'y']);
  });
});
