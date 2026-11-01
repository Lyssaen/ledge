import { describe, it, expect } from 'vitest';
import { TeamsEngineSchema, DEFAULT_TEAMS_ENGINE, RigSchema, parseServerMessage, parseClientMessage } from '../src/index.js';

const rig = { id: 'r1', name: 'starter', machine: 'local', cwd: '/w', projectId: null, offProject: true, lifecycle: 'running' as const, kernel: false, seats: [], repos: [] };

describe('teams engine contract', () => {
  it('schema and default', () => {
    expect(TeamsEngineSchema.options).toEqual(['ledge', 'openrig']);
    expect(DEFAULT_TEAMS_ENGINE).toBe('ledge');
  });
  it('the three messages parse', () => {
    expect(parseServerMessage({ type: 'teams.engine', engine: 'openrig', openrigAvailable: true, running: false }).type).toBe('teams.engine');
    expect(parseClientMessage({ type: 'teams.engine.set', rid: 'a', engine: 'ledge' }).type).toBe('teams.engine.set');
    expect(parseServerMessage({ type: 'teams.engine.result', rid: 'a', ok: false, reason: 'x' }).type).toBe('teams.engine.result');
  });
  it('refuses an unknown engine', () => {
    expect(() => parseClientMessage({ type: 'teams.engine.set', rid: 'a', engine: 'x' })).toThrow();
  });
  it('a Rig takes an optional engine', () => {
    expect(RigSchema.safeParse({ ...rig, engine: 'ledge' }).success).toBe(true);
    expect(RigSchema.parse(rig)).toEqual(rig);
    expect(RigSchema.safeParse({ ...rig, engine: 'x' }).success).toBe(false);
  });
});
