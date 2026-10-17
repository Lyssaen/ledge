/** Desktop's copy lives one language per file (fr.ts, the source of truth, and en.ts), each in a chunk of its own: the
 *  main bundle carries neither. The entry point loads the chosen language and French before the first render. */
export type Messages = typeof import('./fr').fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];

const loaded: Partial<Record<Lang, Messages>> = {};
const pending: Partial<Record<Lang, Promise<Messages>>> = {};
const fetchers: Record<Lang, () => Promise<Messages>> = {
  fr: () => import('./fr').then(m => m.fr),
  en: () => import('./en').then(m => m.en)
};

/** Fetches a language's strings once and keeps them (a failed fetch is forgotten, so the next call tries again). */
export function loadMessages(lang: Lang): Promise<Messages> {
  const ready = loaded[lang];
  if (ready) return Promise.resolve(ready);
  return (pending[lang] ??= fetchers[lang]().then(
    m => (loaded[lang] = m),
    (e: unknown) => { delete pending[lang]; throw e; }
  ));
}

/** A language's strings once loadMessages has fetched them, else undefined. */
export function messagesLoaded(lang: Lang): Messages | undefined {
  return loaded[lang];
}

/** What createI18n reads, always after the entry point's loads: a language not fetched yet stands in as French, the fallback
 *  loaded at start-up (so a missing load never blanks the window). Switching language (lot 10's Settings) must therefore
 *  `await loadMessages(lang)` before it takes effect, otherwise French is served under the new language's name. */
const table = (lang: Lang): Messages => {
  const m = loaded[lang] ?? loaded.fr;
  if (!m) throw new Error(`desktop: no strings loaded for « ${lang} » nor French; await loadMessages before rendering`);
  return m;
};
export const MESSAGES: Record<Lang, Messages> = { get fr() { return table('fr'); }, get en() { return table('en'); } };
