import { createContext, useContext, type ReactNode } from 'react';
import { UiCopyProvider, setDefaultUiCopy, type UiCopy } from './copy';
export { UiCopyProvider, useUiCopy, type UiCopy } from './copy';

/** The language mechanism, generic over an app's message table: the island and Desktop share it, not their copy (spec §4.1). */
export function createI18n<L extends string, M>(opts: { langs: readonly L[]; messages: Record<L, M>; fallback: L; prefix: string; uiCopy: (m: M) => UiCopy }) {
  const KEY = `${opts.prefix}.lang`;
  let fallback = opts.fallback;
  const loadLang = (): L => { try { const v = localStorage.getItem(KEY); return (opts.langs as readonly string[]).includes(v ?? '') ? (v as L) : fallback; } catch { return fallback; } };
  const saveLang = (l: L): void => { try { localStorage.setItem(KEY, l); } catch { /* storage unavailable: the in-memory value still applies */ } };
  const messagesFor = (l: L = loadLang()): M => opts.messages[l];
  const LangContext = createContext<L | null>(null);
  function LangProvider({ lang, children }: { lang: L; children: ReactNode }) {
    return <LangContext.Provider value={lang}><UiCopyProvider copy={opts.uiCopy(opts.messages[lang])}>{children}</UiCopyProvider></LangContext.Provider>;
  }
  const useI18n = (): { lang: L; t: M } => { const lang = useContext(LangContext) ?? loadLang(); return { lang, t: opts.messages[lang] }; };
  setDefaultUiCopy(() => opts.uiCopy(messagesFor()));
  return { loadLang, saveLang, setFallbackLang: (l: L) => { fallback = l; }, LangProvider, useI18n, messagesFor };
}
