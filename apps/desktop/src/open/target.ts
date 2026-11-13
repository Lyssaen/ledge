import type { NavAction } from '../nav/state';

/** What the island asks Ledge Desktop to show (« Open in Ledge »): the island's `LedgeTarget`, as JSON on `--open`. */
export type LedgeTarget =
  | { kind: 'session'; id: string } | { kind: 'terminal'; id: string } | { kind: 'document'; path: string }
  | { kind: 'settings' } | { kind: 'launch' } | { kind: 'update' } | { kind: 'machines' }
  /** The operator's point (« Voir le point »): the chat panel, where the point is a turn. */
  | { kind: 'point'; qid: string }
  /** A rig's question in « À toi », by its OpenRig queue item; the shell focuses it there. */
  | { kind: 'ask'; id: string }
  /** « À toi » itself (a decision put to the user, from the notch). */
  | { kind: 'atoi' };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096;

/** The island's target, or null for anything else. */
export function parseTarget(raw: string): LedgeTarget | null {
  let v: unknown; try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case 'session': case 'terminal': return str(o.id) ? { kind: o.kind, id: o.id } : null;
    case 'document': return str(o.path) ? { kind: 'document', path: o.path } : null;
    case 'settings': case 'launch': case 'update': case 'machines': return { kind: o.kind };
    case 'point': return str(o.qid) ? { kind: 'point', qid: o.qid } : null;
    case 'ask': return str(o.id) ? { kind: 'ask', id: o.id } : null;
    case 'atoi': return { kind: 'atoi' };
    default: return null;
  }
}

/** Where a target takes Desktop: a session (its terminal and documents live on its page), a Settings section, the New
 *  session dialog. The island's gear opens « Settings in Ledge Desktop », its own section first. */
export function targetAction(t: Exclude<LedgeTarget, { kind: 'ask' | 'atoi' }>): NavAction {
  switch (t.kind) {
    case 'session': case 'terminal': return { type: 'open', id: t.id };
    case 'document': return { type: 'home' };
    case 'settings': return { type: 'settings', section: 'island' };
    case 'machines': return { type: 'settings', section: 'machines' };
    case 'update': return { type: 'settings', section: 'about' };
    case 'launch': return { type: 'modal', modal: { kind: 'launch' } };
    case 'point': return { type: 'chat', open: true };
  }
}
