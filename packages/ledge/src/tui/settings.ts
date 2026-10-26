import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ledgeDir } from '../paths.js';
import type { Lang } from './i18n/lang.js';

/** `ledge tui`'s own settings, in `~/.ledge/tui.json`. Keys it does not know are kept (a newer `ledge` may have written them). */
const SettingsSchema = z.object({ lang: z.enum(['fr', 'en']).optional(), theme: z.enum(['auto', 'dark', 'light']).optional() }).passthrough();
export type Settings = z.infer<typeof SettingsSchema>;

export const settingsPath = (): string => join(ledgeDir(), 'tui.json');

/** French when the locale says so (`LC_ALL`, then `LC_MESSAGES`, then `LANG`, as gettext reads them), English otherwise. */
export function defaultLang(env: NodeJS.ProcessEnv): Lang {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  return /^fr/i.test(locale) ? 'fr' : 'en';
}

/** The saved settings; a missing, unreadable or broken file is no settings. */
export function loadSettings(): Settings {
  try { return SettingsSchema.parse(JSON.parse(readFileSync(settingsPath(), 'utf8'))); } catch { return {}; }
}

/** Writes the settings whole, through a temporary file so a crash never leaves half a file. Throws on failure. */
export function saveSettings(settings: Settings): void {
  const path = settingsPath(), tmp = `${path}.${process.pid}.tmp`;
  mkdirSync(ledgeDir(), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}
