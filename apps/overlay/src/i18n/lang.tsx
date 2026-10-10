import { createContext, useContext, type ReactNode } from 'react';
import { LANGS, MESSAGES, type Lang, type Messages } from './messages';

const KEY = 'ledge.lang';
/** The language when nothing is stored: French. Tests switch it to English once (`setFallbackLang`) so the existing
 *  English assertions keep reading the same copy; French specs set `ledge.lang` or pass `lang` to the provider. */
let fallback: Lang = 'fr';
export function setFallbackLang(l: Lang): void { fallback = l; }

/** The persisted language; the fallback (French) when absent, invalid, or when storage is unavailable. */
export function loadLang(): Lang {
  try { const v = localStorage.getItem(KEY); return (LANGS as readonly string[]).includes(v ?? '') ? (v as Lang) : fallback; } catch { return fallback; }
}
export function saveLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* storage unavailable: the in-memory value still applies */ }
}

const LangContext = createContext<Lang | null>(null);
export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}
/** The current language and its messages. Outside a provider (a component rendered alone) the stored language. */
export function useI18n(): { lang: Lang; t: Messages } {
  const lang = useContext(LangContext) ?? loadLang();
  return { lang, t: MESSAGES[lang] };
}
export const messagesFor = (l: Lang = loadLang()): Messages => MESSAGES[l];
export type { Lang, Messages };
