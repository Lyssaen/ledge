import { createContext, useContext, type ReactNode } from 'react';
import { fr } from './fr.js';
import { en } from './en.js';

export type Messages = typeof fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };

const I18nContext = createContext<{ lang: Lang; t: Messages }>({ lang: 'fr', t: fr });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <I18nContext.Provider value={{ lang, t: MESSAGES[lang] }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
