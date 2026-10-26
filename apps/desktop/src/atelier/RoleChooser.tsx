import { useEffect, useState, type JSX } from 'react';
import type { Role, Session, Team } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import type { TeamsApi } from '../teams/useTeamsApi';

/** A seat dropped on a team's table: the session, the team, and where the drop happened (the menu opens there). */
export interface RoleChoice { session: Session; team: Team; at: { x: number; y: number } }

/** The roles a session may take in a team (atelier rooms spec §3.3): the team's free roles first, then « autre rôle… »,
 *  which reads the roles of the team's folder from the daemon and offers those nobody holds. */
export function RoleChooser({ choice, teams, onChoose, onClose }: { choice: RoleChoice; teams: TeamsApi; onChoose(role: string): void; onClose(): void }): JSX.Element {
  const { t } = useI18n();
  const { team, session } = choice;
  const [others, setOthers] = useState<Role[] | null>(null);
  const [asked, setAsked] = useState(false);
  // A seat is free when nobody holds it, or its session has ended.
  const free = team.seats.filter(x => !x.sessionId || x.sessionId === session.id).map(x => x.role);
  const held = new Set(team.seats.filter(x => x.sessionId && x.sessionId !== session.id).map(x => x.role));
  useEffect(() => {
    if (!asked) return;
    let live = true;
    void teams.roles(team.cwd).then(r => { if (live) setOthers(r.roles.filter(x => !held.has(x.id) && !free.includes(x.id))); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, team.cwd, teams]);
  return (
    <Menu open onOpenChange={open => { if (!open) onClose(); }} label={t.teams.chooseRole(session.name, team.name)} className="role-chooser" menuClassName="assign-menu role-menu"
      at={choice.at} trigger={tr => <button type="button" className="sr-only" tabIndex={-1} {...tr} />}>
      {free.map(role => <MenuItem key={role} onSelect={() => onChoose(role)}><span className="role-pill">@{role}</span></MenuItem>)}
      {/* Not a MenuItem: choosing it keeps the menu open, to list the other roles. */}
      {!asked && <button type="button" role="menuitem" onClick={() => setAsked(true)}><span>{t.teams.otherRole}</span></button>}
      {asked && others === null && <MenuItem disabled onSelect={() => {}}><span>{t.teams.loadingRoles}</span></MenuItem>}
      {others?.map(r => <MenuItem key={r.id} onSelect={() => onChoose(r.id)}><span className="role-pill">@{r.id}</span><span className="role-label">{r.label}</span></MenuItem>)}
      {others?.length === 0 && free.length === 0 && <MenuItem disabled onSelect={() => {}}><span>{t.teams.noRole}</span></MenuItem>}
    </Menu>
  );
}
