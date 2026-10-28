import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { autonomyArgs, AutonomySchema, ompApprovalFor, RoleSchema, ROLE_LABEL_MAX, ROLE_PROMPT_MAX, type Autonomy, type DefinitionProblem, type Role } from '@ledge/protocol';
import { ledgeDir } from '../paths.js';
import { log } from '../log.js';

/** The longest role file read: a prompt is 8000 characters at most, its front matter a few lines. */
const FILE_MAX = 64 * 1024;

/**
 * The repository a folder belongs to: the nearest parent holding `.git` (a folder or, in a worktree, a file), else the
 * folder itself. Its `.ledge/roles` and `.ledge/teams` win over the home's.
 */
export function repoRoot(cwd: string): string {
  const start = resolve(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

/** Where definitions of `kind` are read, the repository's first: `<repo>/.ledge/<kind>` then `~/.ledge/<kind>`. */
export function definitionDirs(kind: 'roles' | 'teams', cwd?: string): Array<{ dir: string; source: 'repo' | 'home' }> {
  const home = join(ledgeDir(), kind);
  const repo = cwd ? join(repoRoot(cwd), '.ledge', kind) : undefined;
  return [...(repo && resolve(repo) !== resolve(home) ? [{ dir: repo, source: 'repo' as const }] : []), { dir: home, source: 'home' as const }];
}

/** The files of a definitions folder with that extension, by name; none when it does not exist. */
export function definitionFiles(dir: string, ext: string[]): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter(n => ext.some(e => n.endsWith(e)) && !n.startsWith('.')).sort().map(n => join(dir, n)).filter(p => {
    try { return statSync(p).isFile(); } catch { return false; }
  });
}

export function readSmall(path: string): string {
  if (statSync(path).size > FILE_MAX) throw new Error(`file over ${FILE_MAX / 1024} KB`);
  return readFileSync(path, 'utf8');
}

/** `key: value` lines between two `---` at the top, and the body after them. A value may be quoted. */
export function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { fields: {}, body: src.trim() };
  const fields: Record<string, string> = {};
  for (const raw of m[1]!.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i <= 0) throw new Error(`front matter line without a key: ${line.replace(/\s+#.*$/, '').slice(0, 60)}`);
    fields[line.slice(0, i).trim()] = scalarValue(line.slice(i + 1));
  }
  return { fields, body: src.slice(m[0].length).trim() };
}

/** A value of the front matter or the YAML subset: a trailing ` # comment` dropped from an unquoted value only, quotes taken off. */
export function scalarValue(raw: string): string {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    if (end > 0 && /^(\s+#.*)?$/.test(v.slice(end + 1))) return v.slice(1, end);
  }
  return unquote(v.replace(/(^|\s)#.*$/, '').trim());
}

/** How a value is written so `scalarValue` reads it back: bare when plain, else in the quote it does not hold; null when no quote
 *  can hold it (both quotes, or a line break). There are no escapes. */
export function quoteScalar(v: string): string | null {
  if (/[\r\n]/.test(v)) return null;
  if (/^[\w./@:+-]+$/.test(v) && !/^(true|false|null|yes|no|~)$/i.test(v)) return v;
  if (!v.includes('"')) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  return null;
}

/** The version of a definition file's text, as a write or a delete names it: sha256, its first 16 hex characters. */
export const definitionHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

export const unquote = (v: string): string => (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1) : v);

const ROLE_KEYS = new Set(['label', 'tool', 'model', 'effort', 'autonomy']);

/** One role file as a role, or the reason it is not one. */
export function parseRole(id: string, text: string, source: 'repo' | 'home', path: string): Role | string {
  let parsed;
  try { parsed = frontMatter(text); } catch (e) { return (e as Error).message; }
  const { fields, body } = parsed;
  const unknown = Object.keys(fields).find(k => !ROLE_KEYS.has(k));
  if (unknown) return `unknown key ${unknown}`;
  if (body.length > ROLE_PROMPT_MAX) return `prompt over ${ROLE_PROMPT_MAX} characters`;
  const label = (fields.label ?? id).slice(0, ROLE_LABEL_MAX);
  const r = RoleSchema.safeParse({ id, label, prompt: body, source, path,
    ...(fields.tool ? { tool: fields.tool } : {}), ...(fields.model ? { model: fields.model } : {}),
    ...(fields.effort ? { effort: fields.effort } : {}), ...(fields.autonomy ? { autonomy: fields.autonomy } : {}) });
  if (!r.success) {
    const issue = r.error.issues[0]!;
    return `${issue.path.join('.') || 'role'}: ${issue.message}`;
  }
  return r.data;
}

/** One role file read, with the hash of its text; undefined, logged and told in `problems`, when it is not a role. */
export function loadRole(id: string, path: string, source: 'repo' | 'home', problems: DefinitionProblem[]): Role | undefined {
  let r: Role | string;
  try { const text = readSmall(path); r = parseRole(id, text, source, path); if (typeof r !== 'string') r = { ...r, hash: definitionHash(text) }; } catch (e) { r = (e as Error).message; }
  if (typeof r === 'string') { log(`role ${path} skipped: ${r}`); problems.push({ path, reason: r }); return undefined; }
  return r;
}

/** The roles a session in `cwd` can take (spec 2026-10-25 roles §3.1): the repository's, then the home's of another id; a
 *  repository role names in `shadows` the home file of its id it hides. A file that does not parse is skipped, logged, and
 *  told in `problems`. */
export function listRoles(cwd?: string): { roles: Role[]; problems: DefinitionProblem[] } {
  const roles = new Map<string, Role>(); const problems: DefinitionProblem[] = [];
  for (const { dir, source } of definitionDirs('roles', cwd)) {
    for (const path of definitionFiles(dir, ['.md'])) {
      const id = path.slice(dir.length + 1, -'.md'.length);
      const won = roles.get(id);
      if (won) { if (source === 'home') roles.set(id, { ...won, shadows: path }); continue; }
      const r = loadRole(id, path, source, problems);
      if (r) roles.set(id, r);
    }
  }
  return { roles: [...roles.values()].sort((a, b) => a.id.localeCompare(b.id)), problems };
}

/** One role by id, as a session in `cwd` would get it. */
export function findRole(id: string, cwd?: string): Role | undefined {
  return listRoles(cwd).roles.find(r => r.id === id);
}

/** Each agent's own permission switch for an autonomy, shared with the fronts that explain it. */
export { autonomyArgs, ompApprovalFor };

export const isAutonomy = (v: unknown): v is Autonomy => AutonomySchema.safeParse(v).success;
