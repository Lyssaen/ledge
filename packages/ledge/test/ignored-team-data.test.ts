import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logIgnoredTeamData } from '../src/daemon/index.js';

const WHY = 'Ledge teams, roles and tasks were removed (2026-10-30-ledge-openrig-orchestrator-design §7)';

describe('logIgnoredTeamData', () => {
  it('logs one line per old team, role or task file present, and reads none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-ignored-'));
    writeFileSync(join(dir, 'tasks.json'), '{"not":"read"');
    writeFileSync(join(dir, 'teams-live.json'), '[]');
    mkdirSync(join(dir, 'teams')); mkdirSync(join(dir, 'roles'));
    const lines: string[] = [];
    logIgnoredTeamData(dir, l => lines.push(l));
    expect(lines).toEqual(['tasks.json', 'teams-live.json', 'teams', 'roles'].map(f => `ignored ${join(dir, f)}: ${WHY}`));
    expect(existsSync(join(dir, 'tasks.json'))).toBe(true);
    expect(existsSync(join(dir, 'roles'))).toBe(true);
  });
  it('logs nothing when none is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-ignored-'));
    writeFileSync(join(dir, 'asks.json'), '[]');
    const lines: string[] = [];
    logIgnoredTeamData(dir, l => lines.push(l));
    expect(lines).toEqual([]);
  });
});
