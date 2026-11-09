#!/usr/bin/env node
/**
 * The `ledge` command's entry. It imports nothing when it loads: an ES module's static imports are all resolved before
 * its first line runs, so a package missing or half written (npm reinstalling Ledge while agents run) would fail the
 * process before any try could catch it, and every hook would print Node's error. The hook (`hook.js`) and the rest of
 * the CLI (`main.js`) are separate bundles beside this file, loaded on demand by their URL (a literal path would be
 * bundled back into this one).
 */
import type { runHook as RunHook } from './hook.js';
import type { runCli as RunCli } from './main.js';

/** A module beside this one: `hook.js` once built, `hook.ts` when tsx runs the sources. */
const sibling = (name: string): string => new URL(`./${name}${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url).href;

/**
 * A hook must never fail the agent: everything is caught (loading the hook's modules included), nothing goes to stderr,
 * the exit code is always 0. Cursor Agent reads a JSON answer on stdout: `{}` lets the agent go on as it would have.
 */
async function hookMain(args: string[]): Promise<void> {
  // `ledge hook <Event>` is Claude Code's; another agent names itself first: `ledge hook codex <Event>`.
  const tool = args[0] === 'codex' || args[0] === 'cursor' ? args[0] : undefined;
  const event = (tool ? args[1] : args[0]) ?? '';
  let answered = false;
  const done = (): never => {
    if (tool === 'cursor' && !answered) { answered = true; process.stdout.write('{}\n'); }
    process.exit(0);
  };
  // An error thrown later from a callback (a socket with no listener) would otherwise print a stack and exit 1.
  process.on('uncaughtException', done);
  process.on('unhandledRejection', done);
  try {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const { runHook } = await import(sibling('hook')) as { runHook: typeof RunHook };
    const out = await runHook(event, Buffer.concat(chunks).toString('utf8'), { tool });
    // SessionStart: the identity Claude Code and Codex add to the agent's context.
    if (out) process.stdout.write(`${out}\n`);
  } catch { /* swallowed on purpose */ }
  done();
}

if (process.argv[2] === 'hook') {
  void hookMain(process.argv.slice(3));
} else {
  import(sibling('main')).then(
    (m: { runCli: typeof RunCli }) => m.runCli(process.argv.slice(2)),
    (e: unknown) => { console.error(`ledge: ${(e as Error).message}`); process.exit(1); }
  );
}
