#!/usr/bin/env node
const USAGE = `ledge <claude|codex|cursor> [--name <bot>] [-- agent args]   start an agent in a tracked session
ledge attach <id>                                            put this terminal on a running session
ledge daemon                                                 run the daemon in the foreground
ledge hook [codex] <Event>                                   receive a hook (reads JSON on stdin)
ledge setup                                                  install hooks and ~/.ledge
ledge status                                                 list sessions`;

/** A hook must never fail the agent: everything is caught, the exit code is always 0. */
async function hookMain(args: string[]): Promise<void> {
  try {
    // `ledge hook <Event>` is Claude Code's; another agent names itself first: `ledge hook codex <Event>`.
    const tool = args[0] === 'codex' ? 'codex' : undefined;
    const event = (tool ? args[1] : args[0]) ?? '';
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const { runHook } = await import('./hook.js');
    await runHook(event, Buffer.concat(chunks).toString('utf8'), { tool });
  } catch { /* swallowed on purpose */ }
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'daemon': { const { startDaemon } = await import('../daemon/index.js'); await startDaemon(); await new Promise(() => {}); return 0; }
    case 'setup': { const { runSetup } = await import('./setup.js'); for (const l of await runSetup()) console.log(l); return 0; }
    case 'status': { const { printStatus } = await import('./status.js'); console.log(await printStatus()); return 0; }
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
