import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { Rig, Role, Session, Team } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import type { TeamsApi } from '../teams/useTeamsApi';
import { joinableTeam, joinCandidates } from '../rigs/engine';

/** Who joins which team, and where the menu opens: a seat dropped on a team's table names its `session`; « Ajouter une session… » (lot F
 *  final review I5) names none and gives the `candidates` to pick it from first. */
export interface RoleChoice { session?: Session; candidates?: readonly Session[]; team: Team; at: { x: number; y: number } }

/** The session, when none is named yet (« Ajouter une session… »: the project's standalone sessions on the team's machine), then the role
 *  it may take in the team (atelier rooms spec §3.3): the team's free roles first, then « autre rôle… », which reads the roles of the
 *  team's folder from the daemon and offers those nobody holds. */
export function RoleChooser({ choice, teams, onChoose, onClose }: { choice: RoleChoice; teams: TeamsApi; onChoose(role: string, session: Session): void; onClose(): void }): JSX.Element {
  const { t } = useI18n();
  const { team } = choice;
  const [picked, setPicked] = useState<Session | null>(null);
  const session = choice.session ?? picked;
  const [others, setOthers] = useState<Role[] | null>(null);
  const [asked, setAsked] = useState(false);
  // A seat is free when nobody holds it, or its session has ended.
  const free = team.seats.filter(x => !x.sessionId || x.sessionId === session?.id).map(x => x.role);
  const held = new Set(team.seats.filter(x => x.sessionId && x.sessionId !== session?.id).map(x => x.role));
  useEffect(() => {
    if (!asked) return;
    let live = true;
    void teams.roles(team.cwd).then(r => { if (live) setOthers(r.roles.filter(x => !held.has(x.id) && !free.includes(x.id))); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, team.cwd, teams]);
  // Picking the session keeps the chooser open on its roles (a menu of its own: its label, and its first item takes the focus).
  if (!session) return (
    <Menu open onOpenChange={open => { if (!open) onClose(); }} label={t.rooms.addSessionTo(team.name)} className="role-chooser" menuClassName="assign-menu role-menu"
      at={choice.at} trigger={tr => <button type="button" className="sr-only" tabIndex={-1} {...tr} />}>
      {(choice.candidates ?? []).map(s => <button key={s.id} type="button" role="menuitem" onClick={() => setPicked(s)}><span>{s.name}</span></button>)}
      {(choice.candidates ?? []).length === 0 && <MenuItem disabled onSelect={() => {}}><span>{t.rooms.noSession}</span></MenuItem>}
    </Menu>
  );
  return (
    <Menu key={session.id} open onOpenChange={open => { if (!open) onClose(); }} label={t.rooms.chooseRole(session.name, team.name)} className="role-chooser" menuClassName="assign-menu role-menu"
      at={choice.at} trigger={tr => <button type="button" className="sr-only" tabIndex={-1} {...tr} />}>
      {free.map(role => <MenuItem key={role} onSelect={() => onChoose(role, session)}><span className="role-pill">@{role}</span></MenuItem>)}
      {/* Not a MenuItem: choosing it keeps the menu open, to list the other roles. */}
      {!asked && <button type="button" role="menuitem" onClick={() => setAsked(true)}><span>{t.rooms.otherRole}</span></button>}
      {asked && others === null && <MenuItem disabled onSelect={() => {}}><span>{t.rooms.loadingRoles}</span></MenuItem>}
      {others?.map(r => <MenuItem key={r.id} onSelect={() => onChoose(r.id, session)}><span className="role-pill">@{r.id}</span><span className="role-label">{r.label}</span></MenuItem>)}
      {others?.length === 0 && free.length === 0 && <MenuItem disabled onSelect={() => {}}><span>{t.rooms.noRole}</span></MenuItem>}
    </Menu>
  );
}

/** Where a menu chosen from a « … » opens the next one: under the element that has the focus (a MenuItem gives it back to its menu's
 *  button before acting), else near the top left. */
export const underFocus = (): { x: number; y: number } => {
  const el = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const r = el?.getBoundingClientRect();
  return r ? { x: r.left, y: r.bottom + 4 } : { x: 80, y: 80 };
};

/**
 * Joining a live Ledge team without dragging (lot F final review I5), one flow for the Bureaux, the atelier room and the « Équipes »
 * card: `offer(rig)` says whether its « … » carries « Ajouter une session… », `add(rig, at)` opens the chooser (the session, then its
 * role), `ask` opens it for a session already named (a drop). The choice sends `team.join` and says so through `notify`.
 */
export function useJoinTeam({ teams, sessions, rigs, projectIdOf, notify }: {
  teams: TeamsApi | undefined; sessions: readonly Session[]; rigs: readonly Rig[]; projectIdOf(s: Session): string | null; notify?(text: string): void;
}): { offer(rig: Rig): boolean; add(rig: Rig, at: { x: number; y: number }): void; ask(choice: RoleChoice): void; chooser: ReactNode } {
  const { t } = useI18n();
  const [choosing, setChoosing] = useState<RoleChoice | null>(null);
  const offer = (rig: Rig) => !!teams && !!joinableTeam(rig, teams.teams);
  const add = (rig: Rig, at: { x: number; y: number }) => {
    const team = joinableTeam(rig, teams?.teams);
    if (team) setChoosing({ team, at, candidates: joinCandidates(rig, sessions, rigs, projectIdOf) });
  };
  const chooser = choosing && teams ? (
    <RoleChooser key={`${choosing.team.id}|${choosing.session?.id ?? ''}|${choosing.at.x},${choosing.at.y}`} choice={choosing} teams={teams} onClose={() => setChoosing(null)}
      onChoose={(role, session) => { teams.join(choosing.team.id, session.id, role); notify?.(t.rooms.joined(session.name, choosing.team.name, role)); setChoosing(null); }} />
  ) : null;
  return { offer, add, ask: setChoosing, chooser };
}
