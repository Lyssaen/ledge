import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The bin (src/cli/index.ts) as tsup ships it, beside hook.js and main.js: what an agent's hook runs while npm rewrites the
// package (a dependency half written, a bundle missing). Transpiled, not bundled: the entry imports nothing at load, so
// both are the same file; the first test holds that.
const ENTRY = ts.transpileModule(readFileSync(new URL('../src/cli/index.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-entry-')); writeFileSync(join(dir, 'index.js'), ENTRY); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the entry with `args` and `input`, without the proxy variable that makes Node 22 itself warn on stderr. */
function run(args: string[], input = '{}') {
  const env = { ...process.env };
  delete env.NODE_USE_ENV_PROXY;
  return spawnSync(process.execPath, [join(dir, 'index.js'), ...args], { input, env, encoding: 'utf8', timeout: 10_000 });
}

describe('the ledge entry (bin)', () => {
  it('imports nothing when it loads: a static import would be resolved before any try', () => {
    expect(ENTRY).not.toMatch(/^\s*import\s[^(]/m);
    expect(ENTRY).not.toMatch(/^\s*export\s.*from\s/m);
    // A literal `import('./hook.js')` is bundled back into index.js by tsup, its packages hoisted to static imports (ink…).
    expect(ENTRY).not.toMatch(/import\(\s*['"`]/);
  });

  it('a hook whose modules cannot load (ERR_UNSUPPORTED_DIR_IMPORT, a missing package) exits 0 with nothing on stderr', () => {
    writeFileSync(join(dir, 'hook.js'), "import { x } from 'ledge-no-such-package/compat';\nexport const runHook = async () => x;\n");
    const r = run(['hook', 'PreToolUse']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('');
  });

  it('a hook bundle missing altogether: exit 0, nothing on stderr; Cursor still gets {}', () => {
    expect(run(['hook', 'Stop'])).toMatchObject({ status: 0, stderr: '' });
    const r = run(['hook', 'cursor', 'preToolUse']);
    expect(r).toMatchObject({ status: 0, stderr: '' });
    expect(r.stdout.trim()).toBe('{}');
  });

  it('an error thrown later from a callback exits 0 without a stack, and Cursor gets {} once', () => {
    writeFileSync(join(dir, 'hook.js'), "export const runHook = () => new Promise(() => { setTimeout(() => { throw new Error('boom'); }, 10); });\n");
    const r = run(['hook', 'cursor', 'stop']);
    expect(r).toMatchObject({ status: 0, stderr: '' });
    expect(r.stdout).toBe('{}\n');
  });

  it('passes the event, the agent and stdin to runHook, and prints what it returns', () => {
    writeFileSync(join(dir, 'hook.js'), 'export const runHook = async (ev, stdin, o) => `${ev}|${o.tool}|${stdin}`;\n');
    expect(run(['hook', 'SessionStart'], 'in').stdout).toBe('SessionStart|undefined|in\n');
    expect(run(['hook', 'codex', 'Stop'], 'x').stdout).toBe('Stop|codex|x\n');
  });

  it('every other command runs main.js with its arguments; main.js missing says so and exits 1', () => {
    writeFileSync(join(dir, 'main.js'), 'export const runCli = argv => { console.log(argv.join(" ")); process.exit(3); };\n');
    expect(run(['status', '--json'])).toMatchObject({ status: 3, stdout: 'status --json\n' });
    rmSync(join(dir, 'main.js'));
    const r = run(['status']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^ledge: /);
  });
});
