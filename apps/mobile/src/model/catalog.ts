// The team catalog as the phone reads it (PhoneCatalog): how a role or a team definition is named in an address, which scope it
// lives in, and what the editors need to know about seats. Nothing here is a path: a definition is a scope, a project name and an id.
import type { DefinitionScope, PhoneCatalog, PhoneRole, PhoneTemplate } from '@ledge/protocol';

const SEP = '~';

/** The address key of a definition: `scope~project~id`, the project empty for a home definition (`home~~lead`). */
export function catalogKey(x: { scope: DefinitionScope; project: string | null; id: string }): string {
  return [x.scope, x.project ?? '', x.id].join(SEP);
}

/** The inverse of `catalogKey`; null for anything else (`new`, an unknown scope, a repo definition without a project). A project name may hold `~`, an id never does. */
export function parseCatalogKey(key: string): { scope: DefinitionScope; project: string | null; id: string } | null {
  const first = key.indexOf(SEP);
  const last = key.lastIndexOf(SEP);
  if (first < 0 || last === first) return null;
  const scope = key.slice(0, first);
  const project = key.slice(first + 1, last);
  const id = key.slice(last + 1);
  if (!id || (scope !== 'home' && scope !== 'repo')) return null;
  if (scope === 'home') return project === '' ? { scope, project: null, id } : null;
  return project === '' ? null : { scope, project, id };
}

/** Where a definition lives, as the phone says it. */
export const scopeLabel = (scope: DefinitionScope, project: string | null): string => scope === 'home' ? 'maison' : `dépôt ${project ?? ''}`.trimEnd();

/** The role a seat names for `project`: that project's repository role first, then the home one. */
export function roleFor(catalog: Pick<PhoneCatalog, 'roles'>, project: string | null, roleId: string): PhoneRole | undefined {
  const same = catalog.roles.filter(r => r.id === roleId);
  return (project === null ? undefined : same.find(r => r.scope === 'repo' && r.project === project)) ?? same.find(r => r.scope === 'home');
}

/** The role ids of `seats` whose effective autonomy is `auto`: a seat only overrides tool, model and effort, so it is its role's. */
export function autoSeats(seats: readonly { role: string }[], roles: readonly PhoneRole[]): string[] {
  return seats.filter(s => roles.find(r => r.id === s.role)?.autonomy === 'auto').map(s => s.role);
}

/** The roles no seat names, in the roles' order: what « Ajouter un rôle » offers. */
export function rolesNotSeated(seats: readonly { role: string }[], roles: readonly PhoneRole[]): PhoneRole[] {
  const seated = new Set(seats.map(s => s.role));
  return roles.filter(r => !seated.has(r.id));
}

/**
 * The team definitions that seat `roleId` and could resolve it to the role of this scope and project: a home role is read by every
 * definition, a repository role by the home definitions and those of its own project (a role of another project is not theirs).
 */
export function teamsSeating(roleId: string, scope: DefinitionScope, project: string | null, templates: readonly PhoneTemplate[]): PhoneTemplate[] {
  return templates.filter(t => t.seats.some(s => s.role === roleId) && (scope === 'home' || t.scope === 'home' || t.project === project));
}
