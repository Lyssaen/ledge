// The notifications' words, written by the phone in its own language (Q29, QUESTIONS.md « Q29 et M5 §9 », design-ux 06057f63):
// the PC sends what happened (`kind`) and who it is about (`name`), the phone writes the title, in « tu ». Kept apart from
// copy.ts: the pinned service worker imports it, and must stay small.
import type { PushPayload } from '@ledge/protocol';

export type NotifyLang = 'fr' | 'en';

type Titles = Record<Exclude<PushPayload['kind'], 'chat'>, (name: string) => string> & { chat: string };

export const NOTIFY: Record<NotifyLang, { title: Titles; fallbackTitle: string; fallbackBody: string; chatTap: string }> = {
  fr: {
    title: {
      request: (name) => `${name} attend ton accord`,
      question: (name) => `${name} a une question`,
      finished: (name) => `${name} a terminé`,
      resolved: (name) => `${name} · traitée`,
      decision: (name) => `${name} attend ta décision`,
      point: (name) => `${name} te fait un point`,
      chat: 'Ledge a répondu'
    },
    fallbackTitle: 'Ledge',
    fallbackBody: 'Une demande attend',
    chatTap: 'Touche pour lire la réponse.'
  },
  en: {
    title: {
      request: (name) => `${name} needs your approval`,
      question: (name) => `${name} has a question`,
      finished: (name) => `${name} has finished`,
      resolved: (name) => `${name} · handled`,
      decision: (name) => `${name} needs your decision`,
      point: (name) => `${name} has a point for you`,
      chat: 'Ledge has answered'
    },
    fallbackTitle: 'Ledge',
    fallbackBody: 'A request is waiting',
    chatTap: 'Tap to read the answer.'
  }
};

/** The fixed body the PC gives a chat answer (packages/ledge/src/mobile/push/triggers.ts): the phone says it in its words. */
export const PC_CHAT_TAP = 'Touchez pour lire la réponse.';

/** A language the worker was told, or French when it was told none it knows. */
export const notifyLang = (v: unknown): NotifyLang => (v === 'en' ? 'en' : 'fr');

/**
 * A push's title and body in `lang`: the phone's title from `kind` and `name`; without `name` (an older PC), the PC's title as
 * is. The body stays the PC's, except the chat's fixed one.
 */
export function notifyText(p: Pick<PushPayload, 'kind' | 'name' | 'title' | 'body'>, lang: NotifyLang): { title: string; body: string } {
  const t = NOTIFY[lang];
  const title = p.kind === 'chat' ? t.title.chat : p.name ? t.title[p.kind](p.name) : p.title;
  const body = p.kind === 'chat' && p.body === PC_CHAT_TAP ? t.chatTap : p.body;
  return { title, body };
}
