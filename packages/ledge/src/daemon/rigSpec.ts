import { isAbsolute, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import type { RigLaunch, RigLink, RigSpec } from '@ledge/protocol';

/**
 * A rig spec as the launch form needs it (docs/mockups/ledge-openrig.html, view 6), and the spec a launch composes when the
 * person changes how many seats a role has: each extra seat copies the role's first one (`build-2`, `build-3`), the delegation
 * links follow (`pairs` or `all`), and the `local:` agent paths become absolute so the spec still resolves outside its folder.
 * OpenRig's spec format: ~/.openrig/reference/rig-spec.md.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The agent a member runs, as a short name: the last folder of its `agent_ref`. */
const agentName = (ref: unknown): string => (str(ref) ?? '').replace(/^(local|path|builtin):/, '').split('/').filter(Boolean).at(-1) ?? '';

/** The spec's roles and links, from its YAML; null when it is not a rig spec (no pods). */
export function readSpec(yaml: string, entry: { name: string; source: string; path: string; summary?: string }): RigSpec | null {
  let doc: unknown;
  try { doc = parse(yaml); } catch { return null; }
  const d = obj(doc), pods = arr(d.pods);
  if (pods.length === 0) return null;
  let edges = arr(d.edges).length;
  const links: RigLink[] = [];
  const link = (from: string | undefined, to: string | undefined, kind: string | undefined) => { if (from && to && kind) links.push({ from, to, kind }); };
  const out = pods.map(p => {
    const pod = obj(p); edges += arr(pod.edges).length;
    const pid = str(pod.id);
    if (pid) for (const e of arr(pod.edges).map(obj)) link(str(e.from) && `${pid}.${str(e.from)}`, str(e.to) && `${pid}.${str(e.to)}`, str(e.kind));
    return {
      id: str(pod.id) ?? '', ...(str(pod.label) ? { label: str(pod.label)! } : {}),
      members: arr(pod.members).map(m => { const x = obj(m); return { id: str(x.id) ?? '', runtime: str(x.runtime) ?? 'unknown', ...(str(x.model) ? { model: str(x.model)! } : {}), agent: agentName(x.agent_ref), ...(str(x.permission_policy) ? { policy: str(x.permission_policy)! } : {}) }; }).filter(m => m.id)
    };
  }).filter(p => p.id);
  for (const e of arr(d.edges).map(obj)) link(str(e.from), str(e.to), str(e.kind));
  const summary = entry.summary ?? str(d.summary)?.trim();
  return { name: entry.name, source: entry.source, path: entry.path, ...(summary ? { summary } : {}), ...(str(d.permission_policy) ? { policy: str(d.permission_policy)! } : {}), pods: out, edges, links };
}

export { changesSpec } from '@ledge/protocol';

/** `build`, `build-2`, `build-3`: the ids of a role's `n` seats. */
export const seatIds = (id: string, n: number): string[] => Array.from({ length: n }, (_, i) => (i === 0 ? id : `${id}-${i + 1}`));

/** The links between the copies of `from` and of `to`: by pairs (the k-th to the k-th, the rest to the last), or each to each. */
export function expandEdge(from: string[], to: string[], mode: 'pairs' | 'all'): Array<[string, string]> {
  if (from.length === 0 || to.length === 0) return [];
  if (mode === 'all') return from.flatMap(f => to.map(t => [f, t] as [string, string]));
  return from.map((f, i) => [f, to[Math.min(i, to.length - 1)]!] as [string, string]);
}

/**
 * The spec a launch composes from `base` (its parsed YAML, from folder `baseDir`): named `l.name`, each role with its count of
 * seats (a role at 0 leaves with its links), the harness and model asked, the links expanded, the `local:` agents made absolute.
 * Returns the YAML and how many seats it has. Throws on a spec without pods.
 */
export function composeSpec(base: unknown, baseDir: string, l: RigLaunch): { yaml: string; seats: number } {
  const d = structuredClone(obj(base));
  const pods = arr(d.pods);
  if (pods.length === 0) throw new Error('not a rig spec');
  const mode = l.delegation ?? 'pairs';
  /** `pod.member` -> the ids of its seats. */
  const ids = new Map<string, string[]>();
  let seats = 0;
  for (const p of pods) {
    const pod = obj(p), pid = str(pod.id) ?? '';
    const members: unknown[] = [];
    for (const m of arr(pod.members)) {
      const member = obj(m), id = str(member.id) ?? '', role = `${pid}.${id}`;
      const n = l.seats?.[role] ?? 1;
      const runtime = l.runtimes?.[role], model = l.models?.[role];
      const ref = str(member.agent_ref);
      if (ref?.startsWith('local:')) { const rel = ref.slice('local:'.length); member.agent_ref = `path:${isAbsolute(rel) ? rel : resolve(baseDir, rel)}`; }
      if (runtime && runtime !== member.runtime) { member.runtime = runtime; delete member.model; delete member.codex_config_profile; }
      if (model) member.model = model;
      const policy = l.policies?.[role];
      if (policy) member.permission_policy = `builtin:${policy}`;
      ids.set(role, seatIds(id, n));
      for (const sid of seatIds(id, n)) { members.push({ ...structuredClone(member), id: sid }); seats++; }
    }
    pod.members = members;
    pod.edges = arr(pod.edges).flatMap(e => {
      const edge = obj(e), from = ids.get(`${pid}.${str(edge.from)}`) ?? [], to = ids.get(`${pid}.${str(edge.to)}`) ?? [];
      return expandEdge(from, to, mode).map(([f, t]) => ({ ...edge, from: f, to: t }));
    });
  }
  // Cross-pod links name `pod.member`.
  const qualified = (role: string): string[] => { const [pod] = role.split('.'); return (ids.get(role) ?? []).map(id => `${pod}.${id}`); };
  d.edges = arr(d.edges).flatMap(e => {
    const edge = obj(e);
    return expandEdge(qualified(str(edge.from) ?? ''), qualified(str(edge.to) ?? ''), mode).map(([f, t]) => ({ ...edge, from: f, to: t }));
  });
  if (l.policy) d.permission_policy = `builtin:${l.policy}`;
  d.name = l.name;
  return { yaml: `# Composed by Ledge from the spec "${l.spec}".\n${stringify(d, { lineWidth: 0 })}`, seats };
}

/** How many seats a spec launches unchanged. */
export const specSeats = (s: RigSpec): number => s.pods.reduce((n, p) => n + p.members.length, 0);

// ── Lot 3: changing a running rig's seats ──

const snake = (k: string): string => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
/** `rig spec show --json` speaks camelCase, `rig add` takes the spec's snake_case: keys converted at every level, except
 *  the variable names of an `env`, kept as written. */
export function snakeKeys(v: unknown, inEnv = false): unknown {
  if (Array.isArray(v)) return v.map(x => snakeKeys(x));
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [inEnv ? k : snake(k), snakeKeys(x, !inEnv && k === 'env')]));
}

/** A member of `rig spec show --json` (pod `pod`, id `member`), or null. */
export function memberOf(show: unknown, pod: string, member: string): Json | null {
  const p = arr(obj(show).pods).map(obj).find(x => x.id === pod);
  return p ? arr(p.members).map(obj).find(m => m.id === member) ?? null : null;
}

/** The fragment `rig add` takes for a copy of `member` named `id`: its fields in snake_case, its `local:` agent made absolute
 *  from the rig's folder `root` (null when unknown: then a `local:` agent cannot be copied, and the fragment is null). */
export function fragmentOf(member: Json, id: string, root: string | null): Json | null {
  const f = snakeKeys(member) as Json;
  const ref = str(f.agent_ref);
  if (ref?.startsWith('local:')) {
    const rel = ref.slice('local:'.length);
    if (!isAbsolute(rel) && root === null) return null;
    f.agent_ref = `path:${isAbsolute(rel) ? rel : resolve(root!, rel)}`;
  }
  return { ...f, id };
}

/** The links a rig should have between the seats of its roles once `seats` (role -> its seats as `pod.member`) are reached:
 *  each link of the spec (`rig spec show --json`) that touches one of `roles`, expanded like a launch's (`pairs` or `all`). */
export function linksFor(show: unknown, seats: Map<string, string[]>, roles: ReadonlySet<string>, mode: 'pairs' | 'all'): Array<{ from: string; to: string; kind: string }> {
  const out: Array<{ from: string; to: string; kind: string }> = [];
  const add = (from: string, to: string, kind: string) => {
    if (!roles.has(from) && !roles.has(to)) return;
    for (const [f, t] of expandEdge(seats.get(from) ?? [], seats.get(to) ?? [], mode)) out.push({ from: f, to: t, kind });
  };
  for (const p of arr(obj(show).pods).map(obj)) for (const e of arr(p.edges).map(obj)) add(`${str(p.id)}.${str(e.from)}`, `${str(p.id)}.${str(e.to)}`, str(e.kind) ?? 'delegates_to');
  for (const e of arr(obj(show).edges).map(obj)) add(str(e.from) ?? '', str(e.to) ?? '', str(e.kind) ?? 'delegates_to');
  return out;
}
