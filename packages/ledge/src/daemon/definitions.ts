import { mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { DefinitionCode, DefinitionProblem, DefinitionScope, Role, RoleDraft, Session, TeamTemplate } from '@ledge/protocol';
import { definitionFiles, definitionHash, loadRole, quoteScalar, repoRoot } from './roles.js';
import { loadTemplate, templateText } from './teams.js';
import { ledgeDir } from '../paths.js';

export { definitionHash, quoteScalar, templateText };

/** The text of a role file, as `parseRole` reads it back: the front matter's set keys, a blank line, the prompt. Null when a
 *  value cannot be quoted. */
export function roleText(r: RoleDraft): string | null {
  const lines: string[] = [];
  for (const [key, value] of [['label', r.label], ['tool', r.tool], ['model', r.model], ['effort', r.effort], ['autonomy', r.autonomy]] as const) {
    if (value === undefined) continue;
    const q = quoteScalar(value);
    if (q === null) return null;
    lines.push(`${key}: ${q}`);
  }
  return `---\n${lines.join('\n')}\n---\n\n${r.prompt}\n`;
}

/** The text of a definition file now, or undefined when there is none. */
function current(path: string): string | undefined {
  try { return readFileSync(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}

/**
 * Writes a definition file. `base` is the hash of the version the client was shown, null to create: a file that is there
 * already answers `exists`, and a known version that is gone or differs answers `changed`, the file untouched, so a hand edit is
 * never overwritten. The folder is made, the file written whole by tmp + rename; `hash` is that of the file as it reads back.
 */
export function writeDefinition(path: string, text: string, base: string | null): { hash: string } | { code: Extract<DefinitionCode, 'changed' | 'exists'> } {
  const now = current(path);
  if (base === null) { if (now !== undefined) return { code: 'exists' }; }
  else if (now === undefined || definitionHash(now) !== base) return { code: 'changed' };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, path); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  return { hash: definitionHash(readFileSync(path, 'utf8')) };
}

/** Removes a definition file, only at the version `base` names. */
export function deleteDefinition(path: string, base: string): { ok: true } | { code: Extract<DefinitionCode, 'changed' | 'missing'> } {
  const now = current(path);
  if (now === undefined) return { code: 'missing' };
  if (definitionHash(now) !== base) return { code: 'changed' };
  unlinkSync(path);
  return { ok: true };
}

/** Where a scope keeps its definitions of `kind`: `<repo>/.ledge/<kind>` (the repository `repoFolder` belongs to) or `~/.ledge/<kind>`. */
export function scopeDir(kind: 'roles' | 'teams', scope: DefinitionScope, repoFolder?: string): string {
  if (scope === 'home') return join(ledgeDir(), kind);
  if (!repoFolder) throw new Error('the repository scope needs a folder');
  return join(repoRoot(repoFolder), '.ledge', kind);
}

/** The roles and templates of one folder pair, as they read: no repository over home merge, each with its hash. */
export function scopeDefinitions(dir: { roles: string; teams: string }, scope: DefinitionScope): { roles: Role[]; templates: TeamTemplate[]; problems: DefinitionProblem[] } {
  const problems: DefinitionProblem[] = []; const roles: Role[] = []; const templates = new Map<string, TeamTemplate>();
  for (const path of definitionFiles(dir.roles, ['.md'])) {
    const r = loadRole(basename(path, '.md'), path, scope, problems);
    if (r) roles.push(r);
  }
  for (const path of definitionFiles(dir.teams, ['.yaml', '.yml'])) {
    const id = basename(path).replace(/\.ya?ml$/, '');
    if (templates.has(id)) continue;
    const t = loadTemplate(id, path, scope, problems);
    if (t) templates.set(id, t);
  }
  return { roles: roles.sort((a, b) => a.id.localeCompare(b.id)), templates: [...templates.values()].sort((a, b) => a.id.localeCompare(b.id)), problems };
}

/** The sessions to tell a role's prompt changed (spec §3.6): launched by Ledge and still running, holding `roleId`, which resolves
 *  from their folder to the file at `path`. */
export function promptRecipients(roleId: string, path: string, sessions: readonly Session[], resolve: (id: string, cwd: string) => Role | undefined): Session[] {
  return sessions.filter(s => s.role === roleId && s.source === 'launcher' && s.state !== 'exited' && s.archivedAt === undefined && resolve(roleId, s.cwd)?.path === path);
}
