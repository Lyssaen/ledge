const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Re-read the pane up to `attempts` times, `intervalMs` apart; true once the prompt is gone. */
export async function verifyGone(
  capture: () => Promise<string>,
  stillVisible: (pane: string) => boolean,
  opts: { attempts?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const attempts = opts.attempts ?? 3;
  const interval = opts.intervalMs ?? 200;
  for (let i = 0; i < attempts; i++) {
    await sleep(interval);
    if (!stillVisible(await capture())) return true;
  }
  return false;
}
