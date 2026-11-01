import { isArchived, LEADER_ROLE, TEAM_ADDRESS, type ClientMessage, type MessageAck, type Session, type Team, type TeamBroadcast, type TeamBroadcastResult } from '@ledge/protocol';
import { formatTeamNotice } from './crossSession.js';
import type { Mailbox } from './mailbox.js';
import { noTeamReason } from './seat.js';
import type { Store } from './store.js';

type Deps = { store: Pick<Store, 'all'>; teams: { all(): readonly Team[]; get(id: string): Team | undefined }; mailbox: Pick<Mailbox, 'submit' | 'notify'> };

/** The live sessions of a team's seats but `except`: not a seat leaving, not a session exited or archived. */
export function liveSeatSessions(team: Team, sessions: readonly Session[], except?: string): Session[] {
  const byId = new Map(sessions.map(s => [s.id, s]));
  return team.seats.flatMap(seat => {
    const s = seat.sessionId && !seat.leaving ? byId.get(seat.sessionId) : undefined;
    return s && s.id !== except && s.state !== 'exited' && !isArchived(s) ? [s] : [];
  });
}

/** What opens a message the lead wrote to the whole team, as each seat reads it: not a private one. */
export const TEAM_MESSAGE_PREFIX = "(à toute l'équipe) ";

/**
 * The lead's `@team`: its message to every other live seat, one mailbox entry each, no priority, opened by
 * TEAM_MESSAGE_PREFIX (once: a text that has it already keeps it). Always typed by the mailbox: an `intercept` the caller
 * sent is dropped (it would hand every Claude seat back as `native`, nothing queued), and only a seat queued or reached
 * counts in `recipients`.
 */
export function broadcastFromLead(d: Deps, msg: Extract<ClientMessage, { type: 'session.message' }>): MessageAck {
  const refused = (reason: string): MessageAck => ({ type: 'message.ack', rid: msg.rid, outcome: 'refused', reason });
  const sessions = d.store.all();
  const team = d.teams.all().find(t => t.state !== 'dissolved' && t.seats.some(s => s.sessionId === msg.from));
  if (!team) return refused(noTeamReason(TEAM_ADDRESS, sessions.find(s => s.id === msg.from)));
  if (!team.seats.some(s => s.sessionId === msg.from && s.role === LEADER_ROLE)) return refused('seul le lead (@leader) parle à toute l\'équipe : écris à un rôle (ledge send @<rôle> "…")');
  const crew = liveSeatSessions(team, sessions, msg.from);
  if (!crew.length) return refused(`personne d'autre dans l'équipe ${team.name}`);
  const { intercept: _intercept, ...base } = msg;
  const text = msg.text.startsWith(TEAM_MESSAGE_PREFIX) ? msg.text : `${TEAM_MESSAGE_PREFIX}${msg.text}`;
  const acks = crew.map(s => d.mailbox.submit({ ...base, text, rid: `${msg.rid}:${s.id}`, to: s.name }));
  const sent = acks.filter(a => a.outcome === 'accepted' || a.outcome === 'queued');
  if (!sent.length) return refused(acks.find(a => a.reason)?.reason ?? 'refusé');
  return { type: 'message.ack', rid: msg.rid, outcome: sent.some(a => a.outcome === 'accepted') ? 'accepted' : 'queued', recipients: sent.length };
}

/** The user's `team.broadcast`: a team notice to every live seat, the lead's included. */
export function broadcastFromUser(d: Deps, msg: TeamBroadcast): TeamBroadcastResult {
  const result = (r: { sent?: number; reason?: string }): TeamBroadcastResult => ({ type: 'team.broadcast.result', rid: msg.rid, team: msg.team, ...r });
  const team = d.teams.get(msg.team);
  if (!team || team.state === 'dissolved') return result({ reason: `aucune équipe ${msg.team}` });
  const crew = liveSeatSessions(team, d.store.all());
  if (!crew.length) return result({ reason: `personne dans l'équipe ${team.name}` });
  const text = formatTeamNotice({ team: team.id, text: `Message de l'utilisateur à toute l'équipe : ${msg.text}` });
  const sent = crew.filter(s => d.mailbox.notify(s.id, text, `${msg.rid}:${s.id}`)).length;
  return result({ sent });
}
