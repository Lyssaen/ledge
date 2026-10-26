#!/usr/bin/env node
const USAGE = `ledge <claude|codex|cursor> [--name <bot>] [--role <id>] [-- agent args]   start an agent in a tracked session (--role: .ledge/roles/<id>.md)
ledge attach [--read-only] <id>                              put this terminal on a running session
ledge daemon                                                 run the daemon in the foreground
ledge hook [codex|cursor] <Event>                            receive a hook (reads JSON on stdin)
ledge setup                                                  install hooks and ~/.ledge
ledge uninstall [--purge]                                    remove hooks, service and link (--purge: ~/.ledge too)
ledge status                                                 list sessions
ledge who                                                    list the live sessions (name, tool, state, project, branch, topic)
ledge send <nom> "<message>" [--summary <texte>]             write to another Ledge session
ledge read <id>                                              print a long message whole (the id is in its pointer)
ledge task <give|list|show|take|done|refuse|pass> …         give another session work, take it, close it (ledge task: details)
ledge decide [<id> "<réponse>"]                               the decisions sessions wait for from you; answer one
ledge handover "<bilan>" | show                              the relief brief, when Ledge asks for it; show: read your predecessor's
ledge team <up|list|join|leave|resume|dissolve|save> …       start, list and run teams (ledge team: details; --json for agents)
ledge close <session>… [--json]                              close sessions cleanly (their conversation stays resumable)
ledge tui [--notify bell|osc9|off] [--here]                  follow and answer the sessions (in a Ledge tab of Windows Terminal unless --here)
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
    const out = await runHook(event, Buffer.concat(chunks).toString('utf8'), { tool });
    // SessionStart: the identity Claude Code and Codex add to the agent's context.
    if (out) process.stdout.write(`${out}\n`);
  } catch { /* swallowed on purpose */ }
  if (tool === 'cursor') process.stdout.write('{}\n');
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'daemon': { const { startDaemon } = await import('../daemon/index.js'); await startDaemon(); await new Promise(() => {}); return 0; }
    case '--version': case 'version': { const { LEDGE_VERSION } = await import('../version.js'); console.log(LEDGE_VERSION); return 0; }
    case 'setup': { const { runSetup } = await import('./setup.js'); for (const l of await runSetup()) console.log(l); return 0; }
    case 'uninstall': {
      const { runUninstall, uninstallArgs } = await import('./uninstall.js');
      const args = uninstallArgs(rest);
      if (!args) { console.log(USAGE); return rest.every(a => a === '--help' || a === '-h') ? 0 : 1; }
      const r = await runUninstall(args); for (const l of r.lines) console.log(l); return r.ok ? 0 : 1;
    }
    case 'status': { const { printStatus } = await import('./status.js'); console.log(await printStatus()); return 0; }
    case 'who': { const { printWho } = await import('./who.js'); console.log(await printWho()); return 0; }
    case 'send': { const { sendMessage } = await import('./send.js'); const r = await sendMessage(rest); console.log(r.line); return r.code; }
    case 'read': { const { readMessage } = await import('./send.js'); const r = await readMessage(rest); console.log(r.line); return r.code; }
    case 'task': { const { runTask } = await import('./task.js'); const r = await runTask(rest); console.log(r.line); return r.code; }
    case 'decide': { const { runDecide } = await import('./decide.js'); const r = await runDecide(rest); console.log(r.line); return r.code; }
    case 'handover': { const { runHandover } = await import('./handover.js'); const r = await runHandover(rest); console.log(r.line); return r.code; }
    case 'close': { const { runClose } = await import('./action.js'); const r = await runClose(rest); console.log(r.line); return r.code; }
    case 'team': { const { runTeam } = await import('./team.js'); const r = await runTeam(rest); console.log(r.line); return r.code; }
    case 'tui': { const { runTui } = await import('../tui/index.js'); return runTui(rest); }
    case 'bridge': { const { bridge } = await import('./bridge.js'); await bridge(); return 0; }
    case 'claude': case 'codex': case 'cursor': { const { launch } = await import('./launch.js'); return launch(cmd, rest); }
    case 'attach': { const { attach } = await import('./attach.js'); return attach(rest.find(a => !a.startsWith('--')) ?? '', { readOnly: rest.includes('--read-only') }); }
    default: console.log(USAGE); return cmd ? 1 : 0;
  }
}

if (process.argv[2] === 'hook') {
  hookMain(process.argv.slice(3)).then(() => process.exit(0), () => process.exit(0));
} else {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(`ledge: ${(e as Error).message}`); process.exit(1); });
}
