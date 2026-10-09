import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/tmux.js';

/** Kill a throwaway tmux server and remove its socket file (tmux leaves it behind). */
export async function killTestServer(socket: string): Promise<void> {
  await run(['-L', socket, 'kill-server']);
  rmSync(testSocketPath(socket), { force: true });
}

export function testSocketPath(socket: string): string {
  return join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid!()}`, socket);
}

export async function until(pred: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}
