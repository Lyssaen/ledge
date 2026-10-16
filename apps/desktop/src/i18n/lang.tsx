import { createI18n, type UiCopy } from '@ledge/ui/i18n/lang';
import { LANGS, MESSAGES, type Lang, type Messages } from './messages';

/** Desktop's mascots speak `botLabel`, `botReadOnly`, `botNotLive` and `resident.*` of its messages. */
const uiCopy = (m: Messages): UiCopy => ({ botLabel: m.botLabel, botReadOnly: m.botReadOnly, botNotLive: m.botNotLive, residentName: m.resident.name, residentOffline: m.resident.offline });
const i18n = createI18n<Lang, Messages>({ langs: LANGS, messages: MESSAGES, fallback: 'fr', prefix: 'desktop', uiCopy });
export const { loadLang, saveLang, setFallbackLang, LangProvider, useI18n, messagesFor } = i18n;
export type { Lang, Messages };
