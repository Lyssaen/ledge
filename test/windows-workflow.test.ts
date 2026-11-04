import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// The yaml parser the daemon already depends on: GitHub refuses a workflow that does not parse, before running anything.
const { parse } = createRequire(resolve('packages/ledge/package.json'))('yaml') as { parse: (s: string) => any };

// The daemon's suite on Windows (spec 2026-11-03 §4.2.8): every PR to snapshot or main runs it on windows-latest, and the
// job fails when it skips more tests than the ceiling, so it cannot go green by skipping.
const text = readFileSync(resolve('.github/workflows/windows.yml'), 'utf8');

describe('the Windows workflow', () => {
  it('parses, and its suite step gets the runner temp folder in a step env (the runner context is not in the job env)', () => {
    const wf = parse(text);
    const steps = wf.jobs['daemon-tests'].steps as Array<{ name?: string; env?: Record<string, string> }>;
    expect(wf.jobs['daemon-tests'].env?.TEMP).toBeUndefined();
    expect(steps.find(s => s.name === "The daemon's suite")?.env).toEqual({ TEMP: '${{ runner.temp }}', TMP: '${{ runner.temp }}' });
  });
  it('runs on PRs to snapshot and main, and by hand', () => {
    expect(text).toMatch(/pull_request:\s*\n\s*branches: \[snapshot, main\]/);
    expect(text).toContain('workflow_dispatch');
  });
  it('runs the daemon suite on windows-latest after a frozen install', () => {
    expect(text).toContain('runs-on: windows-latest');
    expect(text.indexOf('pnpm install --frozen-lockfile')).toBeGreaterThan(0);
    expect(text.indexOf('pnpm --filter @paradow/ledge exec vitest run')).toBeGreaterThan(text.indexOf('pnpm install --frozen-lockfile'));
  });
  it('gives the job a time limit and a temp folder without an 8.3 short name (realpath would expand RUNNER~1)', () => {
    expect(text).toMatch(/timeout-minutes: \d+/);
    expect(text).toContain('TEMP: ${{ runner.temp }}');
    expect(text).toContain('TMP: ${{ runner.temp }}');
  });
  it('fails above a ceiling of skipped tests, and says whether links can be made', () => {
    expect(text).toMatch(/MAX_WINDOWS_SKIPS: \d+/);
    expect(text).toContain('symlinks:');
  });
});
