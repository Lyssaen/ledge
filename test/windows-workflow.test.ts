import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The daemon's suite on Windows (spec 2026-11-03 §4.2.8): every PR to snapshot or main runs it on windows-latest, and the
// job fails when it skips more tests than the ceiling, so it cannot go green by skipping.
const text = readFileSync(resolve('.github/workflows/windows.yml'), 'utf8');

describe('the Windows workflow', () => {
  it('runs on PRs to snapshot and main, and by hand', () => {
    expect(text).toMatch(/pull_request:\s*\n\s*branches: \[snapshot, main\]/);
    expect(text).toContain('workflow_dispatch');
  });
  it('runs the daemon suite on windows-latest after a frozen install', () => {
    expect(text).toContain('runs-on: windows-latest');
    expect(text.indexOf('pnpm install --frozen-lockfile')).toBeGreaterThan(0);
    expect(text.indexOf('pnpm --filter @paradow/ledge exec vitest run')).toBeGreaterThan(text.indexOf('pnpm install --frozen-lockfile'));
  });
  it('fails above a ceiling of skipped tests, and says whether links can be made', () => {
    expect(text).toMatch(/MAX_WINDOWS_SKIPS: \d+/);
    expect(text).toContain('symlinks:');
  });
});
