import { isArchived, type Role, type Session, type Team } from '@ledge/protocol';

/** A seat's teammates as its context names them: live, in the team, in seat order. */
export function teammates(team: Pick<Team, 'seats'>, sessions: readonly Session[]): Array<{ name: string; role: string }> {
  const byId = new Map(sessions.map(s => [s.id, s]));
  return team.seats.flatMap(seat => {
    const s = seat.sessionId ? byId.get(seat.sessionId) : undefined;
    return s && s.state !== 'exited' && !isArchived(s) ? [{ name: s.name, role: seat.role }] : [];
  });
}

/**
 * What a seat is told of its role and its team at every start (spec 2026-10-25 roles §3.5), after its identity lines:
 * its role and the role's prompt, its team and how to reach each one by role, and that Ledge is the operator. A session
 * with a role and no team gets the first two lines only.
 */
export function seatContext(o: { role?: Pick<Role, 'id' | 'label' | 'prompt'>; roleId?: string; roleLabel?: string; team?: { name: string; members: Array<{ name: string; role: string }> } }): string {
  const id = o.role?.id ?? o.roleId; const label = o.role?.label ?? o.roleLabel ?? id;
  const lines: string[] = [];
  if (id) lines.push(`Ton rôle : ${label} (${id})${o.team ? `, dans l'équipe ${o.team.name}` : ''}.`);
  if (o.role?.prompt.trim()) lines.push(o.role.prompt.trim());
  if (o.team) {
    const members = o.team.members.map(m => `${m.name} (${m.role})`).join(', ') || 'personne d\'autre pour l\'instant';
    lines.push(`Ton équipe : ${members}. Écris-leur par leur rôle : ledge send @build "…", ledge task give @qa "…".`,
      'L\'opérateur est Ledge : il t\'a confié ou te confiera ton travail par une <ledge-task>. Travaille en autonomie avec ton équipe ; ne t\'arrête pour l\'utilisateur que pour une décision qui lui revient. Termine toujours une tâche reçue (ledge task done <id> "<résultat>", ou refuse) : c\'est ainsi que Ledge et l\'utilisateur savent où en est l\'équipe.');
  }
  return lines.join('\n');
}

/** Why `@role` reaches no one for a sender in no team: the team it was taken out of, when Ledge knows it. */
export function noTeamReason(to: string, sender: Pick<Session, 'teamLeft'> | undefined): string {
  return sender?.teamLeft ? `tu n'es plus dans l'équipe ${sender.teamLeft} : ${to} ne te sert plus (ledge team list)` : `${to} n'existe que dans une équipe`;
}

/** A seat's team as its context names it: the team it sits in (not dissolved) and its live teammates but itself; null in none. */
export function seatView(id: string, sessions: readonly Session[], teams: readonly Team[]): { id: string; name: string; members: Array<{ name: string; role: string }> } | null {
  const s = sessions.find(x => x.id === id);
  const team = s?.team ? teams.find(t => t.id === s.team && t.state !== 'dissolved') : undefined;
  if (!s || !team) return null;
  return { id: team.id, name: team.name, members: teammates(team, sessions).filter(m => m.name !== s.name) };
}

type SeatKey = { t: string; n: string; m: string[] };
/** What a seat was told of its team, as `Session.teamSeen` keeps it: '' for no team. */
export const seatKey = (v: ReturnType<typeof seatView>): string => (v ? JSON.stringify({ t: v.id, n: v.name, m: v.members.map(m => `${m.name}@${m.role}`) } satisfies SeatKey) : '');
const parseKey = (k: string): SeatKey | null => { try { return k ? JSON.parse(k) as SeatKey : null; } catch { return null; } };
const member = (m: string) => { const at = m.lastIndexOf('@'); return { name: m.slice(0, at), role: m.slice(at + 1) }; };
const listOf = (k: SeatKey) => k.m.map(member).map(m => `${m.name} (${m.role})`).join(', ') || 'personne d\'autre pour l\'instant';

/**
 * The line a seat reads at its next turn when its team changed since it was last told it (`seen`, `Session.teamSeen`): who
 * came, who went, who took whose seat, then its team as it is. Nothing when it is the same, or when what it was told is unknown
 * (a session from before `teamSeen`: it is recorded, not told).
 */
export function teamChangeLine(seen: string | undefined, now: string): string | undefined {
  if (seen === undefined || seen === now) return undefined;
  const before = parseKey(seen); const after = parseKey(now);
  if (!after) return before ? `Ledge : tu n'es plus dans l'équipe ${before.n} ; les adresses @rôle ne te servent plus (ledge team list).` : undefined;
  const reach = 'Écris-leur par leur rôle : ledge send @rôle "…".';
  if (!before || before.t !== after.t) return `Ledge : tu es maintenant dans l'équipe ${after.n}. Ton équipe : ${listOf(after)}. ${reach}`;
  const was = before.m.map(member); const is = after.m.map(member);
  const changes: string[] = [];
  for (const m of is) {
    if (was.some(w => w.name === m.name && w.role === m.role)) continue;
    const prior = was.find(w => w.role === m.role && !is.some(x => x.name === w.name && x.role === w.role));
    changes.push(prior ? `${m.name} remplace ${prior.name} (${m.role})` : `${m.name} (${m.role}) arrive`);
  }
  for (const w of was) if (!is.some(m => m.name === w.name && m.role === w.role) && !is.some(m => m.role === w.role)) changes.push(`${w.name} (${w.role}) part`);
  return `Ledge : ton équipe ${after.n} a changé${changes.length ? ` (${changes.join(', ')})` : ''}. Ton équipe : ${listOf(after)}. ${reach}`;
}

/**
 * `@role` as an address (spec 2026-10-25 roles §3.6): the live seat holding that role in the sender's team. A sender in
 * no team, or a role nobody (or more than one) holds, is refused with the candidates. Any other `to` is left as it is.
 */
export function resolveRoleAddress(to: string, from: string, sessions: readonly Session[], teams: readonly Team[]): { to: string } | { reason: string } {
  if (!to.startsWith('@')) return { to };
  const role = to.slice(1);
  const team = teams.find(t => t.state !== 'dissolved' && t.seats.some(s => s.sessionId === from));
  if (!team) return { reason: noTeamReason(to, sessions.find(s => s.id === from)) };
  const byId = new Map(sessions.map(s => [s.id, s]));
  const held = team.seats.filter(s => s.role === role && s.sessionId).map(s => byId.get(s.sessionId!)).filter((s): s is Session => !!s && s.state !== 'exited' && !isArchived(s));
  if (held.length === 1) return { to: held[0]!.name };
  if (held.length > 1) return { reason: `plusieurs sessions tiennent ${to} dans ${team.name} : ${held.map(s => s.name).join(', ')}` };
  const roles = teammates(team, sessions).map(m => `@${m.role}`);
  return { reason: `personne ne tient ${to} dans l'équipe ${team.name}${roles.length ? ` (rôles tenus : ${roles.join(', ')})` : ''}` };
}
