import { createI18n, type UiCopy } from '@ledge/ui/i18n/lang';
import type { ChatCopy } from '@ledge/ui/chat/copy';
import { LANGS, MESSAGES, type Lang, type Messages } from './messages';

/** Desktop's mascots speak `botLabel`, `botReadOnly`, `botNotLive` and `resident.*` of its messages. */
const uiCopy = (m: Messages): UiCopy => ({ stateLabel: m.stateLabel, botLabel: m.botLabel, botReadOnly: m.botReadOnly, botNotLive: m.botNotLive, residentName: m.resident.name, residentOffline: m.resident.offline });
const i18n = createI18n<Lang, Messages>({ langs: LANGS, messages: MESSAGES, fallback: 'fr', prefix: 'desktop', uiCopy });
/** Desktop's chat speaks `chat.*`, `machines.*`, `time.*` and `offline` of its messages, as the island's (TypeScript checks the shape here). */
export const chatCopy = (m: Messages): ChatCopy => ({ chat: m.chat, machines: m.machines, time: m.time, offline: m.offline });
export const { loadLang, saveLang, setFallbackLang, LangProvider, useI18n, messagesFor } = i18n;
export type { Lang, Messages };
