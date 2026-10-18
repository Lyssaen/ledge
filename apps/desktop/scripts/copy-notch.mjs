import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Puts the notch's build under dist/notch. `to` is emptied first, so a file the notch no longer ships does not linger
 * in the installer.
 */
export function copyNotch(from, to) {
  if (!existsSync(from)) {
    throw new Error(`the notch is not built: ${from} is missing, build apps/overlay/dist first (pnpm --filter desktop build does)`);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

/** Run directly (`node scripts/copy-notch.mjs`), it copies the overlay's dist next to Desktop's own. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copyNotch(fileURLToPath(new URL('../../overlay/dist', import.meta.url)), fileURLToPath(new URL('../dist/notch', import.meta.url)));
}
