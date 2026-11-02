import { RIG_POLICIES, type Projects, type RigLaunch, type RigPolicy, type RigSpec } from '@ledge/protocol';

/**
 * « Lancer un rig » in the TUI (docs/mockups/ledge-openrig.html, view 4, « Lancer un rig (+) »): the form's fields, what
 * its keys change, and the `RigLaunch` it sends. Pure: the screen draws it, the daemon composes the spec.
 */

export type Runtime = 'claude-code' | 'codex';
export const RUNTIMES: readonly Runtime[] = ['claude-code', 'codex'];
export type Delegation = 'pairs' | 'all';

/** A role of the spec: `pod.member`, its harness and model as the spec sets them. */
export interface Role { role: string; pod: string; member: string; agent: string; runtime: string; model?: string; /** Its policy as the spec writes it. */ policy?: string }

/** The person's specs first, then OpenRig's, each by name. */
export const orderSpecs = (specs: readonly RigSpec[]): RigSpec[] =>
  [...specs].sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'user' ? -1 : b.source === 'user' ? 1 : a.source.localeCompare(b.source)));

export const rolesOf = (spec: RigSpec | undefined): Role[] =>
  (spec?.pods ?? []).flatMap(p => p.members.map(m => ({ role: `${p.id}.${m.id}`, pod: p.id, member: m.id, agent: m.agent, runtime: m.runtime, ...(m.model ? { model: m.model } : {}), ...(m.policy ? { policy: m.policy } : {}) })));

/** What the form holds. `name` null: the spec's own name. Per role: `seats` (1 when absent), `runtimes` and `models` when changed. */
export interface RigForm {
  spec: string | null; cwd: string; name: string | null;
  seats: Record<string, number>; runtimes: Record<string, Runtime>; models: Record<string, string>;
  delegation: Delegation; save: boolean;
  /** The rig's permission policy in place of the spec's (null: the spec's); a role's over it; `nonInterruptive`: accept the
   *  first-launch warnings, sent only when YOLO is chosen somewhere. */
  policy: RigPolicy | null; policies: Record<string, RigPolicy>; nonInterruptive: boolean;
}
export const emptyForm = (spec: string | null, cwd = ''): RigForm => ({ spec, cwd, name: null, seats: {}, runtimes: {}, models: {}, delegation: 'pairs', save: false, policy: null, policies: {}, nonInterruptive: false });

/** Another spec: its roles start over (seats, harnesses, models); the folder and a name typed stay. */
export const withSpec = (f: RigForm, spec: string): RigForm => ({ ...f, spec, seats: {}, runtimes: {}, models: {}, policies: {} });

/** ← → on the permissions: the spec's (null), then each policy. */
export function withPolicy(f: RigForm, by: number): RigForm {
  const all: Array<RigPolicy | null> = [null, ...RIG_POLICIES];
  return { ...f, policy: all[(all.indexOf(f.policy) + by + all.length) % all.length]! };
}
/** `o` on a role: as the rig (none), then each policy. */
export function withRolePolicy(f: RigForm, role: string): RigForm {
  const all: Array<RigPolicy | undefined> = [undefined, ...RIG_POLICIES];
  const next = all[(all.indexOf(f.policies[role]) + 1) % all.length];
  const { [role]: _gone, ...rest } = f.policies;
  return { ...f, policies: next ? { ...rest, [role]: next } : rest };
}
/** YOLO is chosen for the rig or a role still in the spec. */
export const yoloChosen = (f: RigForm, roles: readonly Role[]): boolean => f.policy === 'yolo' || roles.some(r => f.policies[r.role] === 'yolo');

export const seatsOf = (f: RigForm, role: string): number => f.seats[role] ?? 1;
/** - + on a role: 0 to 9 seats. */
export const withSeats = (f: RigForm, role: string, by: number): RigForm => ({ ...f, seats: { ...f.seats, [role]: Math.max(0, Math.min(9, seatsOf(f, role) + by)) } });
export const runtimeOf = (f: RigForm, r: Role): string => f.runtimes[r.role] ?? r.runtime;
/** ← → on a role: the next harness Ledge can launch; one back on the spec's own is no change. */
export function withRuntime(f: RigForm, r: Role, by: number): RigForm {
  const cur = runtimeOf(f, r), i = RUNTIMES.indexOf(cur as Runtime);
  const next = RUNTIMES[((i < 0 ? (by > 0 ? -1 : 0) : i) + by + RUNTIMES.length) % RUNTIMES.length]!;
  const { [r.role]: _gone, ...rest } = f.runtimes;
  return { ...f, runtimes: next === r.runtime ? rest : { ...rest, [r.role]: next } };
}
export const modelOf = (f: RigForm, r: Role): string | undefined => f.models[r.role] ?? r.model;
/** A model typed for a role; empty: the spec's (or the harness's default). */
export function withModel(f: RigForm, r: Role, model: string): RigForm {
  const { [r.role]: _gone, ...rest } = f.models;
  const m = model.trim();
  return { ...f, models: m && m !== r.model ? { ...rest, [r.role]: m } : rest };
}

export const totalSeats = (f: RigForm, roles: readonly Role[]): number => roles.reduce((n, r) => n + seatsOf(f, r.role), 0);
/** A role has more than one seat: how the added ones delegate matters. */
export const scaled = (f: RigForm, roles: readonly Role[]): boolean => roles.some(r => seatsOf(f, r.role) > 1);

/** The rig's name: the one typed, else the spec's. */
export const nameOf = (f: RigForm): string => (f.name?.trim() || f.spec || '');

/** What is missing before a check or a launch, or null. */
export function missingOf(f: RigForm, roles: readonly Role[]): 'spec' | 'cwd' | 'name' | 'seats' | null {
  if (!f.spec) return 'spec';
  if (!f.cwd.trim()) return 'cwd';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nameOf(f))) return 'name';
  if (totalSeats(f, roles) === 0) return 'seats';
  return null;
}

/** The `RigLaunch` the form sends: only what differs from the spec. */
export function launchOf(f: RigForm, roles: readonly Role[], plan: boolean): RigLaunch {
  const seats = Object.fromEntries(roles.filter(r => seatsOf(f, r.role) !== 1).map(r => [r.role, seatsOf(f, r.role)]));
  const runtimes = Object.fromEntries(roles.filter(r => f.runtimes[r.role]).map(r => [r.role, f.runtimes[r.role]!]));
  const models = Object.fromEntries(roles.filter(r => f.models[r.role]).map(r => [r.role, f.models[r.role]!]));
  const policies = Object.fromEntries(roles.filter(r => f.policies[r.role]).map(r => [r.role, f.policies[r.role]!]));
  return {
    spec: f.spec!, cwd: f.cwd.trim(), name: nameOf(f),
    ...(Object.keys(seats).length ? { seats } : {}), ...(Object.keys(runtimes).length ? { runtimes } : {}), ...(Object.keys(models).length ? { models } : {}),
    ...(f.policy ? { policy: f.policy } : {}), ...(Object.keys(policies).length ? { policies } : {}),
    ...(f.nonInterruptive && yoloChosen(f, roles) ? { nonInterruptive: true } : {}),
    ...(scaled(f, roles) ? { delegation: f.delegation } : {}), ...(f.save ? { save: true } : {}), ...(plan ? { plan: true } : {})
  };
}

/** The folders offered: each Ledge project's folders on this machine, `name` the project's. */
export const folderChoices = (projects: Projects | null, machine: string | null): Array<{ project: string; path: string }> =>
  (projects?.projects ?? []).flatMap(p => p.repos.filter(r => r.machine === machine).map(r => ({ project: p.name, path: r.path })));

/** ← → on the folder: the next offered one (the first when the one typed is none of them). */
export function nextFolder(choices: ReadonlyArray<{ path: string }>, cwd: string, by: number): string {
  if (!choices.length) return cwd;
  const i = choices.findIndex(c => c.path === cwd);
  return choices[i < 0 ? (by > 0 ? 0 : choices.length - 1) : (i + by + choices.length) % choices.length]!.path;
}

/** Warnings as the preview lists them: the same message for several seats (`dev.build: permission_policy absent; …`) on one
 *  line with the seats it names; others as they are. */
export function warningLines(warnings: readonly string[]): Array<{ text: string; seats: string[] }> {
  const groups = new Map<string, string[]>();
  for (const w of warnings) {
    const m = /^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+):\s*(.+)$/.exec(w.trim());
    const key = m ? m[2]! : w.trim(), who = m ? [m[1]!] : [];
    groups.set(key, [...(groups.get(key) ?? []), ...who]);
  }
  return [...groups].map(([text, seats]) => ({ text, seats }));
}

/** The form's fields, in tab order: one per role between the name and the delegation. */
export type FieldId = 'spec' | 'cwd' | 'name' | `role:${number}` | 'policy' | 'nonInterruptive' | 'delegation' | 'save';
/** `yolo`: YOLO is chosen somewhere, so the first-launch warnings' box is there. */
export const fieldsOf = (roles: readonly Role[], yolo = false): FieldId[] =>
  ['spec', 'cwd', 'name', ...roles.map((_, i) => `role:${i}` as const), 'policy', ...(yolo ? ['nonInterruptive' as const] : []), 'delegation', 'save'];
export const roleAt = (field: FieldId): number | null => (field.startsWith('role:') ? Number(field.slice(5)) : null);
/** The next field by `by`, wrapping; the first when `cur` is gone (the spec changed). */
export function moveField(fields: readonly FieldId[], cur: FieldId, by: number): FieldId {
  const i = fields.indexOf(cur);
  return fields[i < 0 ? 0 : (i + by + fields.length) % fields.length]!;
}
/** The fields keys type into: printable keys there are text, not shortcuts. */
export const isText = (field: FieldId): boolean => field === 'cwd' || field === 'name';
