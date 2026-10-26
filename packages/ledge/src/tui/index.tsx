import { render } from 'ink';
import { attachClient } from '@ledge/fleet';
import { App } from './App.js';
import { createTuiFleet } from './fleet.js';
import { glyphsFor } from './glyphs.js';
import { MESSAGES } from './i18n/lang.js';
import { NOTIFY_MODES, type NotifyMode } from './notify.js';
import { defaultLang, loadSettings, saveSettings } from './settings.js';
import { movesToLedgeTab, openTuiInLedgeTab } from './terminalProfile.js';

export const TUI_USAGE = 'ledge tui [--notify bell|osc9|off] [--here]';

/** `--notify <mode>` or `--notify=<mode>`, and `--here` (stay in this tab); null when an argument is not understood. */
export function tuiArgs(args: readonly string[]): { notify: NotifyMode; here: boolean } | null {
  let notify: NotifyMode = 'bell';
  let here = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--here') { here = true; continue; }
    const value = a.startsWith('--notify=') ? a.slice('--notify='.length) : a === '--notify' ? args[++i] : undefined;
    if (value === undefined || !NOTIFY_MODES.includes(value as NotifyMode)) return null;
    notify = value as NotifyMode;
  }
  return { notify, here };
}

/** `ledge tui`: Ledge in the terminal, on the alternate screen, until `q`. */
export async function runTui(args: readonly string[]): Promise<number> {
  const parsed = tuiArgs(args);
  if (!parsed) { console.error(`usage: ${TUI_USAGE}`); return 2; }
  const settings = loadSettings();
  const lang = settings.lang ?? defaultLang(process.env);
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error(MESSAGES[lang].cli.notTty); return 2; }
  // In Windows Terminal, the TUI moves to a tab of the Ledge profile, the one whose icon is the mascot.
  if (movesToLedgeTab(process.env, parsed.here, process.argv[1] ?? '') && await openTuiInLedgeTab(process.env, () => console.log(MESSAGES[lang].cli.loadingProfile))) {
    console.log(MESSAGES[lang].cli.movedToTab);
    return 0;
  }
  const client = createTuiFleet();
  const detach = attachClient(client);
  client.connect();
  const app = render(
    <App client={client} lang={lang} saveLang={next => saveSettings({ ...loadSettings(), lang: next })} notify={parsed.notify} glyphs={glyphsFor(process.env)} env={process.env} />,
    // Incremental: a key rewrites the lines it changed, not the whole screen erased then drawn again (the flicker).
    { alternateScreen: true, exitOnCtrlC: false, maxFps: 30, incrementalRendering: true }
  );
  // A kill leaves the terminal as Ink found it: unmounting restores the screen, the cursor and the keyboard mode.
  const stop = () => app.unmount();
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
  try { await app.waitUntilExit(); }
  finally {
    process.off('SIGTERM', stop); process.off('SIGHUP', stop);
    detach(); client.close();
    // The terminal's title back to nothing Ledge set.
    process.stdout.write('\u001b]0;\u0007');
  }
  return 0;
}
