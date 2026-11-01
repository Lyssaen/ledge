import { isArchived, LEADER_ROLE, TEAM_ADDRESS, type ClientMessage, type MessageAck, type ServerMessage, type Session, type Team } from '@ledge/protocol';
import { formatTeamNotice } from './crossSession.js';
import type { Mailbox } from './mailbox.js';
import { noTeamReason } from './seat.js';
import type { Store } from './store.js';

type TeamBroadcast = Extract<ClientMessage, { type: 'team.broadcast' }>;
type TeamBroadcastResult = Extract<ServerMessage, { type: 'team.broadcast.result' }>;
type Deps = { store: Pick<Store, 'all'>; teams: { all(): readonly Team[]; get(id: string): Team | undefined }; mailbox: Pick<Mailbox, 'submit' | 'notify'> };

/** The live sessions of a team's seats but `except`: not a seat leaving, not a session exited or archived. */
export function crewOf(team: Team, sessions: readonly Session[], except?: string): Session[] {
  const byId = new Map(sessions.map(s => [s.id, s]));
  return team.seats.flatMap(seat => {
    const s = seat.sessionId && !seat.leaving ? byId.get(seat.sessionId) : undefined;
    return s && s.id !== except && s.state !== 'exited' && !isArchived(s) ? [s] : [];
  });
}

/** The lead's `@team`: its message to every other live seat, one mailbox entry each, no priority. */
export function broadcastFromLead(d: Deps, msg: Extract<ClientMessage, { type: 'session.message' }>): MessageAck {
  const refused = (reason: string): MessageAck => ({ type: 'message.ack', rid: msg.rid, outcome: 'refused', reason });
  const sessions = d.store.all();
  const team = d.teams.all().find(t => t.state !== 'dissolved' && t.seats.some(s => s.sessionId === msg.from));
  if (!team) return refused(noTeamReason(TEAM_ADDRESS, sessions.find(s => s.id === msg.from)));
  if (!team.seats.some(s => s.sessionId === msg.from && s.role === LEADER_ROLE)) return refused('seul le lead (@leader) parle à toute l\'équipe : écris à un rôle (ledge send @<rôle> "…")');
  const crew = crewOf(team, sessions, msg.from);
  if (!crew.length) return refused(`personne d'autre dans l'équipe ${team.name}`);
  const acks = crew.map(s => d.mailbox.submit({ ...msg, rid: `${msg.rid}:${s.id}`, to: s.name }));
  const sent = acks.filter(a => a.outcome !== 'refused');
  if (!sent.length) return refused(acks[0]!.reason ?? 'refusé');
  return { type: 'message.ack', rid: msg.rid, outcome: sent.some(a => a.outcome === 'accepted') ? 'accepted' : 'queued', recipients: sent.length };
}

/** The user's `team.broadcast`: a team notice to every live seat, the lead's included. */
export function broadcastFromUser(d: Deps, msg: TeamBroadcast): TeamBroadcastResult {
  const result = (r: { sent?: number; reason?: string }): TeamBroadcastResult => ({ type: 'team.broadcast.result', rid: msg.rid, team: msg.team, ...r });
  const team = d.teams.get(msg.team);
  if (!team || team.state === 'dissolved') return result({ reason: `aucune équipe ${msg.team}` });
  const crew = crewOf(team, d.store.all());
  if (!crew.length) return result({ reason: `personne dans l'équipe ${team.name}` });
  const text = formatTeamNotice({ team: team.id, text: `Message de l'utilisateur à toute l'équipe : ${msg.text}` });
  const sent = crew.filter(s => d.mailbox.notify(s.id, text, `${msg.rid}:${s.id}`)).length;
  return result({ sent });
}
