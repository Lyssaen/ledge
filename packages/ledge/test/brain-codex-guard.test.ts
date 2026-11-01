import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkCodexGuard, checkCodexHookTrust, checkLedgeBrainHook, trustedCodexGuard } from '../src/daemon/brain/codexGuard.js';

const hook = { eventName: 'preToolUse', handlerType: 'command', command: 'ledge hook codex PreToolUse', enabled: true,
  async: false, matcher: null, trustStatus: 'trusted' };
const response = (h: unknown = hook) => ({ data: [{ errors: [], hooks: [h] }] });

describe('Codex brain hook preflight', () => {
  it('accepts only a trusted, enabled, synchronous, unfiltered Ledge PreToolUse hook', () => {
    expect(trustedCodexGuard(response())).toBe(true);
    expect(trustedCodexGuard(response({ ...hook, trustStatus: 'managed' }))).toBe(true);
    for (const change of [{ trustStatus: 'untrusted' }, { trustStatus: 'modified' }, { enabled: false }, { async: true },
      { matcher: 'Read' }, { command: 'echo ledge hook codex PreToolUse' }, { eventName: 'postToolUse' }]) {
      expect(trustedCodexGuard(response({ ...hook, ...change }))).toBe(false);
    }
    expect(trustedCodexGuard({ data: [{ errors: [{ message: 'broken' }], hooks: [hook] }] })).toBe(false);
    expect(trustedCodexGuard({ data: [] })).toBe(false);
    expect(trustedCodexGuard({})).toBe(false);
  });

  it('checks the actual app-server response and fails closed if it is absent or untrusted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ledge-codex-check-'));
    try {
      const binary = join(root, 'codex');
      writeFileSync(binary, `#!${process.execPath}\n` + String.raw`
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
  const m=JSON.parse(line);
  if(m.id===1) console.log(JSON.stringify({id:1,result:{}}));
  if(m.id===2) console.log(JSON.stringify({id:2,result:JSON.parse(process.env.FAKE_HOOK_RESPONSE)}));
});
`);
      chmodSync(binary, 0o755);
      const ledge = join(root, 'ledge');
      writeFileSync(ledge, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny'}}));\n`);
      chmodSync(ledge, 0o755);
      const env = { ...process.env, PATH: `${root}:${process.env.PATH ?? ''}`, FAKE_HOOK_RESPONSE: JSON.stringify(response()) };
      expect(await checkCodexHookTrust(root, env)).toBe(true);
      expect(await checkLedgeBrainHook(root, env)).toBe(true);
      expect(await checkCodexGuard(root, env)).toBe(true);
      writeFileSync(ledge, `#!${process.execPath}\nprocess.stdout.write('{}');\n`);
      expect(await checkCodexGuard(root, env)).toBe(false);
      writeFileSync(ledge, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny'}}));\n`);
      expect(await checkCodexGuard(root, { ...env, FAKE_HOOK_RESPONSE: JSON.stringify(response({ ...hook, trustStatus: 'untrusted' })) })).toBe(false);
      expect(await checkCodexGuard(root, { ...env, PATH: '/nonexistent' }, 250)).toBe(false);
      writeFileSync(binary, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`);
      expect(await checkCodexHookTrust(root, env, 100)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
