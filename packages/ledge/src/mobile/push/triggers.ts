import { pendingKey, type ChatErrorCode, type PushPayload, type Session } from '@ledge/protocol';

const TAG_MAX = 32;
const TITLE_MAX = 80;
const BODY_MAX = 120;
/** Codex's stock request text says nothing: the notification shows the command instead. */
const GENERIC_REASONS = new Set(['Allow the requested shell command?']);

/** The push service validates the topic as url-base64: anything else would make every send fail. */
export const safeTag = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, TAG_MAX);

/** At most `n` UTF-16 units (the schema counts those), cut between characters, never inside a surrogate pair. */
export function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > n - 1) break;
    out += ch;
  }
  return `${out}…`;
}

function requestBody(s: Session): string {
  const p = s.pending!;
  const text = p.text.trim();
  if (GENERIC_REASONS.has(text) && p.body?.trim()) return p.body.trim();
  return text;
}

/**
 * What the phone should be told about this change of a session, or nothing: a new request or question, or a turn that
 * just ended. Pure; the one-minute spacing of `finished` is the notifier's.
 */
export function pushFor(before: Session | undefined, after: Session, all: readonly Session[]): PushPayload | null {
  const badge = Math.min(999, all.filter(s => s.pending).length);
  const tag = safeTag(after.id);
  const p = after.pending;
  if (p && (!before?.pending || pendingKey(p) !== pendingKey(before.pending))) {
    const url = `/#/request/${encodeURIComponent(after.id)}/${encodeURIComponent(pendingKey(p))}`;
    if (p.kind === 'question') return { v: 1, kind: 'question', title: cut(`${after.name} a une question`, TITLE_MAX), body: cut(p.text.trim(), BODY_MAX), url, badge, tag };
    return { v: 1, kind: 'request', title: cut(`${after.name} attend votre accord`, TITLE_MAX), body: cut(requestBody(after), BODY_MAX), url, badge, tag };
  }
  if (before?.state === 'working' && after.state === 'idle' && !p) {
    return { v: 1, kind: 'finished', title: cut(`${after.name} a terminé`, TITLE_MAX), body: cut((after.lastReply?.text ?? '').trim(), BODY_MAX), url: `/#/thread/${encodeURIComponent(after.id)}`, badge, tag };
  }
  return null;
}

/** The phone's own words for a question that ended without an answer (a copy of apps/mobile/src/copy.ts: the daemon never imports the phone). */
const CHAT_ERROR_BODY: Record<ChatErrorCode, string> = {
  busy: 'Ledge répond déjà à d\'autres questions. Réessayez dans un instant.',
  timeout: 'Ledge n\'a pas répondu à temps.',
  failed: 'Ledge n\'a pas pu répondre.',
  cancelled: 'Question arrêtée.'
};

/** The end of a device's question: never the text of the answer, only the code's own sentence on an error. */
export function chatEndPayload(code: ChatErrorCode | undefined, badge: number): PushPayload {
  return {
    v: 1, kind: 'chat', title: 'Ledge a répondu', body: code ? CHAT_ERROR_BODY[code] : 'Touchez pour lire la réponse.',
    url: '/#/chat', badge: Math.max(0, Math.min(999, badge)), tag: 'chat'
  };
}
