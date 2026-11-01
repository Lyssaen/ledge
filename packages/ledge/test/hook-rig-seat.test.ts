import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook } from '../src/cli/hook.js';
import { rigSeatContext } from '../src/daemon/openrig/seatContext.js';

const START = JSON.stringify({ session_id: 'agent-1', cwd: '/w' });
const VARS = ['LEDGE_HOME', 'LEDGE_SESSION', 'LEDGE_CHAT', 'OPENRIG_SESSION_NAME', 'OPENRIG_NODE_ID'] as const;
let saved: Record<string, string | undefined>; let home: string;
beforeEach(() => {
  saved = Object.fromEntries(VARS.map(k => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  home = mkdtempSync(join(tmpdir(), 'ledge-seat-')); process.env.LEDGE_HOME = home;
});
afterEach(() => { for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

// port 1: nothing listens, so the hook never reaches a real daemon; the context does not depend on it.
const start = async (env: Record<string, string>): Promise<string | undefined> => {
  Object.assign(process.env, env);
  return runHook('SessionStart', START, { port: 1, timeoutMs: 100 });
};
const context = (out: string | undefined): string => JSON.parse(out!).hookSpecificOutput.additionalContext as string;

describe('rigSeatContext', () => {
  it('names the seat, the human, the escalation route and the mandate', () => {
    const c = rigSeatContext({ seat: 'a@r', rig: 'r', human: 'ledge@external', mandate: 'M.' });
    expect(c).toContain('Tu es a@r, siège du rig r.');
    expect(c).toContain('Ton humain est Ledge (ledge@external)');
    expect(c).toContain('`rig queue create --destination ledge@external --human-intent decision …`');
    expect(c).toContain('--human-intent update');
    expect(c).toContain('connecteur Slack non configuré est intentionnel');
    expect(c.endsWith('M.')).toBe(true);
  });
});

describe('hook: OpenRig seat at SessionStart', () => {
  it('tells the seat its human, how to escalate and the mandate', async () => {
    const ctx = context(await start({ OPENRIG_SESSION_NAME: 'dev-build@starter', OPENRIG_NODE_ID: 'n1' }));
    expect(ctx).toContain('Tu es dev-build@starter, siège du rig starter.');
    expect(ctx).toContain('ledge@external');
    expect(ctx).toContain('messaging-the-human');
    expect(ctx).toMatch(/design, architecture, critique/);
    expect(ctx).not.toMatch(/ledge task|ledge send/);
  });
  it('a session launched by Ledge keeps its identity context, not the seat one', async () => {
    const out = await start({ OPENRIG_SESSION_NAME: 'dev-build@starter', LEDGE_SESSION: 'abcd' });
    // no daemon answers, so no identity is found: nothing is printed, and above all no seat context
    expect(out === undefined || !context(out).includes('siège du rig')).toBe(true);
  });
  it('says nothing outside an OpenRig seat', async () => {
    expect(await start({})).toBeUndefined();
  });
  it('reads the two lists of mandat.md', async () => {
    writeFileSync(join(home, 'mandat.md'), '# Ledge tranche seul\n- git : les branches\n# Te revient toujours\n- design : le look\n');
    const ctx = context(await start({ OPENRIG_SESSION_NAME: 'x@y' }));
    expect(ctx).toContain('Ledge tranche seul : les branches.');
    expect(ctx).toContain("à l'utilisateur : le look.");
  });
});
