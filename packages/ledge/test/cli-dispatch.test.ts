import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_USAGE } from '../src/cli/task.js';
import { TEAM_USAGE } from '../src/cli/team.js';

// The real dispatcher (cli/index.ts), run as the CLI is: `task` and `team` reach their modules, never a « retiré » line.
const entry = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));
const ledge = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], {
  encoding: 'utf8', timeout: 30000, env: { ...process.env, LEDGE_HOME: mkdtempSync(join(tmpdir(), 'ledge-cli-')), LEDGE_SESSION: '' } });

describe('ledge task and ledge team through the CLI dispatcher', () => {
  for (const [cmd, usage] of [['task', TASK_USAGE], ['team', TEAM_USAGE]] as const) {
    it(`ledge ${cmd} prints its usage, with no removal notice`, () => {
      const r = ledge(cmd);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(usage.trim());
      expect(r.stdout + r.stderr).not.toMatch(/retiré|retirée|removed/i);
    });
    it(`ledge ${cmd} with arguments it does not know prints the usage and fails`, () => {
      const r = ledge(cmd, 'nope');
      expect(r.status).toBe(1);
      expect(r.stdout.trim()).toBe(usage.trim());
    });
  }
});
