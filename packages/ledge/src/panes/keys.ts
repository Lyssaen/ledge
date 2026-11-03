/** The bytes a terminal sends for each tmux key name the adapters use (`send-keys` without `-l`). */
const NAMED: Record<string, string> = {
  Enter: '\r', Escape: '\x1b', Tab: '\t', BTab: '\x1b[Z', BSpace: '\x7f', Space: ' ',
  Up: '\x1b[A', Down: '\x1b[B', Right: '\x1b[C', Left: '\x1b[D',
};

/** A tmux key name to its bytes: the named keys, `C-<letter>` as its control byte, a single character as itself. */
export function keyBytes(key: string): string {
  const named = NAMED[key];
  if (named !== undefined) return named;
  const ctrl = /^C-([a-z])$/.exec(key);
  if (ctrl) return String.fromCharCode(ctrl[1]!.charCodeAt(0) - 96);
  if ([...key].length === 1) return key;
  throw new Error(`unknown key: ${key}`);
}
