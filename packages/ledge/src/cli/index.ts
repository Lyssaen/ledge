#!/usr/bin/env node
const USAGE = `ledge <claude|codex|cursor> [--name <bot>] [-- agent args]   start an agent in a tracked session
ledge attach <id>                                            put this terminal on a running session
ledge daemon                                                 run the daemon in the foreground
ledge hook [codex|cursor] <Event>                            receive a hook (reads JSON on stdin)
ledge setup                                                  install hooks and ~/.ledge
ledge uninstall [--purge]                                    remove hooks, service and link (--purge: ~/.ledge too)
ledge status                                                 list sessions
ledge bridge                                                 exchange Ledge messages over SSH stdio
ledge --version                                              print the installed version`;

/**
 * A hook must never fail the agent: everything is caught, the exit code is always 0. Cursor Agent reads a JSON
 * answer on stdout: `{}` lets the agent go on as it would have.
 */
async function hookMain(args: string[]): Promise<void> {
  // `ledge hook <Event>` is Claude Code's; another agent names itself first: `ledge hook codex <Event>`.
  const tool = args[0] === 'codex' || args[0] === 'cursor' ? args[0] : undefined;
  const event = (tool ? args[1] : args[0]) ?? '';
  try {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const { runHook } = await import('./hook.js');
    await runHook(event, Buffer.concat(chunks).toString('utf8'), { tool });
  } catch { /* swallowed on purpose */ }
  if (tool === 'cursor') process.stdout.write('{}\n');
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'daemon': { const { startDaemon } = await import('../daemon/index.js'); await startDaemon(); await new Promise(() => {}); return 0; }
    case '--version': case 'version': { const { LEDGE_VERSION } = await import('../version.js'); console.log(LEDGE_VERSION); return 0; }
    case 'setup': { const { runSetup } = await import('./setup.js'); for (const l of await runSetup()) console.log(l); return 0; }
    case 'uninstall': { const { runUninstall } = await import('./uninstall.js'); const r = await runUninstall({ purge: rest.includes('--purge') }); for (const l of r.lines) console.log(l); return r.ok ? 0 : 1; }
    case 'status': { const { printStatus } = await import('./status.js'); console.log(await printStatus()); return 0; }
    case 'bridge': { const { bridge } = await import('./bridge.js'); await bridge(); return 0; }
    case 'claude': case 'codex': case 'cursor': { const { launch } = await import('./launch.js'); return launch(cmd, rest); }
    case 'attach': { const { attach } = await import('./attach.js'); return attach(rest[0] ?? ''); }
    default: console.log(USAGE); return cmd ? 1 : 0;
  }
}

if (process.argv[2] === 'hook') {
  hookMain(process.argv.slice(3)).then(() => process.exit(0), () => process.exit(0));
} else {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(`ledge: ${(e as Error).message}`); process.exit(1); });
}
