import { normalizePath, PROJECT_COLORS, projectOf, type FoundRepo, type Project, type ProjectColor, type Projects, type Session } from '@ledge/protocol';

/** One machine's answer to `repos.scan`, as the app gathers them; only `ok` machines are proposed. `label`: the machine's name, for the texts. */
export interface ScanOf { machine: string; label: string; status: 'ok' | 'offline' | 'outdated'; repos: FoundRepo[]; truncated: boolean }
/** Why a folder is proposed. `machines` are labels. `naming`: a group sharing the prefix `stem` before « - »; `name`: a word typed in
 *  the editor found in the folder's name (proposeFor). `chat`: the LLM's own reason (lot 11, task 5); `proposeProjects` never gives it. */
export type Why =
  | { kind: 'remote'; remote: string; machines: string[] }
  | { kind: 'agent'; names: string[] }
  | { kind: 'naming'; stem: string }
  | { kind: 'name'; word: string }
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

/** The first colour no project uses, in PROJECT_COLORS' order; `blue` when all are taken. */
export function firstFreeColor(projects: readonly Pick<Project, 'color'>[]): ProjectColor {
  return COLORS.find(c => !projects.some(p => p.color === c)) ?? 'blue';
}

/** cyrb53: a stable 53-bit hash, no Date nor random. */
function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A home kept in Git (dotfiles): `/root`, `/home/<user>`, `/Users/<user>`. */
const HOME = /^\/(?:root|home\/[^/]+|Users\/[^/]+)$/;

/** What the scans and sessions give: the online machines in their order, the free repositories sorted, who owns the others.
 *  Machine order follows the order of `scans` (the fleet's order); within a machine, repositories are sorted by path. */
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
  // Never free, nor a folder that holds an agent: a repository owned by a project (projectOf), a home kept in Git, or a repository
  // that holds other scanned repositories on its machine (Task 1 lists home's own .git on purpose); either would swallow the rest.
  const container = (r: Free) => HOME.test(r.path) || scanned.some(o => o.machine === r.machine && o.path !== r.path && under(o.path, r.path));
  const free = scanned.filter(r => ownerOf(r) === null && !container(r));
  // Overlap: a remote a project's repository has.
  const remoteOwner = new Map<string, string>();
  for (const r of scanned) { const owner = ownerOf(r); if (owner && r.remote && !remoteOwner.has(r.remote)) remoteOwner.set(r.remote, owner); }
  return { order, labels, byPlace, scanned, free, remoteOwner, label: (m: string) => labels.get(m) ?? m };
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

/** Les groupes : même remote (sur plusieurs machines ou chemins, ou celui d'un dépôt d'un projet) > dossiers d'agents sans projet
 *  (une proposition par dossier parent) > nommage commun (préfixe avant « - », au moins 2 dépôts) > même dossier parent (au moins 2).
 *  Un dépôt déjà dans un projet (projectOf) est exclu ; chaque dépôt n'est que dans une proposition (la première raison l'emporte).
 *  Recoupement : un groupe dont un dépôt a le remote d'un dépôt d'un projet existant devient targetId (« Ajouter à ») ;
 *  le dossier parent seul ne fait jamais un recoupement.
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
  //    One proposal per parent folder, so that unrelated folders are not mixed; named after the folder, or the parent when several.
  const loose = input.sessions
    .map(x => ({ x, machine: x.machineId ?? 'local', cwd: normalizePath(x.cwd) }))
    .filter(a => s.order.has(a.machine) && projectOf(a.x, input.projects) === null)
    .sort((a, b) => s.byPlace({ machine: a.machine, path: a.cwd }, { machine: b.machine, path: b.cwd }) || (a.x.id < b.x.id ? -1 : 1));
  type Folders = { folders: Map<string, { machine: string; path: string; names: string[] }>; file: string[] };
  const byFolderParent = new Map<string, Folders>();
  const chosen: { machine: string; path: string; parent: string }[] = []; // the plain folders kept so far (an ancestor comes first: sorted by path)
  for (const a of loose) {
    const repo = s.free.filter(r => r.machine === a.machine && under(a.cwd, r.path)).sort((p, q) => q.path.length - p.path.length)[0];
    if (repo && claimed.has(at(repo.machine, repo.path))) { groups[claimed.get(at(repo.machine, repo.path))!]!.file.push(a.x.id); continue; }
    // A loose folder under one already kept goes with it, as a folder goes with the repository that holds it.
    const holder = repo ? undefined : chosen.find(c => c.machine === a.machine && under(a.cwd, c.path));
    const path = repo?.path ?? holder?.path ?? a.cwd;
    if (!repo && !holder) {
      if (path === '/' || s.scanned.some(r => r.machine === a.machine && under(r.path, path))) continue;
      chosen.push({ machine: a.machine, path, parent: parentOf(path) });
    }
    const parent = holder?.parent ?? parentOf(path);
    const g: Folders = byFolderParent.get(parent) ?? { folders: new Map(), file: [] };
    const f = g.folders.get(at(a.machine, path)) ?? { machine: a.machine, path, names: [] };
    if (!f.names.includes(a.x.name)) f.names.push(a.x.name);
    g.folders.set(at(a.machine, path), f);
    g.file.push(a.x.id);
    byFolderParent.set(parent, g);
  }
  for (const [parent, g] of byFolderParent) {
    const folders = [...g.folders.values()];
    const named = unique(folders.map(f => f.path)).length > 1 && parent !== '/' ? parent : folders[0]!.path;
    claim({ name: titleCase(basename(named)), repos: folders.map(f => ({ machine: f.machine, path: f.path, why: { kind: 'agent', names: f.names } })), file: g.file });
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

  // 4. The same parent folder: at least two repositories (a new proposal only: a parent folder is no overlap).
  const byParent = new Map<string, Free[]>();
  for (const r of left()) { const p = parentOf(r.path); if (p !== '/') byParent.set(p, [...(byParent.get(p) ?? []), r]); }
  for (const [parent, rs] of byParent) {
    if (rs.length < 2) continue;
    claim({ name: titleCase(basename(parent)), repos: rs.map(r => ({ machine: r.machine, path: r.path, why: { kind: 'folder', parent } })), file: [] });
  }

  // Overlap (a project's remote among the group's own repositories), then a taken name; groups with the same target or the same name merge into the first.
  const projects = input.projects.projects;
  const remoteOf = new Map(s.scanned.map(r => [at(r.machine, r.path), r.remote]));
  const merged: Group[] = [];
  const byKey = new Map<string, Group>();
  for (const g of groups) {
    const viaRemote = g.repos.map(r => remoteOf.get(at(r.machine, r.path))).find(rm => rm !== undefined && s.remoteOwner.has(rm));
    const targetId = (viaRemote !== undefined ? s.remoteOwner.get(viaRemote) : undefined) ?? projects.find(p => key(p.name) === key(g.name))?.id;
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
 *  Avec `draft.id` (un projet existant) : d'abord la proposition qui vise déjà ce projet ; une proposition qui vise un autre projet
 *  n'est jamais reprise (seules celles d'un nouveau projet, sinon null) ; il est la cible de ce qui est rendu et garde son nom. Un nouveau brouillon garde le nom tapé : une proposition « Ajouter à » retenue devient alors un nouveau projet. */
export function proposeFor(draft: { id?: string; name: string; file: readonly string[] }, all: readonly Proposal[], input: Input): Proposal | null {
  const s = survey(input);
  const projects = input.projects.projects;
  const target = draft.id === undefined ? undefined : projects.find(p => p.id === draft.id);
  const firstFree = firstFreeColor(projects);
  const name = draft.name.trim();
  if (target) {
    const aimed = all.find(p => p.targetId === target.id);
    if (aimed) return finish({ name: target.name, targetId: target.id, repos: aimed.repos, file: unique([...aimed.file, ...draft.file]) }, projects, target.color, s, input.sessions);
  }
  const words = key(name).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2);
  if (words.length) {
    const repos = s.free.flatMap(r => {
      const word = words.find(w => key(basename(r.path)).includes(w));
      return word === undefined ? [] : [{ machine: r.machine, path: r.path, why: { kind: 'name', word } as Why }];
    });
    if (repos.length) return finish({ name, ...(target ? { targetId: target.id } : {}), repos, file: [...draft.file] }, projects, firstFree, s, input.sessions);
  }
  // From a project's editor, a proposal aimed at another project is not this one's: only new projects' proposals remain.
  const pool = target ? all.filter(p => p.targetId === undefined) : all;
  const pick = (draft.file.length ? pool.find(p => p.file.some(id => draft.file.includes(id))) : undefined) ?? pool[0];
  if (!pick) return null;
  const file = unique([...pick.file, ...draft.file]);
  const targetId = target ? target.id : name ? undefined : pick.targetId;
  const color = pick.targetId !== undefined && targetId === undefined ? firstFree : pick.color;
  return finish({ name: name || pick.name, ...(targetId !== undefined ? { targetId } : {}), repos: pick.repos, file }, projects, color, s, input.sessions);
}
