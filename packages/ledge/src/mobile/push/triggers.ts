import { pendingKey, type ChatErrorCode, type DecidedBy, type PushPayload, type Session, type Task } from '@ledge/protocol';

const TAG_MAX = 32;
const TITLE_MAX = 80;
const BODY_MAX = 120;
const NAME_MAX = 100;
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
 * What the phone should be told about this change of a session, or nothing: a new request or question. A turn that ended
 * is no longer a push of its own: the operator's point says it. Pure.
 */
export function pushFor(before: Session | undefined, after: Session, all: readonly Session[]): PushPayload | null {
  const badge = Math.min(999, all.filter(s => s.pending).length);
  const tag = safeTag(after.id);
  const p = after.pending;
  if (p && (!before?.pending || pendingKey(p) !== pendingKey(before.pending))) {
    const url = `/#/request/${encodeURIComponent(after.id)}/${encodeURIComponent(pendingKey(p))}`;
    // Ledge speaks for every session: the title is Ledge's, the body names the session.
    if (p.kind === 'question') return { v: 1, kind: 'question', title: 'Ledge', name: cut(after.name, NAME_MAX), body: cut(`${after.name} · ${p.text.trim()}`, BODY_MAX), url, badge, tag };
    return { v: 1, kind: 'request', title: 'Ledge', name: cut(after.name, NAME_MAX), body: cut(`${after.name} · ${requestBody(after)}`, BODY_MAX), url, badge, tag };
  }
  return null;
}

/**
 * A request or question that left without another one in its place: the push that replaces its notification on the
 * devices that got it. `by` names who answered, when the daemon knows (a decision it typed); else the body says nothing.
 */
export function resolvedFor(before: Session | undefined, after: Session, all: readonly Session[], by?: DecidedBy | null): PushPayload | null {
  if (!before?.pending || after.pending) return null;
  const badge = Math.min(999, all.filter(s => s.pending).length);
  const body = !by ? '' : by.kind === 'pc' ? 'sur le PC' : cut(`sur ${by.name}`, BODY_MAX);
  return { v: 1, kind: 'resolved', title: cut(`${after.name} · traitée`, TITLE_MAX), name: cut(after.name, NAME_MAX), body, url: `/#/thread/${encodeURIComponent(after.id)}`, badge, tag: safeTag(after.id) };
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

/** A decision a session just put to the user (`ledge task give ledge …`): it opens Ledge's chat, where « À toi » lists it. */
export function decisionPayload(t: Task, badge: number): PushPayload {
  return {
    v: 1, kind: 'decision', title: cut(`${t.giverName} attend votre décision`, TITLE_MAX), name: cut(t.giverName, NAME_MAX), body: cut(t.title.trim(), BODY_MAX),
    url: '/#/chat', badge: Math.max(0, Math.min(999, badge)), tag: safeTag(t.id)
  };
}
