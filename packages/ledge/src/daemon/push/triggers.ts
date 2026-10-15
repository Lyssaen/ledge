import type { PushPayload, Session } from '@ledge/protocol';

const TAG_MAX = 32;
/** Codex's stock reason carries no information: the notification leaves it out. */
const GENERIC_REASONS = new Set(['Allow the requested shell command?']);

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const task = (s: Session) => cut((s.topic ?? s.project).trim(), 120);

/** Why the agent asks, when it said something specific: never the command itself. */
function reason(s: Session): string | undefined {
  const r = s.pending?.reason?.trim();
  return r && !GENERIC_REASONS.has(r) ? r : undefined;
}

/**
 * What the phone should be told about this change of a session, or nothing: a new request or question, or a turn that
 * just ended. Pure. The texts are the task and the bot (and the motive of a request), never the command, the question or the reply.
 */
export function pushFor(before: Session | undefined, after: Session, all: Session[]): PushPayload | null {
  const badge = all.filter(s => s.pending?.id).length;
  const p = after.pending;
  if (p?.id && p.id !== before?.pending?.id) {
    const url = `/m/#/request/${after.id}/${p.id}`;
    const tag = `req-${p.id}`.slice(0, TAG_MAX);
    if (p.kind === 'question') return { v: 1, kind: 'question', title: cut(`${after.name} a une question`, 80), body: task(after), url, badge, tag };
    const why = reason(after);
    return { v: 1, kind: 'request', title: 'Votre accord est demandé', body: cut(`${task(after)} · ${after.name}${why ? ` · ${why}` : ''}`, 120), url, badge, tag };
  }
  if (before?.state === 'working' && after.state === 'idle' && !p) {
    return { v: 1, kind: 'finished', title: cut(`${after.name} a terminé`, 80), body: task(after), url: `/m/#/thread/${after.id}`, badge, tag: `fin-${after.id}`.slice(0, TAG_MAX) };
  }
  return null;
}
