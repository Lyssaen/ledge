import { backendOf, broadcastLabel, broadcastRecipient, isArchived, projectOf, type BroadcastAddress, type ClientMessage, type MessageAck, type Projects, type ServerMessage, type Session } from '@ledge/protocol';
import type { Store } from './store.js';
import { MAX_SEEN, sessionNamed, type Mailbox, type MailboxDeps } from './mailbox.js';

/** One refused recipient, by name, and why. */
export interface BroadcastRefusal { name: string; reason: string }
export interface Recipients { targets: Session[]; refused: BroadcastRefusal[]; reason?: string }
type Deps = { store: Pick<Store, 'get' | 'all'>; projects: Projects };

const seat = (s: Session) => !!s.rig || s.source === 'rig';
/** Why a named session cannot get a broadcast; null when it can (`broadcastRecipient`, shared with the fleet). */
function refusalOf(s: Session): string | null {
  if (broadcastRecipient(s)) return null;
  if (seat(s)) return `${s.name} est un siège OpenRig : écris-lui avec rig send`;
  if (s.source !== 'launcher' || (!s.tmuxSession && backendOf(s) !== 'omp-rpc')) return `${s.name} n'a pas été lancée par Ledge : impossible de lui écrire`;
  return `${s.name} s'est terminée : impossible de lui écrire`;
}

/** The project by its name (any case), else by its id. */
const projectNamed = (projects: Projects, q: string) =>
  projects.projects.find(p => p.name.toLowerCase() === q.toLowerCase()) ?? projects.projects.find(p => p.id === q);
/** The sessions a project's name can mean on this machine, beyond its registry: live, not archived. */
const live = (d: Deps) => d.store.all().filter(s => s.state !== 'exited' && !isArchived(s));
/** The most known names an « aucun projet » refusal lists. */
const KNOWN_MAX = 10;
/** The names `@projet:` takes here: the registry's projects, then the folders live sessions work in; each once, any case. */
function knownProjects(d: Deps): string[] {
  const seen = new Set<string>(); const names: string[] = [];
  for (const n of [...d.projects.projects.map(p => p.name), ...live(d).map(s => s.project)]) {
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase()); names.push(n);
  }
  return names.slice(0, KNOWN_MAX);
}

/**
 * Who a broadcast goes to. A project: its live Ledge sessions, the seats and read-only ones left out without a word. Names
 * or ids: each resolved as the mailbox does, one that cannot be written to refused with why; the sender (`except`) is
 * dropped silently, a session named twice counted once. `reason`: nobody at all.
 */
export function recipientsOf(a: BroadcastAddress | { sessions: string[] }, d: Deps, except?: string): Recipients & { label: string } {
  if ('project' in a) {
    const p = projectNamed(d.projects, a.project);
    // No registry project of that name: the folder the sessions work in (`Session.project`), any case, as an agent sees it.
    const folder = p ? undefined : live(d).find(s => s.project.toLowerCase() === a.project.toLowerCase())?.project;
    if (!p && !folder) {
      const known = knownProjects(d);
      return { targets: [], refused: [], reason: `aucun projet ${a.project}${known.length ? ` (connus : ${known.join(', ')})` : ''}`, label: broadcastLabel(a) };
    }
    const inIt = p ? (s: Session) => projectOf(s, d.projects) === p.id : (s: Session) => s.project.toLowerCase() === folder!.toLowerCase();
    const targets = d.store.all().filter(s => s.id !== except && broadcastRecipient(s) && inIt(s));
    const name = p?.name ?? folder!;
    const label = broadcastLabel({ project: name });
    return targets.length ? { targets, refused: [], label } : { targets, refused: [], reason: `personne d'autre dans le projet ${name}`, label };
  }
  const targets: Session[] = []; const refused: BroadcastRefusal[] = []; const seen = new Set<string>();
  for (const n of 'names' in a ? a.names : a.sessions) {
    const s = d.store.get(n) ?? sessionNamed(d.store, n);
    if (!s) { refused.push({ name: n, reason: `aucune session Ledge nommée ${n}` }); continue; }
    if (s.id === except || seen.has(s.id)) continue;
    seen.add(s.id);
    const why = refusalOf(s);
    if (why) refused.push({ name: s.name, reason: why }); else targets.push(s);
  }
  // The label names who it goes to, as the recipients know them.
  const label = broadcastLabel({ names: targets.map(t => t.name) });
  return targets.length ? { targets, refused, label } : { targets, refused, reason: 'personne à qui écrire', label };
}

type SessionMessage = Extract<ClientMessage, { type: 'session.message' }>;
type BroadcastMessage = Extract<ClientMessage, { type: 'session.broadcast' }>;
type BroadcastResult = Extract<ServerMessage, { type: 'session.broadcast.result' }>;

/**
 * A session writes to a project or a list: one mailbox message per recipient (its own rid, no card of its own), each
 * queued behind what already waits; one card in the sender's thread, of the message's rid, once at least one went.
 */
export function broadcastFromSession(d: Deps & { mailbox: Pick<Mailbox, 'submit'>; sent: Pick<MailboxDeps['sent'], 'record'>; now: () => string }, msg: SessionMessage, a: BroadcastAddress): MessageAck {
  if (!d.store.get(msg.from)) return { type: 'message.ack', rid: msg.rid, outcome: 'refused', reason: 'session émettrice inconnue' };
  const r = recipientsOf(a, d, msg.from);
  const sent: string[] = []; const refused = [...r.refused]; let accepted = false;
  for (const t of r.targets) {
    const ack = d.mailbox.submit({ type: 'session.message', rid: `${msg.rid}:${t.id}`, from: msg.from, to: t.name, text: `(à ${r.label}) ${msg.text}`, ...(msg.summary ? { summary: msg.summary } : {}) }, { card: msg.rid, target: t.id });
    if (ack.outcome === 'accepted' || ack.outcome === 'queued') { sent.push(t.name); accepted ||= ack.outcome === 'accepted'; }
    else refused.push({ name: t.name, reason: ack.reason ?? 'refusé' });
  }
  const recipients = { sent, refused };
  if (!sent.length) return { type: 'message.ack', rid: msg.rid, outcome: 'refused', reason: r.reason ?? 'personne à qui écrire', recipients };
  // The parts' outcomes come later (a typing is awaited): the card is there before any of them.
  d.sent.record(msg.from, { rid: msg.rid, at: d.now(), to: 'project' in a ? msg.to.trim() : broadcastLabel({ names: sent }), text: msg.text, ...(msg.summary ? { summary: msg.summary } : {}) });
  return { type: 'message.ack', rid: msg.rid, outcome: accepted ? 'accepted' : 'queued', recipients };
}

/** The user writes to a project or to sessions: a notice to each recipient, typed at its next free moment, behind what waits;
 *  it says whom it went to by the request's `label` when it has one (a project the fleet turned into sessions), else as resolved.
 *  `seen` (one per daemon): a resent request (same rid) is answered with its first result, nothing typed again; the oldest are forgotten past MAX_SEEN. */
export function broadcastFromUser(d: Deps & { mailbox: Pick<Mailbox, 'notify'>; seen: Map<string, BroadcastResult> }, msg: BroadcastMessage): BroadcastResult {
  const again = d.seen.get(msg.rid);
  if (again) return again;
  const result = userBroadcast(d, msg);
  d.seen.set(msg.rid, result);
  if (d.seen.size > MAX_SEEN) d.seen.delete(d.seen.keys().next().value!);
  return result;
}
function userBroadcast(d: Deps & { mailbox: Pick<Mailbox, 'notify'> }, msg: BroadcastMessage): BroadcastResult {
  const r = recipientsOf('project' in msg.to ? { project: msg.to.project } : { sessions: msg.to.sessions }, d);
  const sent: { id: string; name: string }[] = []; const refused = [...r.refused];
  for (const t of r.targets) {
    if (d.mailbox.notify(t.id, `Message de l'utilisateur (à ${msg.label ?? r.label}) : ${msg.text}`, `${msg.rid}:${t.id}`)) sent.push({ id: t.id, name: t.name });
    else refused.push({ name: t.name, reason: `${t.name} : impossible de lui écrire` });
  }
  const reason = sent.length ? undefined : r.reason ?? 'personne à qui écrire';
  return { type: 'session.broadcast.result', rid: msg.rid, sent, refused, ...(reason ? { reason } : {}) };
}
