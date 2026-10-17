import type { Lang } from './messages';

/** Shown when no strings table loads at all: it needs none, so it speaks both languages. */
export const BOOT_FAILURE: readonly string[] = [
  'Ledge Desktop n’a pas pu charger ses textes. Relancez l’application.',
  'Ledge Desktop could not load its text. Restart the app.'
];

export type Boot = { ok: true; lang: Lang } | { ok: false };

/** Loads a language, trying once more after a failure (loadMessages forgets failures); each failure is logged. */
async function attempt(load: (l: Lang) => Promise<unknown>, lang: Lang, log: (...a: unknown[]) => void): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try { await load(lang); return true; } catch (e) { log(`desktop: the « ${lang} » strings did not load`, e); }
  }
  return false;
}

/** Loads the chosen language and French (the fallback) before the first render and says which one to render in: the chosen
 *  one if it loaded, else French, else nothing (the entry point then shows BOOT_FAILURE). */
export async function bootLanguages(load: (l: Lang) => Promise<unknown>, chosen: Lang, log: (...a: unknown[]) => void = console.error): Promise<Boot> {
  const [mine, fr] = await Promise.all([attempt(load, chosen, log), chosen === 'fr' ? null : attempt(load, 'fr', log)]);
  if (mine) return { ok: true, lang: chosen };
  if (fr) return { ok: true, lang: 'fr' };
  return { ok: false };
}
