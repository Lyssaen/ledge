import type { Session } from '@ledge/protocol';
import { createI18n, type UiCopy } from '../src/i18n/lang';

/** Importing this file registers an English-by-default i18n, as the island's `setFallbackLang('en')` test setup does:
 *  a mascot outside any provider reads the stored language, else English. */
const en: UiCopy = {
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only', botNotLive: 'Not live', residentName: 'Ledge', residentOffline: 'Ledge · connection lost'
};
const fr: UiCopy = {
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' },
  botReadOnly: 'Lecture seule', botNotLive: 'Figé', residentName: 'Ledge', residentOffline: 'Ledge · connexion perdue'
};
export const testI18n = createI18n({ langs: ['fr', 'en'] as const, messages: { fr, en }, fallback: 'en', prefix: 'ledge', uiCopy: m => m });

export const T0 = '2026-10-09T18:00:00.000Z';
export function fakeSession(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}
