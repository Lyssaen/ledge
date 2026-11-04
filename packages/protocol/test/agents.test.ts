import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage, DaemonInfoSchema } from '../src/index.js';

// Agents on demand (spec 2026-11-03 §4.2.6): Desktop asks the native Windows daemon which agents are installed, and has it
// install one with its official installer.
describe('agents messages', () => {
  it('the client asks the status and an install', () => {
    expect(parseClientMessage({ type: 'agents.status', requestId: 'a1' })).toEqual({ type: 'agents.status', requestId: 'a1' });
    expect(parseClientMessage({ type: 'agents.install', requestId: 'a2', tool: 'codex' })).toEqual({ type: 'agents.install', requestId: 'a2', tool: 'codex' });
    expect(() => parseClientMessage({ type: 'agents.install', requestId: 'a3', tool: 'cursor' })).toThrow();
  });
  it('the daemon answers a listing and an install result', () => {
    expect(parseServerMessage({ type: 'agents.listing', requestId: 'a1', agents: [{ tool: 'claude', found: true, path: 'C:\\c.exe', version: '2.1.302 (Claude Code)' }, { tool: 'codex', found: false }] }).type).toBe('agents.listing');
    expect(parseServerMessage({ type: 'agents.installed', requestId: 'a2', tool: 'codex', ok: false, code: 1, output: 'blocked', error: 'failed' }).type).toBe('agents.installed');
    expect(() => parseServerMessage({ type: 'agents.installed', requestId: 'a2', tool: 'codex', ok: false, error: 'whatever' })).toThrow();
  });
  it('a listing says which install is running', () => {
    expect(parseServerMessage({ type: 'agents.listing', requestId: 'a1', agents: [], installing: 'codex' })).toMatchObject({ installing: 'codex' });
  });
  it('the daemon says it offers it', () => {
    expect(DaemonInfoSchema.parse({ version: '1', install: 'npm', systemd: false, agents: true }).agents).toBe(true);
  });
});
