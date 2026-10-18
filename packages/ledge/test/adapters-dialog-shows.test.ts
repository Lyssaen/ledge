import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Pending } from '@ledge/protocol';
import { claudeAdapter } from '../src/adapters/claude.js';
import { codexAdapter } from '../src/adapters/codex.js';
import { cursorAdapter } from '../src/adapters/cursor.js';
import { dialogShows } from '../src/adapters/types.js';
const fx = (n: string) => readFileSync(new URL(`./fixtures/panes/${n}.txt`, import.meta.url), 'utf8');
const bash = (text: string, tool = 'Bash'): Pending => ({ kind: 'permission', text, tool, source: 'hook' });

describe('dialogShows: the dialog on screen is the request answered', () => {
  it('a shell command shown as such must be the one approved, whatever the harness and the wrapping', () => {
    const claude = claudeAdapter.detectPrompt(fx('claude2-permission-bash'));
    expect(dialogShows(claude, bash('mkdir zz-ledge-probe'))).toBe(true);
    // The hook for the dialog on screen has not come: the daemon still holds the command the user saw.
    expect(dialogShows(claude, bash('pnpm test'))).toBe(false);
    const codex = codexAdapter.detectPrompt(fx('codex-permission-exec'));
    expect(dialogShows(codex, bash("printf '%s\\n' hi > hello.txt"))).toBe(true);
    expect(dialogShows(codex, bash('pnpm test', 'shell'))).toBe(false);
    const wrapped = cursorAdapter.detectPrompt(fx('cursor-permission-wrapped'));
    expect(dialogShows(wrapped, bash(`find "/tmp/ledge-cursor-sub/proj" \\( -path '*/.git/objects' -o -path '*/.git/objects/*' \\) -prune -o -print 2>/dev/null | sort`, 'Shell'))).toBe(true);
    expect(dialogShows(wrapped, bash('find /tmp', 'Shell'))).toBe(false);
    // A command the pane cuts with … is the one that starts the same.
    expect(dialogShows({ kind: 'permission', text: 'npm run build -- --wat…', command: 'npm run build -- --wat…' }, bash('npm run build -- --watch'))).toBe(true);
    expect(dialogShows({ kind: 'permission', text: 'npm run build -- --wat…', command: 'npm run build -- --wat…' }, bash('npm test'))).toBe(false);
  });
  it('a request read from the pane, and a question, are compared with what the dialog says', () => {
    const cursor = cursorAdapter.detectPrompt(fx('cursor-permission'));
    expect(dialogShows(cursor, { kind: 'permission', text: 'echo ledge-perm-probe', source: 'pane' })).toBe(true);
    expect(dialogShows(cursor, { kind: 'permission', text: 'echo other', source: 'pane' })).toBe(false);
    const question = codexAdapter.detectPrompt(fx('codex-question'));
    expect(dialogShows(question, { kind: 'question', text: 'Which color should the banner be?', source: 'hook' })).toBe(true);
    expect(dialogShows(question, { kind: 'question', text: 'Which font should the banner use?', source: 'hook' })).toBe(false);
  });
  it('what the dialog does not show (a plan, a file, a Bash dialog without its command) is left to the other checks', () => {
    expect(dialogShows(claudeAdapter.detectPrompt(fx('claude2-plan')), { kind: 'plan', text: '# Plan', source: 'hook' })).toBe(true);
    expect(dialogShows(claudeAdapter.detectPrompt(fx('claude2-permission-write')), { kind: 'diff', text: '/w/a.txt', tool: 'Write', source: 'hook' })).toBe(true);
    const bare = 'x\n' + '─'.repeat(40) + '\n Bash command\n\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel · Tab to amend';
    expect(dialogShows(claudeAdapter.detectPrompt(bare), bash('pnpm test'))).toBe(true);
    expect(dialogShows(null, bash('pnpm test'))).toBe(true);
  });
});
