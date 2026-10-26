import { useEffect, useId, useMemo, useState, type JSX, type ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { autonomyArgs, ompApprovalFor, ROLE_PROMPT_MAX, type Autonomy, type DefinitionProblem, type Project, type Projects, type Role, type Seat, type Session, type Team, type TeamTemplate, type Tool } from '@ledge/protocol';
import { toolName } from '@ledge/ui/chat/format';
import { MarkdownDocument, ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { Menu, MenuItem } from '../shell/Menu';
import { readJson, writeJson } from '../state/storage';
import type { Modal, NavAction } from '../nav/state';
import type { RolesListing, TeamsApi } from './useTeamsApi';
import { useDocument } from '../session/useDocument';
import { Icon, ICONS } from '@ledge/ui/ui/icons';

/** The « Équipes » tab's views (#97): the live teams, and the catalog a folder reads, its templates and its roles. */
export type TeamsView = 'live' | 'templates' | 'roles';
/** What the catalog shows on the right: a role, a template, or the files skipped. */
export interface CatalogPick { role?: string; template?: string; problems?: boolean }

/** A folder the catalog can read: a project's repository, another folder, or none (`~/.ledge` alone, « Perso seulement »). */
export interface Scope { cwd: string | null; name: string; project?: string }

export const CATALOG_SCOPE_KEY = 'desktop.catalog.scope';
const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor', 'omp'];
const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
/** `cwd` is `root` or inside it. */
const under = (cwd: string, root: string) => cwd === root || cwd.startsWith(root.endsWith('/') ? root : `${root}/`);
const localRepos = (p: Project) => p.repos.filter(r => r.machine === 'local').map(r => r.path);

/** The project a folder belongs to, by its local repositories: the room a team launched there sits in. */
export function projectOfFolder(projects: Projects | null, cwd: string | null): Project | undefined {
  if (!cwd) return undefined;
  return projects?.projects.find(p => localRepos(p).some(r => under(cwd, r)));
}

/** The folders offered: each project's local repositories, a folder asked for outside them, and « Perso seulement » last. */
export function scopesOf(projects: Projects | null, extra: readonly (string | null | undefined)[]): Scope[] {
  const out: Scope[] = [];
  for (const p of projects?.projects ?? []) {
    const repos = localRepos(p);
    for (const cwd of repos) out.push({ cwd, name: repos.length > 1 ? `${p.name} · ${folderName(cwd)}` : p.name, project: p.name });
  }
  for (const cwd of extra) if (cwd && !out.some(s => s.cwd === cwd)) out.push({ cwd, name: folderName(cwd) });
  return out;
}

/** The repository a folder falls in among those offered (a session's worktree, a team's folder), else the folder itself. */
const rootOf = (cwd: string, scopes: readonly Scope[]) =>
  scopes.filter(s => s.cwd && under(cwd, s.cwd)).sort((a, b) => b.cwd!.length - a.cwd!.length)[0]?.cwd ?? cwd;

/**
 * The folder the catalog reads (the user's decision on #97): the project of the session open in the atelier, else the last
 * folder chosen, else the atelier's project, else the first project's; none (`~/.ledge`) without any project. A folder
 * chosen in the picker is remembered; one the catalog jumps to (a team's) is not.
 */
export function useScope(projects: Projects | null, openCwd: string | undefined, atelierProject: string | undefined) {
  const saved = readJson(CATALOG_SCOPE_KEY);
  const remembered = typeof saved === 'string' ? (saved === '' ? null : saved) : undefined;
  const [cwd, setCwd] = useState<string | null | undefined>(undefined);
  const base = useMemo(() => scopesOf(projects, []), [projects]);
  const initial = useMemo((): string | null => {
    if (openCwd) return rootOf(openCwd, base);
    if (remembered !== undefined) return remembered;
    const filtered = projects?.projects.find(p => p.id === atelierProject);
    return (filtered && localRepos(filtered)[0]) ?? base[0]?.cwd ?? null;
  }, [openCwd, remembered, atelierProject, projects, base]);
  const current = cwd === undefined ? initial : cwd;
  const options = useMemo(() => scopesOf(projects, [current, remembered]), [projects, current, remembered]);
  const choose = (next: string | null, remember: boolean) => {
    const root = next === null ? null : rootOf(next, options);
    setCwd(root);
    if (remember) writeJson(CATALOG_SCOPE_KEY, root ?? '');
  };
  return { cwd: current, options, choose };
}

/** What the folder holds, read at the view's opening and again for each `tick` or another folder; null while it is read. */
export function useCatalog(teams: TeamsApi, cwd: string | null, tick: number): RolesListing | null {
  const [listing, setListing] = useState<RolesListing | null>(null);
  const { roles } = teams;
  useEffect(() => {
    let live = true;
    setListing(null);
    void roles(cwd ?? undefined).then(l => { if (live) setListing(l); });
    return () => { live = false; };
  }, [roles, cwd, tick]);
  return listing;
}

/** « Dossier ledge ~/w/ledge ▾ »: the folder read, and the others offered, « Perso seulement » last; the app's menu (arrows,
 *  Home / End, Échap, the focus back on the button). */
export function ScopePicker({ scope, onChoose }: { scope: ReturnType<typeof useScope>; onChoose(cwd: string | null): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  const [open, setOpen] = useState(false);
  const current = scope.options.find(s => s.cwd === scope.cwd);
  const all: Scope[] = [...scope.options, { cwd: null, name: c.personal }];
  const note = useId();
  // The rule the choice follows, at the popup's foot (the mockup's), outside the menu's items; it describes the button.
  return (
    <Menu open={open} onOpenChange={setOpen} label={c.folderTitle} className="cat-scope" menuClassName="cat-scope-pop"
      footer={<p id={note} className="cat-scope-note">{c.repoWins}</p>}
      trigger={tr => (
        <button type="button" className="cat-scope-btn" title={c.folderTitle} aria-describedby={note} {...tr}>
          {c.folder} <strong>{scope.cwd === null ? c.personal : current?.name ?? folderName(scope.cwd)}</strong> <small>{scope.cwd ?? '~/.ledge'}</small> ▾
        </button>
      )}>
      {all.map(s => (
        <MenuItem key={s.cwd ?? ''} className={cls(s.cwd === scope.cwd && 'on')} aria-current={s.cwd === scope.cwd || undefined} onSelect={() => onChoose(s.cwd)}>
          <strong>{s.name}</strong>
          <small>{s.cwd ?? '~/.ledge'} · {s.cwd === null ? c.scopePersonal : s.project ? c.scopeProject(s.project) : c.scopeFolder}</small>
        </MenuItem>
      ))}
    </Menu>
  );
}

const Source = ({ source }: { source: 'repo' | 'home' }) => {
  const { t } = useI18n();
  return <span className={cls('cat-src', source)}>{t.home.catalog.source[source]}</span>;
};

/** What the catalog needs of the app: the live teams and sessions (who holds what), where its buttons go. */
export interface CatalogCtx {
  client: DaemonClient; teams: TeamsApi; sessions: readonly Session[]; projects: Projects | null; dispatch: (a: NavAction) => void; notify(text: string): void;
}
/** CatalogCtx, with « Ouvrir »: the file shown in the reader beside the detail. */
type DetailCtx = CatalogCtx & { openFile(path: string): void };

/** The catalog of a folder: the list grouped by source (repository, then home), the files skipped, the detail on the right. */
export function CatalogView({ ctx, view, cwd, listing, pick, onPick, query, onRetry }: {
  ctx: CatalogCtx; view: 'templates' | 'roles'; cwd: string | null; listing: RolesListing | null; pick: CatalogPick; onPick(next: CatalogPick, view?: TeamsView): void; query: string;
  /** Reads the folder again (a daemon that did not answer). */
  onRetry(): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  // The file « Ouvrir » shows (the user's choice on #97: Ledge's reader, read only, no outside editor), until another pick.
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => setOpened(null), [view, cwd, pick.role, pick.template, pick.problems]);
  if (!listing) return <p className="lp-none cat-loading">{c.loading}</p>;
  // No answer is not an empty folder: said apart, with « Réessayer ».
  if (listing.silent) return <div className="cat-empty" role="alert"><p>{c.silent}</p><Button variant="outline" size="sm" onClick={onRetry}>{c.retry}</Button></div>;
  const dctx: DetailCtx = { ...ctx, openFile: setOpened };
  const q = query.trim().toLowerCase();
  const roles = listing.roles.filter(r => !q || `${r.id} ${r.label}`.toLowerCase().includes(q));
  // A role or a template asked for (a link) that this folder does not have is said so, never shown as another; one only
  // hidden by the filter gives way to the first one shown.
  const unknownRole = !!pick.role && !listing.roles.some(r => r.id === pick.role);
  const unknownTemplate = !!pick.template && !listing.templates.some(x => x.id === pick.template);
  const role = pick.problems || unknownRole ? undefined : roles.find(r => r.id === pick.role) ?? roles[0];
  const template = pick.problems || unknownTemplate ? undefined : listing.templates.find(x => x.id === pick.template) ?? listing.templates[0];
  const problems = listing.problems;
  const group = <T extends { source: 'repo' | 'home' }>(title: string, list: readonly T[], row: (x: T) => ReactNode) =>
    list.length > 0 && <><h4>{title}</h4>{list.map(row)}</>;
  const held = (id: string, source: 'repo' | 'home') => ctx.sessions.filter(s => s.role === id && s.state !== 'exited' && !s.archivedAt && (source === 'home' || !cwd || under(s.cwd, cwd)));
  const usedIn = (id: string) => listing.templates.filter(x => x.seats.some(s => s.role === id));
  return (
    <div className={cls('cat-split', opened && 'reading')}>
      <div className="cat-list" role="group" aria-label={view === 'roles' ? c.rolesList : c.templatesList}>
        {view === 'roles' ? <>
          {listing.roles.length === 0 ? <p className="lp-none">{c.noRole}</p> : roles.length === 0 && <p className="lp-none">{c.noMatch}</p>}
          {group(c.repoRoles, roles.filter(r => r.source === 'repo'), r => <RoleRow key={r.id} role={r} on={r === role} used={usedIn(r.id).length} held={held(r.id, r.source)} onClick={() => onPick({ role: r.id })} />)}
          {group(c.homeRoles, roles.filter(r => r.source === 'home'), r => <RoleRow key={r.id} role={r} on={r === role} used={usedIn(r.id).length} held={held(r.id, r.source)} onClick={() => onPick({ role: r.id })} />)}
        </> : <>
          {listing.templates.length === 0 && <p className="lp-none">{c.noTemplate}</p>}
          {group(c.repoTeams, listing.templates.filter(x => x.source === 'repo'), x => <TemplateRow key={x.id} template={x} on={x === template} onClick={() => onPick({ template: x.id })} />)}
          {group(c.homeTeams, listing.templates.filter(x => x.source === 'home'), x => <TemplateRow key={x.id} template={x} on={x === template} onClick={() => onPick({ template: x.id })} />)}
        </>}
        {problems.length > 0 && <>
          <h4>{c.ignored}</h4>
          <button type="button" className={cls('cat-row bad', pick.problems && 'on')} onClick={() => onPick({ ...pick, problems: true })}>
            <span className="t">⚠ <span className="n">{c.ignoredRow(problems.length)}</span></span>
            <span className="s">{c.ignoredHint}</span>
          </button>
        </>}
      </div>
      <div className="cat-detail">
        {pick.problems ? <ProblemsDetail problems={problems} />
          : view === 'roles' && unknownRole ? <EmptyDetail text={c.unknownRoleIn(pick.role!)} hint={c.noRoleHint} />
          : view === 'templates' && unknownTemplate ? <EmptyDetail text={c.unknownTemplateIn(pick.template!)} hint={c.noTemplateHint} />
          : view === 'roles' ? (role ? <RoleDetail ctx={dctx} cwd={cwd} role={role} used={usedIn(role.id)} held={held(role.id, role.source)} onPick={onPick} />
            : <EmptyDetail text={c.noRole} hint={c.noRoleHint} />)
          : template ? <TemplateDetail ctx={dctx} cwd={cwd} template={template} roles={listing.roles} onPick={onPick} />
          : <EmptyDetail text={c.noTemplate} hint={c.noTemplateHint} />}
      </div>
      {opened && <FileReader client={ctx.client} path={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}

const EmptyDetail = ({ text, hint }: { text: string; hint: string }) => <div className="cat-empty"><p>{text}</p><p className="lp-none">{hint}</p></div>;

/** A role's tool, model and effort, its defaults where it names none. */
const runOf = (r: Pick<Role, 'tool' | 'model' | 'effort'>) => [r.tool && toolName(r.tool), r.model, r.effort].filter(Boolean).join(' · ');

function RoleRow({ role, on, used, held, onClick }: { role: Role; on: boolean; used: number; held: readonly Session[]; onClick(): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  const autonomy = role.autonomy ?? 'ask';
  return (
    <button type="button" className={cls('cat-row', on && 'on')} aria-current={on || undefined} data-role={role.id} onClick={onClick}>
      <span className="t"><span className="role-pill">@{role.id}</span><span className="n">{role.label}</span></span>
      <span className={cls('r', `auto-${autonomy}`)}>{c.autonomyShort[autonomy]}</span>
      <span className="s">{[runOf(role) || c.toolDefaults, used > 0 ? c.inTemplates(used) : null, held.length > 0 ? c.heldBy(held.map(s => s.name).join(', ')) : null].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

function TemplateRow({ template, on, onClick }: { template: TeamTemplate; on: boolean; onClick(): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <button type="button" className={cls('cat-row', on && 'on')} aria-current={on || undefined} data-template={template.id} onClick={onClick}>
      <span className="t"><span className="team-flag" aria-hidden>⚑</span> <span className="n">{template.name}</span></span>
      <span className="r">{t.home.catalog.seats(template.seats.length)}</span>
      <span className="s">{template.seats.map(s => <span key={s.role} className="role-pill">@{s.role}</span>)}</span>
    </button>
  );
}

/** The flag a role's autonomy adds at launch (`autonomyArgs`, the daemon's own): for its agent, or for each when it names none. */
function autonomyWhy(c: ReturnType<typeof useI18n>['t']['home']['catalog'], tool: Tool | undefined, autonomy: Autonomy): string {
  if (autonomy === 'ask') return c.autonomyAsk;
  const one = (x: Tool) => {
    if (x === 'omp') return c.toolFlag(toolName(x), c.ompApproval(ompApprovalFor(autonomy) ?? 'always-ask'));
    const args = autonomyArgs(x, autonomy);
    return c.toolFlag(toolName(x), args.length ? args.join(' ') : c.autonomyNone);
  };
  const flags = tool ? one(tool) : TOOLS.map(one).join(' · ');
  return autonomy === 'auto' ? `${flags} — ${c.autonomyAuto}` : flags;
}

/** « Fichier » and its buttons: copy the path, open the file. */
function FileFact({ ctx, path }: { ctx: DetailCtx; path: string }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  const copy = () => {
    try { void navigator.clipboard?.writeText(path).catch(() => undefined); } catch { /* the notice says it */ }
    ctx.notify(c.copied(path));
  };
  return (
    <>
      <dt>{c.file}</dt>
      <dd><code className="cat-path" title={path}>{path}</code>
        <Button variant="ghost" size="sm" onClick={copy}>{c.copy}</Button>
        <Button variant="ghost" size="sm" onClick={() => ctx.openFile(path)}>{c.open}</Button>
      </dd>
    </>
  );
}

const launchModal = (m: Omit<Extract<Modal, { kind: 'launch' }>, 'kind'>): NavAction => ({ type: 'modal', modal: { kind: 'launch', ...m } });

function RoleDetail({ ctx, cwd, role, used, held, onPick }: {
  ctx: DetailCtx; cwd: string | null; role: Role; used: readonly TeamTemplate[]; held: readonly Session[]; onPick(next: CatalogPick, view?: TeamsView): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  const autonomy = role.autonomy ?? 'ask';
  const project = projectOfFolder(ctx.projects, cwd);
  const { id, label, tool, model, effort } = role;
  return (
    <section className="cat-detail-body" aria-label={`@${role.id}`}>
      <div className="cat-head">
        <div>
          <h2><span className="role-pill">@{role.id}</span>{role.label}</h2>
          <small>{c.role} · <Source source={role.source} /></small>
        </div>
        <div className="cat-actions">
          <Button variant="outline" size="sm" onClick={() => ctx.dispatch(launchModal({ ...(project ? { project: project.id } : {}), ...(cwd ? { cwd } : {}), role: { id, label, tool, model, effort } }))}>{c.launchSession}</Button>
          <Button variant="primary" size="sm" disabled={!project} title={project ? undefined : c.needProject}
            onClick={() => project && ctx.dispatch(launchModal({ project: project.id, team: true, ...(cwd ? { cwd } : {}), seat: role.id }))}>{c.mountTeam}</Button>
        </div>
      </div>
      {!project && <p className="cat-ro">{c.needProject}</p>}
      <dl className="cat-facts">
        <dt>{c.tool}</dt><dd>{role.tool ? toolName(role.tool) : <span className="lp-none">{c.anyTool}</span>}</dd>
        <dt>{c.model}</dt><dd>{role.model ?? <span className="lp-none">{c.toolDefault}</span>}</dd>
        <dt>{c.effort}</dt><dd>{role.effort ?? <span className="lp-none">{c.toolDefault}</span>}</dd>
        <dt>{c.autonomy}</dt><dd><span className={`auto-${autonomy}`}>{c.autonomyShort[autonomy]}</span><span className="why">{autonomyWhy(c, role.tool, autonomy)}</span></dd>
        <FileFact ctx={ctx} path={role.path} />
        {role.shadows && <><dt /><dd className="why">{c.shadows} <code>{role.shadows}</code> {c.shadowsWhy}</dd></>}
      </dl>
      <div className="cat-section">
        <h3>{c.prompt}</h3>
        <div className="cat-prompt">
          <span className="count">{role.prompt.length} / {ROLE_PROMPT_MAX}</span>
          {role.prompt.trim() ? <ThreadMarkdown text={role.prompt} /> : <p className="lp-none">{c.promptEmpty}</p>}
        </div>
      </div>
      <div className="cat-section">
        <h3>{c.usedIn}</h3>
        <div className="cat-links">
          {used.length === 0 ? <span className="lp-none">{c.noUse}</span> : used.map(x => (
            <div key={x.id} className="cat-link">
              <span className="team-flag" aria-hidden>⚑</span><strong>{x.name}</strong><small>{c.seats(x.seats.length)} · {c.source[x.source]}</small>
              <span className="st-fill" />
              <Button variant="ghost" size="sm" onClick={() => onPick({ template: x.id }, 'templates')}>{c.seeTemplate}</Button>
            </div>
          ))}
        </div>
      </div>
      <div className="cat-section">
        <h3>{c.heldNow}</h3>
        <div className="cat-links">
          {held.length === 0 ? <span className="lp-none">{c.noHolder}</span> : held.map(s => (
            <div key={s.id} className="cat-link">
              <strong>{s.name}</strong><small>{[ctx.teams.teamOf(s)?.name && `⚑ ${ctx.teams.teamOf(s)!.name}`, t.stateLabel[stateKey(s)]].filter(Boolean).join(' · ')}</small>
              <span className="st-fill" />
              <Button variant="ghost" size="sm" onClick={() => ctx.dispatch({ type: 'open', id: s.id })}>{c.openSession}</Button>
            </div>
          ))}
        </div>
      </div>
      <p className="cat-ro">✎ {c.roleReadOnly}</p>
    </section>
  );
}

/** The key of `t.stateLabel` a session's state reads as. */
export const stateKey = (s: Pick<Session, 'state'>) =>
  s.state === 'waiting_permission' ? 'approval' : s.state === 'waiting_input' ? 'question' : s.state === 'exited' ? 'done' : s.state === 'idle' ? 'idle' : s.state === 'error' ? 'error' : 'working';

/** A seat's run: the role's defaults, and what the template changes of them (shown apart, « en bleu »). */
function SeatRun({ seat, role }: { seat: Seat; role: Role | undefined }): JSX.Element {
  const { t } = useI18n();
  const base = runOf(role ?? {});
  const over = (['tool', 'model', 'effort'] as const).filter(k => seat[k] !== undefined && seat[k] !== role?.[k]);
  if (over.length === 0) return <span>{base || t.home.catalog.toolDefaults}</span>;
  const changed = over.map(k => (k === 'tool' ? toolName(seat.tool!) : seat[k])).join(' · ');
  return <span>{base && <><span className="def">{base}</span> → </>}<span className="over">{changed}</span></span>;
}

function TemplateDetail({ ctx, cwd, template, roles, onPick }: {
  ctx: DetailCtx; cwd: string | null; template: TeamTemplate; roles: readonly Role[]; onPick(next: CatalogPick, view?: TeamsView): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  const roleOf = (id: string) => roles.find(r => r.id === id);
  const auto = template.seats.filter(s => roleOf(s.role)?.autonomy === 'auto').map(s => `@${s.role}`);
  const project = projectOfFolder(ctx.projects, cwd);
  const born = (ctx.teams.teams ?? []).filter((x: Team) => x.template === template.id && (template.source === 'home' || !cwd || under(x.cwd, cwd)));
  return (
    <section className="cat-detail-body" aria-label={template.name}>
      <div className="cat-head">
        <div>
          <h2><span className="team-flag" aria-hidden>⚑</span> {template.name}</h2>
          <small>{c.template} · {c.seats(template.seats.length)} · <Source source={template.source} /></small>
        </div>
        <div className="cat-actions">
          <Button variant="primary" size="sm" disabled={!project} title={project ? undefined : c.needProject}
            onClick={() => project && ctx.dispatch(launchModal({ project: project.id, team: true, ...(cwd ? { cwd } : {}), template: template.id }))}>{c.launchTeam}</Button>
        </div>
      </div>
      {!project && <p className="cat-ro">{c.needProject}</p>}
      <div className="cat-section">
        <h3>{c.posts}</h3>
        <table className="cat-seats">
          <thead><tr><th>{c.colRole}</th><th>{c.colLabel}</th><th>{c.colRun}</th><th>{c.colAutonomy}</th></tr></thead>
          <tbody>
            {template.seats.map(s => {
              const r = roleOf(s.role);
              const a = r?.autonomy ?? 'ask';
              return (
                <tr key={s.role}>
                  <td><button type="button" className={cls('role-pill', !r && 'bad')} title={r ? c.seeRole(s.role) : c.unknownRole} onClick={() => onPick({ role: s.role }, 'roles')}>@{s.role}</button></td>
                  <td>{r?.label ?? '—'}</td>
                  <td><SeatRun seat={s} role={r} /></td>
                  <td className={`auto-${a}`}>{r ? c.autonomyShort[a] : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="cat-ro"><span className="over">{c.overWord}</span> : {c.overNote}</p>
      </div>
      {auto.length > 0 && <p className="cat-warn" role="note">⚠ {c.autoWarn(auto)}</p>}
      <dl className="cat-facts">
        <FileFact ctx={ctx} path={template.path} />
        <dt>{c.born}</dt>
        <dd>{born.length === 0 ? <span className="lp-none">{c.noneBorn}</span>
          : born.map(x => <span key={x.id} className="cat-born"><span className="team-flag" aria-hidden>⚑</span> {x.name} <small>{x.state === 'resting' ? c.resting : c.active}</small></span>)}</dd>
      </dl>
      <p className="cat-ro">✎ {c.templateReadOnly}</p>
    </section>
  );
}

function ProblemsDetail({ problems }: { problems: readonly DefinitionProblem[] }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  return (
    <section className="cat-detail-body" aria-label={c.ignoredTitle}>
      <div className="cat-head"><div><h2>⚠ {c.ignoredTitle}</h2><small>{c.ignoredBody}</small></div></div>
      <div className="cat-links">
        {problems.map(x => <div key={x.path} className="cat-warn cat-problem"><code>{x.path}</code><span>{x.reason}</span></div>)}
      </div>
    </section>
  );
}

const noHeadings = () => {};
const stayHere = () => {};

/** « Ouvrir »: the file as it is written, read by the local daemon (`document.read`, no session), beside the detail; a role in
 *  Ledge's Markdown reader, a template's YAML as code. Read only: it is changed in the file. */
function FileReader({ client, path, onClose }: { client: DaemonClient; path: string; onClose(): void }): JSX.Element {
  const { t } = useI18n();
  const tp = t.session.pane;
  const errors: Record<string, string> = tp.errors;
  const doc = useDocument(client, undefined, path, true);
  const yaml = /\.ya?ml$/i.test(path);
  const text = doc.status === 'ready' ? doc.text : null;
  const body = useMemo(() => (text === null ? null : yaml ? <pre className="cat-code"><code>{text}</code></pre>
    : <MarkdownDocument text={text} onDocument={stayHere} onHeadings={noHeadings} />), [text, yaml]);
  return (
    <aside className="cat-reader" aria-label={t.home.catalog.reader(folderName(path))}>
      <div className="cat-reader-head">
        <strong>{folderName(path)}</strong><code title={path}>{path}</code>
        <Button variant="ghost" size="sm" aria-label={t.home.tasks.close} title={t.home.tasks.close} onClick={onClose}><Icon d={ICONS.close.d} size={14} /></Button>
      </div>
      <div className="cat-reader-body">
        {doc.status === 'loading' ? <p className="lp-none">{tp.reading}</p>
          // A daemon older than #97 reads no YAML: said so, with what still works.
          : doc.status === 'error' ? <p className="lp-none">{yaml && doc.code === 'unsupported_type' ? t.home.catalog.yamlOutdated : errors[doc.code] ?? tp.errors.other}</p>
          : body}
      </div>
    </aside>
  );
}
