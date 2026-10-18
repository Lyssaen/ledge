import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Pending } from '@ledge/protocol';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { cursorAdapter } from '../src/adapters/cursor.js';
import { STALE, UNCHECKED, dialogMismatch } from '../src/adapters/types.js';
const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
const bash = (text: string, tool = 'Bash'): Pending => ({ kind: 'permission', text, tool, source: 'hook' });
/** A Claude Code « Bash command » dialog drawing `lines` between its dashed rules, on an 80-column pane. */
const claudeBash = (...lines: string[]) => claudeAdapter.detectPrompt([
  '─'.repeat(80), ' Bash command', '╌'.repeat(80), ...lines.map(l => ` ${l}`), '╌'.repeat(80),
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'
].join('\n'));

describe('dialogMismatch: the dialog on screen is the request answered', () => {
  it('a shell command shown as such must be the one approved, whatever the harness and the wrapping', () => {
    const claude = claudeAdapter.detectPrompt(fx('claude2-permission-bash'));
    expect(dialogMismatch(claude, bash('mkdir zz-ledge-probe'), 80)).toBeNull();
    // The hook for the dialog on screen has not come: the daemon still holds the command the user saw.
    expect(dialogMismatch(claude, bash('pnpm test'), 80)).toBe(STALE);
    const codex = codexAdapter.detectPrompt(fx('codex-permission-exec'));
    expect(dialogMismatch(codex, bash("printf '%s\\n' hi > hello.txt"), 120)).toBeNull();
    expect(dialogMismatch(codex, bash('pnpm test', 'shell'), 120)).toBe(STALE);
    const wrapped = cursorAdapter.detectPrompt(fx('cursor-permission-wrapped'));
    const find = `find "/tmp/ledge-cursor-sub/proj" \\( -path '*/.git/objects' -o -path '*/.git/objects/*' \\) -prune -o -print 2>/dev/null | sort`;
    expect(dialogMismatch(wrapped, bash(find, 'Shell'), 120)).toBeNull();
    expect(dialogMismatch(wrapped, bash('find /tmp', 'Shell'), 120)).toBe(STALE);
    // Its first line ends far from the edge of a wider pane: the break is a newline, not the TUI's wrap.
    expect(dialogMismatch(wrapped, bash(find, 'Shell'), 200)).toBe(STALE);
  });
  it('every character of the command counts: spaces, and a newline where the line has room left', () => {
    // A newline ends the comment and runs the rm: not the command that keeps it in the comment.
    expect(dialogMismatch(claudeBash('echo ok #', 'rm -f /tmp/x'), bash('echo ok # rm -f /tmp/x'), 80)).toBe(STALE);
    expect(dialogMismatch(claudeBash('echo ok # rm -f /tmp/x'), bash('echo ok #\nrm -f /tmp/x'), 80)).toBe(STALE);
    expect(dialogMismatch(claudeBash('echo ok #', 'rm -f /tmp/x'), bash('echo ok #\nrm -f /tmp/x'), 80)).toBeNull();
    expect(dialogMismatch(claudeBash('cat > a.txt <<EOF', '', '  two', 'EOF'), bash('cat > a.txt <<EOF\n\n  two\nEOF'), 80)).toBeNull();
    expect(dialogMismatch(claudeBash('rm "cache file"'), bash('rm "cachefile"'), 80)).toBe(STALE);
    expect(dialogMismatch(claudeBash('rm "cachefile"'), bash('rm "cache file"'), 80)).toBe(STALE);
  });
  it('a line the TUI wrapped joins the next at a space, or mid-word only when it reaches the edge', () => {
    const long = `echo ${'a'.repeat(60)}`;
    // The next word does not fit on the line: the TUI wrapped it there, the space it took is the command's.
    expect(dialogMismatch(claudeBash(long, '/tmp/some-file'), bash(`${long} /tmp/some-file`), 80)).toBeNull();
    expect(dialogMismatch(claudeBash(long, '/tmp/some-file'), bash(`${long}/tmp/some-file`), 80)).toBe(STALE);
    expect(dialogMismatch(claudeBash(long, '/tmp/some-file'), bash(`${long}\n/tmp/some-file`), 80)).toBe(STALE);
    // The same short word would have fitted: that break is the command's own newline.
    expect(dialogMismatch(claudeBash(long, 'file'), bash(`${long} file`), 80)).toBe(STALE);
    // A line cut at the edge may have lost a space or nothing.
    const full = `echo ${'b'.repeat(74)}`;
    expect(dialogMismatch(claudeBash(full, 'cd'), bash(`${full}cd`), 80)).toBeNull();
    expect(dialogMismatch(claudeBash(full, 'cd'), bash(`${full} cd`), 80)).toBeNull();
  });
  it('a request read from the pane, and a question, are compared with what the dialog says', () => {
    const cursor = cursorAdapter.detectPrompt(fx('cursor-permission'));
    expect(dialogMismatch(cursor, { kind: 'permission', text: 'echo ledge-perm-probe', source: 'pane' })).toBeNull();
    expect(dialogMismatch(cursor, { kind: 'permission', text: 'echo other', source: 'pane' })).toBe(STALE);
    const question = codexAdapter.detectPrompt(fx('codex-question'));
    expect(dialogMismatch(question, { kind: 'question', text: 'Which color should the banner be?', source: 'hook' })).toBeNull();
    expect(dialogMismatch(question, { kind: 'question', text: 'Which font should the banner use?', source: 'hook' })).toBe(STALE);
  });
  it('a plan or a file, whose text the dialog does not show, need only a dialog of their kind', () => {
    expect(dialogMismatch(claudeAdapter.detectPrompt(fx('claude2-plan')), { kind: 'plan', text: '# Plan', source: 'hook' })).toBeNull();
    expect(dialogMismatch(claudeAdapter.detectPrompt(fx('claude2-permission-write')), { kind: 'diff', text: '/w/a.txt', tool: 'Write', source: 'hook' })).toBeNull();
    expect(dialogMismatch(claudeAdapter.detectPrompt(fx('claude2-plan')), { kind: 'diff', text: '/w/a.txt', tool: 'Write', source: 'hook' })).toBe(STALE);
  });
  it('what cannot be read is not approved: no dialog read, a command not shown, cut, or wrapped on a pane of unknown width', () => {
    expect(dialogMismatch(null, bash('pnpm test'), 80)).toBe(UNCHECKED);
    expect(dialogMismatch(null, { kind: 'diff', text: '/w/a.txt', tool: 'Write', source: 'hook' })).toBe(UNCHECKED);
    const bare = 'x\n' + '─'.repeat(40) + '\n Bash command\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';
    expect(dialogMismatch(claudeAdapter.detectPrompt(bare), bash('pnpm test'), 80)).toBe(UNCHECKED);
    expect(dialogMismatch(claudeBash('npm run build -- --wat…'), bash('npm run build -- --watch'), 80)).toBe(UNCHECKED);
    expect(dialogMismatch(claudeBash('echo ok #', 'rm -f /tmp/x'), bash('echo ok #\nrm -f /tmp/x'))).toBe(UNCHECKED);
    expect(dialogMismatch(claudeBash('mkdir zz-ledge-probe'), bash('mkdir zz-ledge-probe'))).toBeNull();
  });
});
