import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify, YAMLParseError } from 'yaml';
import type { Origin, RoleDetail, RoleFileError, RoleImport, RoleProfile, RoleResource, RoleResourceCategory, RoleSeat, RoleSummary, RoleUsesList, SourcedString, StartupEntry, StartupLayer } from '@ledge/protocol';

/**
 * OpenRig roles (agent specs), read-only: the « from the spec » lens Ledge resolves from the YAML by OpenRig's documented
 * rules (daemon/docs/reference/agent-spec.md, Imports and Profiles), and the « from a seat » lens it takes from OpenRig's
 * node detail, only sorting each startup piece into a layer. Contract: docs/superpowers/specs/2026-11-02-openrig-roles-data.md.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Files as the role builder reads them; `null` when absent or unreadable. */
export interface RoleIo {
  read(path: string): Promise<string | null>;
  stat(path: string): Promise<{ size: number; mtimeMs: number; file: boolean } | null>;
}

/** An agent spec of the library, as `rig specs ls --kind agent --json` lists it. */
export interface LibraryEntry { id: string; name: string; version?: string; source: 'builtin' | 'user'; path: string; relativePath?: string; summary?: string }

export function readLibrary(listed: unknown): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const raw of arr(listed)) {
    const e = obj(raw), id = str(e.id), name = str(e.name), path = str(e.resolvedSourcePath) ?? str(e.sourcePath);
    if (e.kind !== 'agent' || !id || !name || !path) continue;
    out.push({ id, name, path, source: e.sourceType === 'builtin' ? 'builtin' : 'user',
      ...(str(e.version) ? { version: str(e.version)! } : {}), ...(str(e.relativePath) ? { relativePath: str(e.relativePath)! } : {}),
      ...(str(e.summary) ? { summary: str(e.summary)!.trim() } : {}) });
  }
  return out;
}

export type ParsedSpec = { ok: true; doc: Obj } | { ok: false; error: RoleFileError };

/** An agent.yaml read, or why not: `missing` (no text), `invalid` with the parser's line and column. */
export function parseSpec(text: string | null): ParsedSpec {
  if (text === null) return { ok: false, error: { kind: 'missing', message: 'file not found' } };
  try {
    const doc = parseYaml(text);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: { kind: 'invalid', message: 'not a YAML mapping' } };
    return { ok: true, doc: doc as Obj };
  } catch (e) {
    const pos = e instanceof YAMLParseError ? e.linePos?.[0] : undefined;
    const message = ((e as Error).message ?? String(e)).split('\n')[0]!;
    return { ok: false, error: { kind: 'invalid', message, ...(pos ? { line: pos.line, col: pos.col } : {}) } };
  }
}

/** `~/x`, `openrig-home:x` (OpenRig's home), a path relative to the spec's folder, or an absolute one. */
export function specPath(p: string, specDir: string, home: string, openrigHome: string): string {
  if (p.startsWith('openrig-home:')) return join(openrigHome, p.slice('openrig-home:'.length));
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return isAbsolute(p) ? resolve(p) : resolve(specDir, p);
}

/** Where an import ref points: `local:` relative to the importing spec's folder, `path:` absolute; a folder means its agent.yaml. */
export function importPath(ref: string, specDir: string): string | null {
  const p = ref.startsWith('local:') ? resolve(specDir, ref.slice(6)) : ref.startsWith('path:') ? resolve(ref.slice(5)) : null;
  if (!p) return null;
  return /\.ya?ml$/i.test(p) ? p : join(p, 'agent.yaml');
}

const CATEGORIES: Array<{ cat: RoleResourceCategory; key: string; uses: keyof RoleProfile['uses'] }> = [
  { cat: 'skill', key: 'skills', uses: 'skills' }, { cat: 'guidance', key: 'guidance', uses: 'guidance' },
  { cat: 'subagent', key: 'subagents', uses: 'subagents' }, { cat: 'plugin', key: 'plugins', uses: 'plugins' },
  { cat: 'runtime_resource', key: 'runtime_resources', uses: 'runtimeResources' }
];

/** Where OpenRig merges each known runtime resource type (agent-spec.md, Resource Categories). */
const TARGETS: Record<string, string> = {
  claude_settings_fragment: '<cwd>/.claude/settings.local.json', claude_activity_hooks: '<cwd>/.claude/settings.local.json',
  claude_mcp_fragment: '<cwd>/.mcp.json', codex_config_fragment: '$CODEX_HOME/config.toml'
};

interface Ctx { home: string; openrigHome: string }
/** A spec Ledge read: its file, folder and document. */
interface Spec { path: string; dir: string; doc: Obj }

/** The resources a spec declares, `id` qualified by `ns` when given (an import's), each `here` in its own file. */
function declared(spec: Spec, ctx: Ctx, ns?: string, origin?: Origin): RoleResource[] {
  const out: RoleResource[] = [];
  const res = obj(spec.doc.resources);
  for (const { cat, key } of CATEGORIES) {
    arr(res[key]).forEach((raw, i) => {
      const r = typeof raw === 'string' ? { id: raw, path: raw } as Obj : obj(raw);
      const id = str(r.id) ?? (str(r.path) ? basename(str(r.path)!) : undefined);
      if (!id) return;
      const path = cat === 'plugin' ? str(obj(r.source).path) : str(r.path);
      const type = str(r.type), runtime = str(r.runtime);
      out.push({ category: cat, id: ns ? `${ns}:${id}` : id,
        ...(path ? { path, absolutePath: specPath(path, spec.dir, ctx.home, ctx.openrigHome) } : {}),
        ...(runtime ? { runtime } : {}), ...(type ? { type } : {}), ...(type && TARGETS[type] ? { target: TARGETS[type] } : {}),
        origin: origin ?? { kind: 'here', key: `resources.${key}[${i}]` } });
    });
  }
  return out;
}

export interface ResolvedImports { imports: RoleImport[]; specs: Map<string, Spec>; warnings: string[] }

/** A spec's imports, each read: its namespace is the imported spec's `name`. An import of an import is not followed (OpenRig refuses it). */
export async function resolveImports(spec: Spec, io: RoleIo): Promise<ResolvedImports> {
  const imports: RoleImport[] = [], specs = new Map<string, Spec>(), warnings: string[] = [];
  for (const [i, raw] of arr(spec.doc.imports).entries()) {
    const im = obj(raw), ref = str(im.ref) ?? '', key = `imports[${i}].ref`, version = str(im.version);
    const path = ref ? importPath(ref, spec.dir) : null;
    if (!path) { imports.push({ ref, key, resolved: false, error: 'not a local: or path: ref' }); continue; }
    const parsed = parseSpec(await io.read(path));
    if (!parsed.ok) { imports.push({ ref, key, path, resolved: false, error: parsed.error.kind === 'missing' ? 'imported file not found' : parsed.error.message }); continue; }
    const name = str(parsed.doc.name);
    if (!name) { imports.push({ ref, key, path, resolved: false, error: 'imported spec has no name' }); continue; }
    if (version && str(parsed.doc.version) !== version) warnings.push(`import ${name}: version ${String(parsed.doc.version)} is not the pinned ${version}`);
    imports.push({ ref, key, name, path, resolved: true, ...(version ? { version } : {}) });
    specs.set(name, { path, dir: dirname(path), doc: parsed.doc });
  }
  return { imports, specs, warnings };
}

const sourced = (value: string | null | undefined, origin: Origin): SourcedString => ({ value: value ?? null, origin: value == null && origin.kind !== 'unknown' ? { kind: 'absent' } : origin });
const ABSENT: SourcedString = { value: null, origin: { kind: 'absent' } };

/** Startup files and actions as a spec writes them (`at`: their YAML path). */
function writtenStartup(block: unknown, at: string, layer: 'agent' | 'profile' | 'rig' | 'pod' | 'member', base: string, origin: (key: string) => Origin): StartupEntry[] {
  const b = obj(block), out: StartupEntry[] = [];
  arr(b.files).forEach((raw, i) => {
    const f = obj(raw), path = str(f.path);
    if (!path) return;
    const orientation = str(f.orientation);
    out.push({ kind: 'file', path, absolutePath: isAbsolute(path) ? path : resolve(base, path), layer, layerInferred: false,
      delivery: str(f.delivery_hint) ?? 'auto', required: f.required === true, ...(orientation ? { orientation } : {}),
      appliesOn: arr(f.applies_on).filter((x): x is string => typeof x === 'string').length ? arr(f.applies_on) as string[] : ['fresh_start', 'restore'],
      origin: origin(`${at}.files[${i}]`) });
  });
  arr(b.actions).forEach((raw, i) => {
    const a = obj(raw);
    out.push({ kind: 'action', ...(str(a.value) ? { value: str(a.value)! } : {}), layer, layerInferred: false, delivery: str(a.type) ?? 'send_text',
      appliesOn: arr(a.applies_on).length ? arr(a.applies_on) as string[] : ['fresh_start', 'restore'], origin: origin(`${at}.actions[${i}]`) });
  });
  return out;
}

/** One `uses` id: `ns:id` from that import; a bare id from the spec itself, then the one import that declares it. A skill
 *  nobody declares is looked up by OpenRig at launch; any other unknown id is `not_found`. */
function pick(id: string, cat: RoleResourceCategory, own: RoleResource[], imports: ResolvedImports, ctx: Ctx): RoleResource {
  const ofImport = (ns: string, bare: string) => {
    const spec = imports.specs.get(ns);
    if (!spec) return undefined;
    return declared(spec, ctx, ns, { kind: 'inherited', from: 'import', ref: ns, path: spec.path }).find(r => r.category === cat && r.id === `${ns}:${bare}`);
  };
  const colon = id.indexOf(':');
  if (colon > 0) {
    const ns = id.slice(0, colon), found = ofImport(ns, id.slice(colon + 1));
    if (found) return found;
    const why = imports.imports.some(i => i.name === ns) ? 'not_found' : imports.imports.some(i => !i.resolved) ? 'unreadable' : 'not_found';
    return { category: cat, id, origin: { kind: 'unknown', why, detail: why === 'unreadable' ? 'comes from an unresolved import' : `no ${cat} ${id}` } };
  }
  const mine = own.find(r => r.category === cat && r.id === id);
  if (mine) return mine;
  const theirs = [...imports.specs.keys()].map(ns => ofImport(ns, id)).filter((r): r is RoleResource => !!r);
  if (theirs.length === 1) return { ...theirs[0]!, id };
  if (theirs.length > 1) return { category: cat, id, origin: { kind: 'unknown', why: 'ambiguous', detail: theirs.map(r => r.id.split(':')[0]).join(', ') } };
  if (cat === 'skill') return { category: cat, id, origin: { kind: 'unknown', why: 'resolved_at_launch' } };
  return { category: cat, id, origin: { kind: 'unknown', why: imports.imports.some(i => !i.resolved) ? 'unreadable' : 'not_found' } };
}

/** The plugins a spec and its imports declare, by the id `rig plugin show` takes. */
export function declaredPlugins(doc: Obj, path: string, imports: ResolvedImports, home: string, openrigHome: string): string[] {
  const ctx = { home, openrigHome };
  const all = [...declared({ path, dir: dirname(path), doc }, ctx), ...[...imports.specs].flatMap(([ns, s]) => declared(s, ctx, ns))];
  return [...new Set(all.filter(r => r.category === 'plugin').map(pluginId))];
}

export interface PluginInfo { version?: string; skills: string[]; hooks: number }

/** A profile as the spec asks it: its runtime, model and effort (profile preferences over `defaults`), each `uses` list
 *  resolved, and the role's share of the startup (agent, then profile). */
export function resolveProfile(name: string, spec: Spec, imports: ResolvedImports, ctx: Ctx, plugins: Map<string, PluginInfo>): RoleProfile {
  const p = obj(obj(spec.doc.profiles)[name]), prefs = obj(p.preferences), defaults = obj(spec.doc.defaults), uses = obj(p.uses);
  const pref = (k: string): SourcedString => str(prefs[k]) ? { value: str(prefs[k])!, origin: { kind: 'here', key: `profiles.${name}.preferences.${k}` } }
    // `defaults` sits in the same file: written here (OpenRig takes no defaults from an import).
    : str(defaults[k]) ? { value: str(defaults[k])!, origin: { kind: 'here', key: `defaults.${k}` } } : ABSENT;
  const own = declared(spec, ctx);
  const list = (cat: RoleResourceCategory, key: string): RoleUsesList => ({
    declared: has(uses, key), key: `profiles.${name}.uses.${key}`,
    items: arr(uses[key]).filter((x): x is string => typeof x === 'string').map(id => withPlugin(pick(id, cat, own, imports, ctx), plugins))
  });
  const description = str(p.description) ?? str(p.summary);
  return {
    name, ...(description ? { description } : {}),
    runtime: pref('runtime'), model: pref('model'), effort: pref('effort'),
    uses: Object.fromEntries(CATEGORIES.map(c => [c.uses, list(c.cat, c.key)])) as RoleProfile['uses'],
    startup: [
      ...writtenStartup(spec.doc.startup, 'startup', 'agent', spec.dir, key => ({ kind: 'here', key })),
      ...writtenStartup(p.startup, `profiles.${name}.startup`, 'profile', spec.dir, key => ({ kind: 'here', key }))
    ]
  };
}

/** The plugin id a resource names (`openrig-core` for `shared:openrig-core`, or the last folder of its path). */
export const pluginId = (r: RoleResource): string => (r.absolutePath ? basename(r.absolutePath) : r.id.slice(r.id.indexOf(':') + 1));
function withPlugin(r: RoleResource, plugins: Map<string, PluginInfo>): RoleResource {
  if (r.category !== 'plugin') return r;
  const info = plugins.get(pluginId(r));
  return info ? { ...r, plugin: { ...(info.version ? { version: info.version } : {}), skills: info.skills, hooks: info.hooks } } : r;
}

/** What `rig plugin show <id> --json` says of a plugin. */
export function readPlugin(shown: unknown): PluginInfo | null {
  const s = obj(shown);
  if (!Array.isArray(s.skills)) return null;
  const version = str(obj(s.entry).version);
  return { ...(version ? { version } : {}), skills: arr(s.skills).map(x => str(obj(x).name) ?? str(obj(x).id) ?? str(x)).filter((x): x is string => !!x), hooks: arr(s.hooks).length };
}

/** The role's guidance file, to open first: the startup file marked `orientation: role`, else a `role.md` among its
 *  startup files or guidance, else the guidance whose id is `role`. */
export function roleGuidance(spec: Spec, ctx: Ctx): RoleDetail['role'] {
  const files = arr(obj(spec.doc.startup).files).map((f, i) => ({ f: obj(f), key: `startup.files[${i}]` }));
  for (const [name, p] of Object.entries(obj(spec.doc.profiles))) arr(obj(obj(p).startup).files).forEach((f, i) => files.push({ f: obj(f), key: `profiles.${name}.startup.files[${i}]` }));
  const at = (path: string, key: string) => ({ path, absolutePath: specPath(path, spec.dir, ctx.home, ctx.openrigHome), origin: { kind: 'here', key } as Origin });
  const byOrientation = files.find(x => x.f.orientation === 'role' && str(x.f.path));
  if (byOrientation) return at(str(byOrientation.f.path)!, byOrientation.key);
  const isRole = (p?: string) => !!p && basename(p) === 'role.md';
  const byName = files.find(x => isRole(str(x.f.path)));
  if (byName) return at(str(byName.f.path)!, byName.key);
  const guidance = arr(obj(spec.doc.resources).guidance).map((g, i) => ({ g: obj(g), key: `resources.guidance[${i}]` }));
  const g = guidance.find(x => isRole(str(x.g.path))) ?? guidance.find(x => x.g.id === 'role' && str(x.g.path));
  return g ? at(str(g.g.path)!, g.key) : null;
}

/** The skills a spec names (declared and selected) and its startup files, for the list's search. */
function searchable(doc: Obj): { skills: string[]; startupFiles: string[] } {
  const skills = new Set<string>(), files = new Set<string>();
  for (const s of arr(obj(doc.resources).skills)) { const id = typeof s === 'string' ? s : str(obj(s).id); if (id) skills.add(id); }
  const startup = (b: unknown) => { for (const f of arr(obj(b).files)) { const p = str(obj(f).path); if (p) files.add(p); } };
  startup(doc.startup);
  for (const p of Object.values(obj(doc.profiles))) {
    for (const s of arr(obj(obj(p).uses).skills)) if (typeof s === 'string') skills.add(s);
    startup(obj(p).startup);
  }
  return { skills: [...skills], startupFiles: [...files] };
}

/** How many seats run a role, how many now, and which. */
export const seatCounts = (seats: readonly KnownSeat[]) => ({ seats: seats.length, running: seats.filter(s => s.running).length,
  seatRefs: seats.map(s => ({ rig: s.rig, logicalId: s.logicalId, ...(s.session ? { session: s.session } : {}) })) });

export function isImportOnly(doc: Obj): boolean { return Object.keys(obj(doc.profiles)).length === 0; }

export function summarize(entry: LibraryEntry, parsed: ParsedSpec, seats: { seats: number; running: number; seatRefs: RoleSummary['seatRefs'] }): RoleSummary {
  const doc = parsed.ok ? parsed.doc : {};
  const version = str(doc.version) ?? entry.version, description = str(doc.description)?.trim() ?? entry.summary, runtime = str(obj(doc.defaults).runtime);
  return {
    id: entry.id, name: entry.name, source: entry.source, path: entry.path,
    ...(version ? { version } : {}), ...(description ? { description } : {}), ...(runtime ? { runtime } : {}),
    importOnly: parsed.ok ? isImportOnly(doc) : false, ...seats, ...searchable(doc),
    ...(parsed.ok ? {} : { error: parsed.error.kind })
  };
}

// ── Seats ──

/** A member of a rig known to the daemon, with what Ledge read of it: `spec` from `rig spec show` (cwd resolved, agentRef
 *  as `path:`), `written` the member and its pod in the rig's own YAML when Ledge found it (for its startup, which
 *  `rig spec show` drops), `node` OpenRig's node detail. */
export interface KnownSeat {
  rig: string; rigId: string; rigRoot: string | null; rigSpecPath?: string; composed: boolean;
  rigDoc: Obj; pod: Obj; member: Obj; written: { pod: Obj; member: Obj } | null;
  logicalId: string; agentDir: string | null;
  session?: string; running: boolean; activity: string;
  node: unknown; loadout: unknown;
}

/** The members of a rig as `rig spec show <rigId> --json` prints them, with the agent folder each runs. */
export function rigMembers(shown: unknown, rigRoot: string | null): Array<{ pod: Obj; member: Obj; logicalId: string; agentDir: string | null }> {
  const out: Array<{ pod: Obj; member: Obj; logicalId: string; agentDir: string | null }> = [];
  for (const p of arr(obj(shown).pods)) {
    const pod = obj(p), podId = str(pod.id);
    if (!podId) continue;
    for (const m of arr(pod.members)) {
      const member = obj(m), id = str(member.id), ref = str(member.agentRef) ?? str(member.agent_ref);
      if (!id) continue;
      const agentDir = !ref ? null : ref.startsWith('path:') ? resolve(ref.slice(5)) : ref.startsWith('local:') && rigRoot ? resolve(rigRoot, ref.slice(6)) : null;
      out.push({ pod, member, logicalId: `${podId}.${id}`, agentDir });
    }
  }
  return out;
}

/** The member and its pod in a rig's own YAML (snake case, as written). */
export function writtenMember(rigDoc: Obj, logicalId: string): { pod: Obj; member: Obj } | null {
  const dot = logicalId.indexOf('.'), podId = logicalId.slice(0, dot), id = logicalId.slice(dot + 1);
  for (const p of arr(rigDoc.pods)) {
    const pod = obj(p);
    if (pod.id !== podId) continue;
    const member = arr(pod.members).map(obj).find(m => m.id === id);
    if (member) return { pod, member };
  }
  return null;
}

const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** The file a Claude seat's managed blocks go to (`managed_blocks.claude-code`, CLAUDE.md by default); Codex and the others use AGENTS.md. */
export function guidanceFile(runtime: string | undefined, rigDoc: Obj): string {
  if (runtime === 'claude-code') return str(obj(rigDoc.managed_blocks)['claude-code']) ?? 'CLAUDE.md';
  return 'AGENTS.md';
}

/** OpenRig's managed block for a startup file, as it writes it into CLAUDE.md / AGENTS.md. */
export const hasManagedBlock = (text: string, path: string): boolean =>
  text.includes(`<!-- BEGIN OpenRig MANAGED BLOCK: ${path} -->`) || text.includes(`<!-- BEGIN OpenRig MANAGED BLOCK: ${basename(path)} -->`);

interface LayerCtx { agentDir: string | null; rigRoot: string | null; cultureFile?: string; profileFiles: Set<string>; memberFiles: Set<string>; podFiles: Set<string>; openrigHome: string; rig: string; logicalId: string; podId: string }

/** Which layer a startup file of a seat comes from, read from where it lives (OpenRig does not say). */
export function layerOf(ownerRoot: string | undefined, path: string, c: LayerCtx): StartupLayer {
  if (!ownerRoot) return 'unknown';
  const root = resolve(ownerRoot);
  if (c.agentDir && root === c.agentDir) return c.profileFiles.has(path) ? 'profile' : 'agent';
  if (c.rigRoot && root === c.rigRoot) return path === c.cultureFile ? 'culture' : c.memberFiles.has(path) ? 'member' : c.podFiles.has(path) ? 'pod' : 'rig';
  if (/[/\\]@openrig[/\\]cli[/\\]/.test(root) || /[/\\]daemon[/\\]assets$/.test(root)) return 'openrig';
  if (under(root, join(c.openrigHome, 'state', 'seats'))) return 'seat';
  return 'unknown';
}

function layerOrigin(layer: StartupLayer, c: LayerCtx, path: string): Origin {
  switch (layer) {
    case 'agent': return { kind: 'here', key: 'startup.files' };
    case 'profile': return { kind: 'here', key: 'profiles.startup.files' };
    case 'culture': return { kind: 'inherited', from: 'rig', ref: c.rig, key: 'culture_file', ...(c.rigRoot ? { path: join(c.rigRoot, path) } : {}) };
    case 'rig': return { kind: 'inherited', from: 'rig', ref: c.rig };
    case 'pod': return { kind: 'inherited', from: 'pod', ref: c.podId };
    case 'member': return { kind: 'inherited', from: 'member', ref: c.logicalId };
    case 'openrig': return { kind: 'inherited', from: 'openrig' };
    case 'seat': return { kind: 'inherited', from: 'seat', ref: c.logicalId };
    default: return { kind: 'unknown', why: 'not_exposed' };
  }
}

/** A role guidance startup file: marked `orientation: role`, or a `role.md`. */
const isRoleDoc = (e: StartupEntry) => e.kind === 'file' && (e.orientation === 'role' || (!!e.path && basename(e.path) === 'role.md'));

const STRINGS = (v: unknown) => arr(v).filter((x): x is string => typeof x === 'string');

/** A seat's view: what it runs (member over profile over defaults), what the member adds to the startup, and what OpenRig
 *  resolved at its launch. Only named fields of the node detail are read: its resume token, recovery commands, process
 *  evidence and events never leave. */
export async function seatView(s: KnownSeat, spec: Spec, profile: RoleProfile | undefined, io: RoleIo, openrigHome: string, plugins: Map<string, PluginInfo>): Promise<RoleSeat> {
  const m = s.written?.member ?? {}, shown = s.member, node = obj(s.node);
  const nodeOk = Object.keys(node).length > 0;
  const memberOrigin = (key: string): Origin => ({ kind: 'inherited', from: 'member', ref: s.logicalId, key });
  const runtimeV = str(m.runtime) ?? str(shown.runtime);
  const runtime: SourcedString = runtimeV ? { value: runtimeV, origin: memberOrigin('runtime') } : profile?.runtime ?? ABSENT;
  const modelV = str(m.model) ?? str(shown.model);
  const model: SourcedString = modelV ? { value: modelV, origin: memberOrigin('model') }
    : profile?.model.value ? profile.model
    : str(node.model) ? { value: str(node.model)!, origin: { kind: 'inherited', from: 'launch' } } : ABSENT;
  const effortSource = str(node.effortSource);
  const effort: SourcedString = str(m.effort) ? { value: str(m.effort)!, origin: memberOrigin('effort') }
    : str(node.effort) ? { value: str(node.effort)!, origin: { kind: 'inherited', from: 'seat', ref: effortSource ?? s.logicalId } }
    : nodeOk ? { value: null, origin: { kind: 'inherited', from: 'launch', ref: effortSource ?? 'runtime_default' } } : profile?.effort ?? ABSENT;
  const cwdV = str(node.cwd) ?? str(shown.cwd);
  const cwd: SourcedString = cwdV ? { value: cwdV, origin: memberOrigin('cwd') } : { value: null, origin: { kind: 'unknown', why: 'not_exposed' } };
  const cultureV = str(s.rigDoc.culture_file) ?? str(s.rigDoc.cultureFile);
  const cultureFile = sourced(cultureV, { kind: 'inherited', from: 'rig', ref: s.rig, key: 'culture_file', ...(cultureV && s.rigRoot ? { path: join(s.rigRoot, cultureV) } : {}) });
  const base = s.rigRoot ?? (s.rigSpecPath ? dirname(s.rigSpecPath) : '/');
  const memberStartup = writtenStartup(m.startup, 'startup', 'member', base, key => memberOrigin(key));
  const pod = s.written?.pod ?? {};
  // The runtime OpenRig launched, else the one resolved (member, profile, defaults): a member that writes none still has one.
  const effectiveRuntime = str(node.runtime) ?? runtime.value ?? undefined;
  const into = cwdV ? join(cwdV, guidanceFile(effectiveRuntime, s.rigDoc)) : undefined;
  const profileName = str(m.profile) ?? str(shown.profile) ?? 'default';
  const lc: LayerCtx = {
    agentDir: s.agentDir, rigRoot: s.rigRoot, ...(cultureV ? { cultureFile: cultureV } : {}),
    profileFiles: new Set(STRINGS(arr(obj(obj(obj(spec.doc.profiles)[profileName]).startup).files).map(f => obj(f).path))),
    memberFiles: new Set(STRINGS(arr(obj(m.startup).files).map(f => obj(f).path))),
    podFiles: new Set(STRINGS(arr(obj(pod.startup).files).map(f => obj(f).path))),
    openrigHome, rig: s.rig, logicalId: s.logicalId, podId: s.logicalId.split('.')[0]!
  };
  for (const e of memberStartup) if (e.absolutePath) { const st = await io.stat(e.absolutePath); if (st?.file) e.size = st.size; }
  const label = str(m.label) ?? str(shown.label);
  const seat: RoleSeat = {
    rig: s.rig, rigId: s.rigId, ...(s.rigSpecPath ? { rigSpecPath: s.rigSpecPath } : {}), composed: s.composed,
    logicalId: s.logicalId, ...(s.session ? { session: s.session } : {}), ...(label ? { label } : {}), profile: profileName,
    running: s.running, activity: s.activity, runtime, model, effort, cwd, cultureFile,
    ...(s.written ? { member: stringify(s.written.member, { lineWidth: 0 }) } : {}), memberStartup,
    roleDocs: [...(profile?.startup.filter(isRoleDoc) ?? []).slice(0, 1), ...memberStartup.filter(e => e.kind === 'file')]
  };
  if (!nodeOk) return seat;
  const guidance = into ? await io.read(into) : null;
  const startup: StartupEntry[] = [];
  for (const raw of arr(node.startupFiles)) {
    const f = obj(raw), path = str(f.path);
    if (!path) continue;
    const abs = str(f.absolutePath), layer = layerOf(str(f.ownerRoot), path, lc), delivery = str(f.deliveryHint) ?? 'auto';
    const delivered = delivery === 'guidance_merge' ? guidance !== null && hasManagedBlock(guidance, path) : undefined;
    const st = abs ? await io.stat(abs) : null;
    startup.push({ kind: 'file', path, ...(abs ? { absolutePath: abs } : {}), ...(st?.file ? { size: st.size } : {}),
      layer, layerInferred: true, delivery, ...(delivery === 'guidance_merge' && into ? { into } : {}), ...(delivered !== undefined ? { delivered } : {}),
      ...(typeof f.required === 'boolean' ? { required: f.required } : {}), ...(str(f.orientation) ? { orientation: str(f.orientation)! } : {}),
      appliesOn: STRINGS(f.appliesOn),
      origin: delivered === false ? { kind: 'unknown', why: 'missing_from_guidance', ...(into ? { detail: into } : {}) } : layerOrigin(layer, lc, path) });
  }
  for (const raw of arr(node.startupActions)) {
    const a = obj(raw), builtin = str(a.builtin);
    startup.push({ kind: 'action', ...(str(a.value) ? { value: str(a.value)! } : {}), ...(builtin ? { builtin } : {}),
      layer: builtin ? 'openrig' : 'unknown', layerInferred: !builtin, delivery: str(a.type) ?? 'send_text', appliesOn: STRINGS(a.appliesOn),
      origin: builtin ? { kind: 'inherited', from: 'openrig', ref: builtin } : { kind: 'unknown', why: 'not_exposed' } });
  }
  const resources: RoleResource[] = arr(node.installedResources).flatMap(raw => {
    const r = obj(raw), id = str(r.id), cat = str(r.category);
    if (!id || !cat) return [];
    const category: RoleResourceCategory = cat === 'runtime_resource' ? 'runtime_resource' : cat === 'plugin' ? 'plugin' : cat === 'skill' ? 'skill' : cat === 'subagent' ? 'subagent' : 'guidance';
    const ns = id.includes(':') ? id.slice(0, id.indexOf(':')) : undefined;
    const fromProfile = profile ? Object.values(profile.uses).flatMap(u => u.items).find(x => x.id === id) : undefined;
    const target = fromProfile?.target && cwdV ? fromProfile.target.replace('<cwd>', cwdV) : fromProfile?.target;
    const res: RoleResource = { ...(fromProfile ?? {}), category, id, ...(target ? { target } : {}),
      origin: ns ? { kind: 'inherited', from: 'import', ref: ns } : { kind: 'here' } };
    return [withPlugin(res, plugins)];
  });
  const loadout = obj(s.loadout);
  const skills = Array.isArray(loadout.skills)
    ? arr(loadout.skills).map(x => ({ id: str(obj(x).id) ?? '', ...(str(obj(x).trigger) ? { trigger: str(obj(x).trigger)! } : {}) })).filter(x => x.id) : undefined;
  const fromLive = startup.filter(e => e.kind === 'file' && (e.layer === 'member' || ((e.layer === 'agent' || e.layer === 'profile') && isRoleDoc(e))));
  if (fromLive.some(isRoleDoc)) seat.roleDocs = [...fromLive.filter(isRoleDoc).slice(0, 1), ...fromLive.filter(e => !isRoleDoc(e))];
  else if (fromLive.length) seat.roleDocs = [...seat.roleDocs.filter(isRoleDoc), ...fromLive];
  seat.live = {
    resolvedSpec: { ...(str(node.resolvedSpecName) ? { name: str(node.resolvedSpecName)! } : {}), ...(str(node.resolvedSpecVersion) ? { version: str(node.resolvedSpecVersion)! } : {}),
      ...(str(node.resolvedSpecHash) ? { hash: str(node.resolvedSpecHash)! } : {}) },
    resources, startup, ...(skills ? { skills } : {})
  };
  return seat;
}

export interface DetailInput {
  entry: LibraryEntry; text: string | null; seats: KnownSeat[]; library: Array<{ entry: LibraryEntry; parsed: ParsedSpec }>;
  plugins: Map<string, PluginInfo>; home: string; openrigHome: string; openrigVersion?: string; io: RoleIo;
}

/** One role, both lenses, and the paths of it a front may read (`files`). */
export async function buildDetail(d: DetailInput): Promise<{ detail: RoleDetail; files: Set<string> }> {
  const ctx = { home: d.home, openrigHome: d.openrigHome };
  const parsed = parseSpec(d.text);
  const summary = summarize(d.entry, parsed, seatCounts(d.seats));
  const files = new Set<string>([resolve(d.entry.path)]);
  const st = await d.io.stat(d.entry.path);
  const copies: RoleDetail['file']['copies'] = [];
  if (d.entry.source === 'user' && d.entry.relativePath) {
    for (const cwd of new Set(d.seats.map(s => str(obj(s.node).cwd) ?? str(s.member.cwd)).filter((x): x is string => !!x))) {
      const p = resolve(cwd, d.entry.relativePath);
      if (p === resolve(d.entry.path) || copies.some(c => c.path === p)) continue;
      const cst = await d.io.stat(p);
      if (!cst?.file) continue;
      const text = await d.io.read(p);
      copies.push({ kind: 'repo', path: p, identical: text !== null && text === d.text, modifiedAt: new Date(cst.mtimeMs).toISOString() });
      files.add(p);
    }
  }
  const file: RoleDetail['file'] = { path: d.entry.path, ...(d.entry.relativePath ? { relativePath: d.entry.relativePath } : {}),
    ...(st ? { modifiedAt: new Date(st.mtimeMs).toISOString() } : {}), copies };
  const unavailable: RoleDetail['unavailable'] = ['harness_prompt', 'effective_settings', 'delivered_content', 'harness_own_files'];
  const base = { summary, file, unavailable, ...(d.openrigVersion ? { openrigVersion: d.openrigVersion } : {}) };
  if (!parsed.ok) {
    return { files, detail: { ...base, error: parsed.error, role: null, defaults: { runtime: ABSENT, model: ABSENT, effort: ABSENT }, imports: [], importedBy: [], profiles: [], resources: [],
      seats: [], warnings: [] } };
  }
  const spec: Spec = { path: d.entry.path, dir: dirname(d.entry.path), doc: parsed.doc };
  const imports = await resolveImports(spec, d.io);
  for (const i of imports.imports) if (i.path && i.resolved) files.add(resolve(i.path));
  const defaults = obj(parsed.doc.defaults);
  const def = (k: string) => (str(defaults[k]) ? { value: str(defaults[k])!, origin: { kind: 'here', key: `defaults.${k}` } as Origin } : ABSENT);
  const profiles = Object.keys(obj(parsed.doc.profiles)).map(name => resolveProfile(name, spec, imports, ctx, d.plugins));
  for (const e of profiles.flatMap(p => p.startup)) if (e.absolutePath) { const fst = await d.io.stat(e.absolutePath); if (fst?.file) e.size = fst.size; }
  const resources = declared(spec, ctx).map(r => withPlugin(r, d.plugins));
  const importedBy = isImportOnly(parsed.doc)
    ? d.library.filter(o => o.entry.id !== d.entry.id && o.parsed.ok && arr(o.parsed.doc.imports).some(im => {
        const p = str(obj(im).ref) ? importPath(str(obj(im).ref)!, dirname(o.entry.path)) : null;
        return p !== null && resolve(p) === resolve(d.entry.path);
      })).map(o => o.entry.name)
    : [];
  const seats: RoleSeat[] = [];
  for (const s of d.seats) {
    const prof = profiles.find(p => p.name === (str(s.written?.member.profile) ?? str(s.member.profile) ?? 'default'));
    const seat = await seatView(s, spec, prof, d.io, d.openrigHome, d.plugins);
    seats.push(seat);
    if (seat.rigSpecPath) files.add(resolve(seat.rigSpecPath));
    for (const e of [...seat.memberStartup, ...(seat.live?.startup ?? [])]) if (e.absolutePath) files.add(resolve(e.absolutePath));
  }
  // Files of the role and its imports: what a profile selects and what the spec declares, startup included.
  const addRes = (r: RoleResource) => { if (r.absolutePath && r.category !== 'plugin' && r.category !== 'skill') files.add(resolve(r.absolutePath)); };
  resources.forEach(addRes);
  for (const p of profiles) { Object.values(p.uses).flatMap(u => u.items).forEach(addRes); p.startup.forEach(e => e.absolutePath && files.add(resolve(e.absolutePath))); }
  for (const [ns, s] of imports.specs) declared(s, ctx, ns).forEach(addRes);
  const role = roleGuidance(spec, ctx);
  if (role) files.add(resolve(role.absolutePath));
  return { files, detail: { ...base, role, defaults: { runtime: def('runtime'), model: def('model'), effort: def('effort') },
    imports: imports.imports, importedBy, profiles, resources, seats, warnings: imports.warnings } };
}
