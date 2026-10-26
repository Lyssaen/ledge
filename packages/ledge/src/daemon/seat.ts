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

/**
 * `@role` as an address (spec 2026-10-25 roles §3.6): the live seat holding that role in the sender's team. A sender in
 * no team, or a role nobody (or more than one) holds, is refused with the candidates. Any other `to` is left as it is.
 */
export function resolveRoleAddress(to: string, from: string, sessions: readonly Session[], teams: readonly Team[]): { to: string } | { reason: string } {
  if (!to.startsWith('@')) return { to };
  const role = to.slice(1);
  const team = teams.find(t => t.state !== 'dissolved' && t.seats.some(s => s.sessionId === from));
  if (!team) return { reason: `${to} n'existe que dans une équipe` };
  const byId = new Map(sessions.map(s => [s.id, s]));
  const held = team.seats.filter(s => s.role === role && s.sessionId).map(s => byId.get(s.sessionId!)).filter((s): s is Session => !!s && s.state !== 'exited' && !isArchived(s));
  if (held.length === 1) return { to: held[0]!.name };
  if (held.length > 1) return { reason: `plusieurs sessions tiennent ${to} dans ${team.name} : ${held.map(s => s.name).join(', ')}` };
  const roles = teammates(team, sessions).map(m => `@${m.role}`);
  return { reason: `personne ne tient ${to} dans l'équipe ${team.name}${roles.length ? ` (rôles tenus : ${roles.join(', ')})` : ''}` };
}
