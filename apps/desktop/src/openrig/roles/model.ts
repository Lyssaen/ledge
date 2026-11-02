import type { Origin, RoleDetail, RoleProfile, RoleSeat, RoleSummary, StartupEntry } from '@ledge/protocol';

/**
 * What the Roles view (docs/mockups/ledge-openrig-roles.html) shows, as pure functions: the React view only draws them.
 * Read-only: nothing here changes a spec.
 */

/** A value's provenance as the screen marks it: rail and badge. */
export type Prov = 'here' | 'inh' | 'abs' | 'unk';
export const provOf = (o: Origin): Prov => (o.kind === 'here' ? 'here' : o.kind === 'inherited' ? 'inh' : o.kind === 'absent' ? 'abs' : 'unk');

export type RoleFilter = 'all' | 'used' | 'mine' | 'builtin';
export const ROLE_FILTERS: readonly RoleFilter[] = ['all', 'used', 'mine', 'builtin'];

/** Search covers the name, the summary, the skills and the startup files. */
export function matches(r: RoleSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [r.name, r.id, r.description ?? '', ...r.skills, ...r.startupFiles].some(x => x.toLowerCase().includes(q));
}

/** The list's two groups, « Mes specs » then « Livrés avec OpenRig », each by name. */
export function groupRoles(roles: readonly RoleSummary[], filter: RoleFilter, query: string): { mine: RoleSummary[]; builtin: RoleSummary[] } {
  const kept = roles.filter(r => matches(r, query) && (filter !== 'used' || r.seats > 0)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    mine: filter === 'builtin' ? [] : kept.filter(r => r.source === 'user'),
    builtin: filter === 'mine' ? [] : kept.filter(r => r.source === 'builtin')
  };
}

/** A seat's key in the navigation, `rig/logicalId`. */
export const seatKey = (s: { rig: string; logicalId: string }): string => `${s.rig}/${s.logicalId}`;
export const seatOf = (d: RoleDetail, key: string | undefined): RoleSeat | undefined => (key ? d.seats.find(s => seatKey(s) === key) : undefined);
/** The seat's name in « Vu depuis »: its logical id, with its rig when two rigs have one of that name. */
export const seatName = (d: RoleDetail, s: RoleSeat): string => (d.seats.filter(x => x.logicalId === s.logicalId).length > 1 ? `${s.logicalId} · ${s.rig}` : s.logicalId);

/** The role (library id) each seat of a rig runs, `rig/logicalId` -> role, from the list's `seatRefs`. */
export function rolesBySeat(roles: readonly RoleSummary[]): Map<string, RoleSummary> {
  const m = new Map<string, RoleSummary>();
  for (const r of roles) for (const s of r.seatRefs) m.set(seatKey(s), r);
  return m;
}

/** The profile shown: the seat's when seen from a seat, else the one chosen, else the first. */
export function profileOf(d: RoleDetail, name: string | undefined, seat?: RoleSeat): RoleProfile | undefined {
  const want = seat?.profile ?? name;
  return d.profiles.find(p => p.name === want) ?? d.profiles.find(p => p.name === 'default') ?? d.profiles[0];
}

export const baseName = (p: string): string => p.slice(p.replace(/[\\/]+$/, '').search(/[^\\/]*$/));
export const isRoleDoc = (e: StartupEntry): boolean => e.kind === 'file' && (e.orientation === 'role' || (!!e.path && baseName(e.path) === 'role.md'));

/**
 * The Role tab: the role's own words. From a seat, what OpenRig lists for it (role.md then the seat's files); from the
 * spec, the profile's startup files, role.md first. A role.md declared but not in the startup still opens first.
 */
export function roleDocs(d: RoleDetail, profile: RoleProfile | undefined, seat: RoleSeat | undefined): StartupEntry[] {
  if (seat) return seat.roleDocs;
  const files = (profile?.startup ?? []).filter(e => e.kind === 'file');
  const role = files.filter(isRoleDoc), rest = files.filter(e => !isRoleDoc(e));
  if (role.length === 0 && d.role) {
    return [{ kind: 'file', path: d.role.path, absolutePath: d.role.absolutePath, layer: 'agent', layerInferred: false, delivery: 'auto', appliesOn: [], origin: d.role.origin }, ...rest];
  }
  return [...role, ...rest];
}

/** A piece of the startup context: an entry OpenRig lists, or the harness's own prompt, which no source gives. */
export type Piece = { kind: 'harness' } | { kind: 'entry'; entry: StartupEntry };

/** The startup context, in the order OpenRig returns it: from the spec, only the role's share. */
export function pieces(d: RoleDetail, profile: RoleProfile | undefined, seat: RoleSeat | undefined): Piece[] {
  const own = profile?.startup ?? [];
  if (!seat) return own.map(entry => ({ kind: 'entry', entry }));
  const entries = seat.live?.startup ?? [...own, ...seat.memberStartup];
  return [...(d.unavailable.includes('harness_prompt') ? [{ kind: 'harness' } as const] : []), ...entries.map(entry => ({ kind: 'entry' as const, entry }))];
}

/** A merged block OpenRig planned for CLAUDE.md / AGENTS.md that is not there: the plan is not proof of delivery. */
export const isMissing = (e: StartupEntry): boolean => e.delivered === false || (e.origin.kind === 'unknown' && e.origin.why === 'missing_from_guidance');
export type Channel = 'send' | 'merge' | 'action' | 'other';
export const channelOf = (e: StartupEntry): Channel => (e.kind === 'action' ? 'action' : e.delivery === 'send_text' ? 'send' : e.delivery === 'guidance_merge' ? 'merge' : 'other');

/** Which title a piece gets: OpenRig's own files and the seat's are named, anything else by its file name. */
export type PieceTitle = 'role' | 'cultureDefault' | 'culture' | 'scope' | 'start' | 'onb1' | 'onb2' | 'skills' | 'identity' | null;
export function pieceTitle(e: StartupEntry): PieceTitle {
  if (e.kind === 'action') return e.builtin === 'session_identity' || e.builtin === 'identity' ? 'identity' : null;
  const name = baseName(e.path ?? '');
  if (isRoleDoc(e)) return 'role';
  if (name === 'CULTURE-default.md') return 'cultureDefault';
  if (name === 'openrig-start.md') return 'start';
  if (name === 'openrig-onboarding-01.md') return 'onb1';
  if (name === 'openrig-onboarding-02.md') return 'onb2';
  if (name === 'openrig-seat-skills.md') return 'skills';
  if (e.layer === 'culture' || name === 'CULTURE.md') return 'culture';
  if (e.layer === 'member') return 'scope';
  return null;
}

/** `appliesOn` as a tag: first start only, also on resume, on resume only. */
export function appliesOf(on: readonly string[]): 'fresh' | 'both' | 'restore' | null {
  const fresh = on.includes('fresh_start'), restore = on.includes('restore');
  return fresh && restore ? 'both' : fresh ? 'fresh' : restore ? 'restore' : null;
}

/** A size as the screen shows it: `1,8 ko`, `1.8 KB`. */
export function formatSize(bytes: number | undefined, lang: string): string {
  if (bytes === undefined) return '—';
  const fr = lang === 'fr';
  if (bytes < 1024) return `${bytes} ${fr ? 'o' : 'B'}`;
  const k = (bytes / 1024).toFixed(1);
  return `${fr ? k.replace('.', ',') : k} ${fr ? 'ko' : 'KB'}`;
}

/** The YAML key an origin names, when it does. */
export const keyOf = (o: Origin): string | undefined => (o.kind === 'here' || o.kind === 'inherited' ? o.key : undefined);

/** The models a role's seats run today, for « the role sets no model ». */
export function seatModels(d: RoleDetail): { models: string[]; seats: string[] } {
  const models = [...new Set(d.seats.map(s => s.model.value).filter((m): m is string => !!m))];
  return { models, seats: d.seats.map(s => s.logicalId) };
}

/** Line diff of two small files (LCS), for « Voir les différences » between the library and the repository. */
export function lineDiff(a: string, b: string): Array<{ op: ' ' | '-' | '+'; text: string }> {
  const x = a.split('\n'), y = b.split('\n');
  const n = x.length, m = y.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i]![j] = x[i] === y[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  const out: Array<{ op: ' ' | '-' | '+'; text: string }> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ op: ' ', text: x[i]! }); i++; j++; }
    else if (L[i + 1]![j]! >= L[i]![j + 1]!) out.push({ op: '-', text: x[i++]! });
    else out.push({ op: '+', text: y[j++]! });
  }
  while (i < n) out.push({ op: '-', text: x[i++]! });
  while (j < m) out.push({ op: '+', text: y[j++]! });
  return out;
}

/** A path under the home folder as `~/…`. */
export const tilde = (p: string): string => p.replace(/^\/home\/[^/]+(?=\/|$)/, '~').replace(/^\/root(?=\/|$)/, '~');
