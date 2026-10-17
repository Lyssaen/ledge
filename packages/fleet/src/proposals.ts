import { normalizePath, PROJECT_COLORS, projectOf, type FoundRepo, type Project, type ProjectColor, type Projects, type Session } from '@ledge/protocol';

/** One machine's answer to `repos.scan`, as the app gathers them; only `ok` machines are proposed. `label`: the machine's name, for the texts. */
export interface ScanOf { machine: string; label: string; status: 'ok' | 'offline' | 'outdated'; repos: FoundRepo[]; truncated: boolean }
/** Why a folder is proposed. `machines` are labels. `chat`: the LLM's own reason (lot 11, task 5); `proposeProjects` never gives it. */
export type Why =
  | { kind: 'remote'; remote: string; machines: string[] }
  | { kind: 'agent'; names: string[] }
  | { kind: 'naming'; stem: string }
  | { kind: 'folder'; parent: string }
  | { kind: 'chat'; text: string };
export interface ProposedRepo { machine: string; path: string; why: Why }
/** The facts the app turns into the card's line: `machines` labels, `target` the target project's name, `agents` the names of the sessions to file. */
export type Summary = { repos: number; machines: string[]; target?: string; agents: string[] };
/** A new project, or with `targetId` more repositories (and sessions) for that project. `repos`: only the proposed ones. `file`: session ids to file. */
export interface Proposal { pid: string; name: string; color: ProjectColor; description: string; repos: ProposedRepo[]; file: string[]; targetId?: string; summary: Summary }

type Input = { projects: Projects; scans: readonly ScanOf[]; sessions: readonly Session[] };
interface Free { machine: string; path: string; remote?: string }
interface Group { name: string; targetId?: string; repos: ProposedRepo[]; file: string[] }

const COLORS = Object.keys(PROJECT_COLORS) as ProjectColor[];
// Like the editor's name_taken: case and accents aside.
const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLocaleLowerCase();
const at = (machine: string, path: string) => `${machine}\n${path}`;
const under = (path: string, folder: string) => folder === '/' || path === folder || path.startsWith(`${folder}/`);
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const parentOf = (path: string) => path.slice(0, Math.max(1, path.lastIndexOf('/')));
const titleCase = (s: string) => s.replace(/[-_.]+/g, ' ').trim().split(/\s+/).map(w => w.charAt(0).toLocaleUpperCase() + w.slice(1)).join(' ');
/** « paper-fonts » → `paper`; null without a « - ». */
const prefixOf = (name: string) => { const i = name.indexOf('-'); return i > 0 ? name.slice(0, i) : null; };
const stemName = (name: string) => titleCase(prefixOf(name) ?? name);
const unique = <T>(xs: readonly T[]) => [...new Set(xs)];

/** cyrb53: a stable 53-bit hash, no Date nor random. */
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** What the scans and sessions give: the online machines in their order, the free repositories sorted, who owns the others. */
function survey(input: Input) {
  const scans = input.scans.filter(s => s.status === 'ok');
  const order = new Map(scans.map((s, i) => [s.machine, i]));
  const labels = new Map(scans.map(s => [s.machine, s.label]));
  const byPlace = (a: { machine: string; path: string }, b: { machine: string; path: string }) =>
    order.get(a.machine)! - order.get(b.machine)! || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const scanned: Free[] = [];
  const seen = new Set<string>();
  for (const s of scans) for (const r of s.repos) {
    const path = normalizePath(r.path);
    if (seen.has(at(s.machine, path))) continue;
    seen.add(at(s.machine, path));
    scanned.push({ machine: s.machine, path, ...(r.remote ? { remote: r.remote } : {}) });
  }
  scanned.sort(byPlace);
  const ownerOf = (r: { machine: string; path: string }) => projectOf({ machineId: r.machine, cwd: r.path }, input.projects);
  const free = scanned.filter(r => ownerOf(r) === null);
  // Overlap: a remote a project's repository has, a parent folder a project's repository sits in.
  const remoteOwner = new Map<string, string>();
  for (const r of scanned) { const owner = ownerOf(r); if (owner && r.remote && !remoteOwner.has(r.remote)) remoteOwner.set(r.remote, owner); }
  const parentOwner = new Map<string, string>();
  for (const p of input.projects.projects) for (const r of p.repos) { const k = at(r.machine, parentOf(r.path)); if (!parentOwner.has(k)) parentOwner.set(k, p.id); }
  return { order, labels, byPlace, scanned, free, remoteOwner, parentOwner, label: (m: string) => labels.get(m) ?? m };
}
type Survey = ReturnType<typeof survey>;

/** The finished proposal: target's name, colour and description, else the given colour; its summary and pid. */
function finish(g: Group, projects: readonly Project[], color: ProjectColor, s: Survey, sessions: readonly Session[]): Proposal {
  const target = g.targetId === undefined ? undefined : projects.find(p => p.id === g.targetId);
  const names = g.file.map(id => sessions.find(x => x.id === id)?.name ?? id);
  const summary: Summary = { repos: g.repos.length, machines: unique(g.repos.map(r => s.label(r.machine))), ...(target ? { target: target.name } : {}), agents: names };
  const content = JSON.stringify([target?.id ?? key(g.name), g.repos.map(r => [r.machine, r.path]), g.file]);
  return {
    pid: `prop-${hash(content)}`,
    name: target ? target.name : g.name,
    color: target ? target.color : color,
    description: target ? target.description : '',
    repos: g.repos,
    file: g.file,
    ...(target ? { targetId: target.id } : {}),
    summary
  };
}

/** Les groupes : même remote (sur plusieurs machines ou chemins, ou celui d'un dépôt d'un projet) > dossiers d'agents sans projet >
 *  nommage commun (préfixe avant « - », au moins 2 dépôts) > même dossier parent (au moins 2, ou celui d'un dépôt d'un projet).
 *  Un dépôt déjà dans un projet (projectOf) est exclu ; chaque dépôt n'est que dans une proposition (la première raison l'emporte).
 *  Recoupement : un groupe dont un dépôt a le remote ou le dossier parent d'un dépôt d'un projet existant devient targetId (« Ajouter à »).
 *  Nom : le préfixe ou le dossier parent, mis en forme (« paper-fonts » → « Paper ») ; un nom déjà pris devient un recoupement sur ce projet.
 *  Deux groupes de même cible ou de même nom n'en font qu'un. Couleur : la première libre, en tenant compte des propositions précédentes. */
export function proposeProjects(input: Input): Proposal[] {
  const s = survey(input);
  const groups: Group[] = [];
  const claimed = new Map<string, number>(); // repository → index of its group
  const claim = (g: Group) => { for (const r of g.repos) claimed.set(at(r.machine, r.path), groups.length); groups.push(g); };
  const left = () => s.free.filter(r => !claimed.has(at(r.machine, r.path)));

  // 1. The same remote on several machines or paths, or the remote of a project's repository.
  const byRemote = new Map<string, Free[]>();
  for (const r of s.free) if (r.remote) byRemote.set(r.remote, [...(byRemote.get(r.remote) ?? []), r]);
  for (const [remote, rs] of byRemote) {
    if (rs.length < 2 && !s.remoteOwner.has(remote)) continue;
    const why: Why = { kind: 'remote', remote, machines: unique(rs.map(r => s.label(r.machine))) };
    claim({ name: stemName(basename(remote)), repos: rs.map(r => ({ machine: r.machine, path: r.path, why })), file: [] });
  }

  // 2. The folders of the agents without a project: the scanned repository that holds the cwd, else the folder itself (never one
  //    that holds scanned repositories, which would swallow them, nor /). A repository already proposed takes the session along.
  const loose = input.sessions
    .map(x => ({ x, machine: x.machineId ?? 'local', cwd: normalizePath(x.cwd) }))
    .filter(a => s.order.has(a.machine) && projectOf(a.x, input.projects) === null)
    .sort((a, b) => s.byPlace({ machine: a.machine, path: a.cwd }, { machine: b.machine, path: b.cwd }) || (a.x.id < b.x.id ? -1 : 1));
  const folders = new Map<string, { machine: string; path: string; names: string[] }>();
  const file: string[] = [];
  for (const a of loose) {
    const repo = s.free.filter(r => r.machine === a.machine && under(a.cwd, r.path)).sort((p, q) => q.path.length - p.path.length)[0];
    if (repo && claimed.has(at(repo.machine, repo.path))) { groups[claimed.get(at(repo.machine, repo.path))!]!.file.push(a.x.id); continue; }
    const path = repo?.path ?? a.cwd;
    if (!repo && (path === '/' || s.scanned.some(r => r.machine === a.machine && under(r.path, path)))) continue;
    const k = at(a.machine, path);
    const f = folders.get(k) ?? { machine: a.machine, path, names: [] };
    if (!f.names.includes(a.x.name)) f.names.push(a.x.name);
    folders.set(k, f);
    file.push(a.x.id);
  }
  if (folders.size) {
    const paths = [...folders.values()].map(f => f.path);
    const common = paths.reduce((c, p) => { while (!under(p, c)) c = parentOf(c); return c; });
    claim({ name: titleCase(basename(common === '/' ? paths[0]! : common)), repos: [...folders.values()].map(f => ({ machine: f.machine, path: f.path, why: { kind: 'agent', names: f.names } })), file });
  }

  // 3. A common prefix before « - », at least two repositories.
  const byStem = new Map<string, { stem: string; rs: Free[] }>();
  for (const r of left()) {
    const stem = prefixOf(basename(r.path));
    if (stem === null) continue;
    const e = byStem.get(key(stem)) ?? { stem: stem.toLocaleLowerCase(), rs: [] };
    e.rs.push(r);
    byStem.set(key(stem), e);
  }
  for (const { stem, rs } of byStem.values()) if (rs.length >= 2) claim({ name: titleCase(stem), repos: rs.map(r => ({ machine: r.machine, path: r.path, why: { kind: 'naming', stem } })), file: [] });

  // 4. The same parent folder: at least two repositories, or the folder of a project's repository.
  const byParent = new Map<string, Free[]>();
  for (const r of left()) { const p = parentOf(r.path); if (p !== '/') byParent.set(p, [...(byParent.get(p) ?? []), r]); }
  for (const [parent, rs] of byParent) {
    if (rs.length < 2 && !rs.some(r => s.parentOwner.has(at(r.machine, parent)))) continue;
    claim({ name: titleCase(basename(parent)), repos: rs.map(r => ({ machine: r.machine, path: r.path, why: { kind: 'folder', parent } })), file: [] });
  }

  // Overlap, then a taken name; groups with the same target or the same name merge into the first.
  const projects = input.projects.projects;
  const remoteOf = new Map(s.scanned.map(r => [at(r.machine, r.path), r.remote]));
  const merged: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const g of groups) {
    const viaRemote = g.repos.map(r => remoteOf.get(at(r.machine, r.path))).find(rm => rm !== undefined && s.remoteOwner.has(rm));
    const viaParent = g.repos.map(r => s.parentOwner.get(at(r.machine, parentOf(r.path)))).find(id => id !== undefined);
    const targetId = (viaRemote !== undefined ? s.remoteOwner.get(viaRemote) : undefined) ?? viaParent ?? projects.find(p => key(p.name) === key(g.name))?.id;
    const k = targetId !== undefined ? `#${targetId}` : `=${key(g.name)}`;
    const into = byKey.get(k);
    if (into) { into.repos.push(...g.repos); for (const id of g.file) if (!into.file.includes(id)) into.file.push(id); continue; }
    const fresh: Group = { name: g.name, ...(targetId !== undefined ? { targetId } : {}), repos: [...g.repos], file: [...g.file] };
    byKey.set(k, fresh);
    merged.push(fresh);
  }

  const used = new Set<ProjectColor>(projects.map(p => p.color));
  return merged.map(g => {
    if (g.targetId !== undefined) return finish(g, projects, 'blue', s, input.sessions);
    const color = COLORS.find(c => !used.has(c)) ?? 'blue';
    used.add(color);
    return finish(g, projects, color, s, input.sessions);
  });
}

/** « Laisser Ledge faire » depuis l'éditeur : avec un nom tapé, les dépôts libres dont le nom contient un de ses mots (> 2 lettres) ;
 *  sinon la proposition qui contient les sessions à ranger du brouillon ; sinon la première ; null s'il n'y a rien de libre.
 *  Avec `draft.id` (un projet existant), il est la cible ; un nom tapé est gardé. */
export function proposeFor(draft: { id?: string; name: string; file: readonly string[] }, all: readonly Proposal[], input: Input): Proposal | null {
  const s = survey(input);
  const projects = input.projects.projects;
  const target = draft.id === undefined ? undefined : projects.find(p => p.id === draft.id);
  const firstFree = COLORS.find(c => !projects.some(p => p.color === c)) ?? 'blue';
  const name = draft.name.trim();
  const words = key(name).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2);
  if (words.length) {
    const repos = s.free.flatMap(r => {
      const stem = words.find(w => key(basename(r.path)).includes(w));
      return stem === undefined ? [] : [{ machine: r.machine, path: r.path, why: { kind: 'naming', stem } as Why }];
    });
    if (repos.length) return finish({ name, ...(target ? { targetId: target.id } : {}), repos, file: [...draft.file] }, projects, firstFree, s, input.sessions);
  }
  const pick = (draft.file.length ? all.find(p => p.file.some(id => draft.file.includes(id))) : undefined) ?? all[0];
  if (!pick) return null;
  const file = unique([...pick.file, ...draft.file]);
  const targetId = target?.id ?? pick.targetId;
  return finish({ name: name || pick.name, ...(targetId !== undefined ? { targetId } : {}), repos: pick.repos, file }, projects, pick.color, s, input.sessions);
}
