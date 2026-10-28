import { existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { SeatsSchema, TeamNameSchema, type DefinitionProblem, type Role, type Seat, type TeamTemplate, type Tool } from '@ledge/protocol';
import { definitionDirs, definitionFiles, definitionHash, listRoles, quoteScalar, readSmall, scalarValue } from './roles.js';
import { ledgeDir } from '../paths.js';
import { log } from '../log.js';

type Value = string | Value[] | { [k: string]: Value };

/** A scalar of the YAML subset: quotes taken off, a trailing comment dropped from an unquoted value. */
const scalar = scalarValue;

/** `{ role: build, tool: claude }`: a flow mapping of scalars. */
function flowMap(raw: string): Record<string, string> {
  const inner = raw.trim().replace(/^\{/, '').replace(/\}$/, '');
  const out: Record<string, string> = {};
  for (const part of inner.split(',')) {
    if (!part.trim()) continue;
    const i = part.indexOf(':');
    if (i <= 0) throw new Error(`not a key: value pair: ${part.trim().slice(0, 40)}`);
    out[part.slice(0, i).trim()] = scalar(part.slice(i + 1));
  }
  return out;
}

/**
 * The YAML a team template is written in, and no more (spec 2026-10-25 roles §3.2): top-level `key: value`, and a list of
 * seats, each a flow mapping (`- { role: lead }`) or a block of `key: value` lines (`- role: build` then `tool: claude`
 * indented under it). A file that starts with `{` is read as JSON.
 */
export function parseTemplateText(text: string): Record<string, Value> {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (src.trimStart().startsWith('{')) return JSON.parse(src) as Record<string, Value>;
  const out: Record<string, Value> = {};
  let list: Value[] | null = null; let item: Record<string, string> | null = null; let itemIndent = -1;
  for (const raw of src.split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (raw.includes('\t')) throw new Error('tabs are not allowed in YAML');
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0 && !line.startsWith('- ')) {
      item = null; list = null;
      const i = line.indexOf(':');
      if (i <= 0) throw new Error(`line without a key: ${line.slice(0, 60)}`);
      const key = line.slice(0, i).trim(); const rest = line.slice(i + 1).trim();
      if (rest === '' ) { list = []; out[key] = list; }
      else if (rest.startsWith('[')) out[key] = rest.replace(/^\[|\]$/g, '').split(',').map(scalar).filter(Boolean);
      else out[key] = scalar(rest);
      continue;
    }
    if (!list) throw new Error(`indented line outside a list: ${line.slice(0, 60)}`);
    if (line.startsWith('- ') || line === '-') {
      const rest = line.slice(1).trim();
      if (rest.startsWith('{')) { list.push(flowMap(rest)); item = null; continue; }
      item = {}; itemIndent = indent; list.push(item);
      if (rest) { const i = rest.indexOf(':'); if (i <= 0) { list[list.length - 1] = scalar(rest); item = null; continue; } item[rest.slice(0, i).trim()] = scalar(rest.slice(i + 1)); }
      continue;
    }
    if (!item || indent <= itemIndent) throw new Error(`line outside a seat: ${line.slice(0, 60)}`);
    const i = line.indexOf(':');
    if (i <= 0) throw new Error(`line without a key: ${line.slice(0, 60)}`);
    item[line.slice(0, i).trim()] = scalar(line.slice(i + 1));
  }
  return out;
}

/** One template file as a template, or the reason it is not one. The role ids are checked at launch, not here. */
export function parseTemplate(id: string, text: string, source: 'repo' | 'home', path: string): TeamTemplate | string {
  let raw: Record<string, Value>;
  try { raw = parseTemplateText(text); } catch (e) { return (e as Error).message; }
  const name = TeamNameSchema.safeParse(typeof raw.name === 'string' ? raw.name : id);
  if (!name.success) return 'name: a name of 1 to 60 characters';
  const seats = SeatsSchema.safeParse(raw.seats);
  if (!seats.success) { const issue = seats.error.issues[0]!; return `seats${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`; }
  return { id, name: name.data, seats: seats.data, source, path };
}

/** One template file read, with the hash of its text; undefined, logged and told in `problems`, when it is not a template. */
export function loadTemplate(id: string, path: string, source: 'repo' | 'home', problems: DefinitionProblem[]): TeamTemplate | undefined {
  let t: TeamTemplate | string;
  try { const text = readSmall(path); t = parseTemplate(id, text, source, path); if (typeof t !== 'string') t = { ...t, hash: definitionHash(text) }; } catch (e) { t = (e as Error).message; }
  if (typeof t === 'string') { log(`team ${path} skipped: ${t}`); problems.push({ path, reason: t }); return undefined; }
  return t;
}

/** The team templates of a folder: the repository's, then the home's of another id. */
export function listTemplates(cwd?: string): { templates: TeamTemplate[]; problems: DefinitionProblem[] } {
  const templates = new Map<string, TeamTemplate>(); const problems: DefinitionProblem[] = [];
  for (const { dir, source } of definitionDirs('teams', cwd)) {
    for (const path of definitionFiles(dir, ['.yaml', '.yml'])) {
      const id = path.slice(dir.length + 1).replace(/\.ya?ml$/, '');
      if (templates.has(id)) continue;
      const t = loadTemplate(id, path, source, problems);
      if (t) templates.set(id, t);
    }
  }
  return { templates: [...templates.values()].sort((a, b) => a.id.localeCompare(b.id)), problems };
}

/** A seat as it is launched: the seat's agent, model and effort, else the role's, else the form's defaults (§3.2). */
export interface ResolvedSeat { role: Role; tool: Tool; model?: string; effort?: string; name?: string }
export function resolveSeats(seats: readonly Seat[], roles: readonly Role[], defaults: { tool: Tool; model?: string; effort?: string } = { tool: 'claude' }): ResolvedSeat[] | { unknown: string[] } {
  const byId = new Map(roles.map(r => [r.id, r]));
  const unknown = seats.filter(s => !byId.has(s.role)).map(s => s.role);
  if (unknown.length) return { unknown };
  return seats.map(s => {
    const role = byId.get(s.role)!;
    const tool = s.tool ?? role.tool ?? defaults.tool;
    // A model or effort is the agent's: one picked for another agent is not carried over.
    const own = s.tool === undefined || s.tool === role.tool;
    const model = s.model ?? (own ? role.model : undefined) ?? (tool === defaults.tool ? defaults.model : undefined);
    const effort = s.effort ?? (own ? role.effort : undefined) ?? (tool === defaults.tool ? defaults.effort : undefined);
    return { role, tool, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(s.name ? { name: s.name } : {}) };
  });
}

/** The roles and the templates of a folder at once, as `roles.list` answers. */
export function listDefinitions(cwd?: string): { roles: Role[]; templates: TeamTemplate[]; problems: DefinitionProblem[] } {
  const r = listRoles(cwd); const t = listTemplates(cwd);
  return { roles: r.roles, templates: t.templates, problems: [...r.problems, ...t.problems] };
}

/** A file name from a team name: lower case, letters, digits and dashes. */
export function templateId(name: string): string {
  const id = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return id || 'team';
}

const SEAT_KEYS = ['role', 'tool', 'model', 'effort', 'name'] as const;

/** The YAML of a template, seats as blocks (a name may hold `,` or `}`); null when a value cannot be written: a quote of each
 *  kind, a line break, or a tab (the parser refuses tabs). */
export function templateText(name: string, seats: readonly Seat[]): string | null {
  const q = (v: string) => (v.includes('\t') ? null : quoteScalar(v));
  const head = q(name);
  if (head === null) return null;
  const lines = [`name: ${head}`, 'seats:'];
  for (const s of seats) {
    let first = true;
    for (const k of SEAT_KEYS) {
      if (s[k] === undefined) continue;
      const v = q(String(s[k]));
      if (v === null) return null;
      lines.push(`${first ? '  - ' : '    '}${k}: ${v}`);
      first = false;
    }
  }
  return `${lines.join('\n')}\n`;
}

const templatePath = (name: string, dir: string) => join(dir, `${templateId(name)}.yaml`);
/** Whether `saveTemplate(name)` would replace a template already saved. */
export const templateExists = (name: string, dir = join(ledgeDir(), 'teams')): boolean => existsSync(templatePath(name, dir));

/** The chat's « Enregistrer » (§3.8): an ad hoc team written to `~/.ledge/teams/<id>.yaml`, a template from then on. */
export function saveTemplate(name: string, seats: readonly Seat[], dir = join(ledgeDir(), 'teams')): string {
  const path = templatePath(name, dir);
  const text = templateText(name, seats);
  if (text === null) throw new Error('a team name or seat value cannot be written as YAML');
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return path;
}
