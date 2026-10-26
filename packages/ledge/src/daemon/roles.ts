import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AutonomySchema, RoleSchema, ROLE_LABEL_MAX, ROLE_PROMPT_MAX, type Autonomy, type DefinitionProblem, type OmpApproval, type Role, type Tool } from '@ledge/protocol';
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
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i <= 0) throw new Error(`front matter line without a key: ${line.slice(0, 60)}`);
    fields[line.slice(0, i).trim()] = unquote(line.slice(i + 1).trim());
  }
  return { fields, body: src.slice(m[0].length).trim() };
}

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

/** The roles a session in `cwd` can take (spec 2026-10-25 roles §3.1): the repository's, then the home's of another id.
 *  A file that does not parse is skipped, logged, and told in `problems`. */
export function listRoles(cwd?: string): { roles: Role[]; problems: DefinitionProblem[] } {
  const roles = new Map<string, Role>(); const problems: DefinitionProblem[] = [];
  for (const { dir, source } of definitionDirs('roles', cwd)) {
    for (const path of definitionFiles(dir, ['.md'])) {
      const id = path.slice(dir.length + 1, -'.md'.length);
      if (roles.has(id)) continue;
      let r: Role | string;
      try { r = parseRole(id, readSmall(path), source, path); } catch (e) { r = (e as Error).message; }
      if (typeof r === 'string') { log(`role ${path} skipped: ${r}`); problems.push({ path, reason: r }); continue; }
      roles.set(id, r);
    }
  }
  return { roles: [...roles.values()].sort((a, b) => a.id.localeCompare(b.id)), problems };
}

/** One role by id, as a session in `cwd` would get it. */
export function findRole(id: string, cwd?: string): Role | undefined {
  return listRoles(cwd).roles.find(r => r.id === id);
}

/**
 * Each agent's own permission switch for an autonomy (spec §3.1), added at launch and kept by a resume. Ledge never
 * answers a prompt in the agent's place: what the agent still asks lands in « À toi ».
 */
export function autonomyArgs(tool: Tool, autonomy: Autonomy | undefined): string[] {
  if (!autonomy || autonomy === 'ask') return [];
  switch (tool) {
    case 'claude': return ['--permission-mode', autonomy === 'edits' ? 'acceptEdits' : 'auto'];
    case 'codex': return autonomy === 'edits' ? ['--ask-for-approval', 'on-request'] : ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'];
    case 'cursor': return autonomy === 'auto' ? ['--force'] : [];
    case 'omp': return [];
  }
}

/** OMP's approval mode for an autonomy: it has no switch of its own beyond these. */
export function ompApprovalFor(autonomy: Autonomy | undefined): OmpApproval | undefined {
  return autonomy === 'auto' ? 'yolo' : autonomy ? 'always-ask' : undefined;
}

export const isAutonomy = (v: unknown): v is Autonomy => AutonomySchema.safeParse(v).success;
