import { useEffect, useId, useState } from 'react';
import { PROJECT_COLORS, projectNameKey, type PhoneFolder, type PhoneProject, type ProjectColor } from '@ledge/protocol';
import { copy } from '../copy';
import type { ChatAction } from '../state/chat';
import { useMobile, type MobileStore } from '../state/store';
import { Button, IconButton } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { FIELD } from '../ui/field';
import { Icon } from '../ui/icons';

const P = copy.settings.projects;
const COLORS = Object.keys(PROJECT_COLORS) as ProjectColor[];
const NAME_MAX = 80;

/** What the user reads of an outcome that is not `applied`. */
const why = (r: ChatAction): string => P.errors[r.status === 'rejected' ? r.reason : r.status] ?? P.errors.failed!;

/** `ids` with the project at `from` moved one place up (-1) or down (+1). */
export function moved(ids: readonly string[], from: number, by: -1 | 1): string[] {
  const to = from + by;
  if (to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

function Dot({ color }: { color: ProjectColor }) {
  return <span className="size-3 flex-none rounded-full" style={{ background: PROJECT_COLORS[color] }} aria-hidden="true" />;
}

/** The eight colours, as radios drawn as discs. */
function ColorPicker({ value, onChange, name }: { value: ProjectColor; onChange: (c: ProjectColor) => void; name: string }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-small text-muted">{P.color}</legend>
      <div className="flex flex-wrap gap-2">
        {COLORS.map(c => (
          <label key={c} className="grid size-10 cursor-pointer place-items-center rounded-full border border-line has-[:checked]:border-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-info">
            <input type="radio" name={name} value={c} checked={value === c} onChange={() => onChange(c)} className="sr-only" aria-label={P.colors[c]} />
            <span className="size-6 rounded-full" style={{ background: PROJECT_COLORS[c] }} aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** « Nouveau projet » or « Modifier le projet »: its name and colour; from an edit, the way to delete it. */
function EditSheet({ store, project, projects, onClose, onDelete, onFolders }: { store: MobileStore; project: PhoneProject | null; projects: readonly PhoneProject[]; onClose: () => void; onDelete: () => void; onFolders: (() => void) | null }) {
  const id = useId();
  const used = new Set(projects.map(p => p.color));
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState<ProjectColor>(project?.color ?? COLORS.find(c => !used.has(c)) ?? 'blue');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const taken = trimmed !== '' && projects.some(p => p.id !== project?.id && projectNameKey(p.name) === projectNameKey(trimmed));
  const same = project !== null && trimmed === project.name && color === project.color;
  const save = () => {
    if (!trimmed || taken || busy) return;
    if (same) { onClose(); return; }
    setBusy(true); setError(null);
    const change = project ? { ...(trimmed !== project.name ? { name: trimmed } : {}), ...(color !== project.color ? { color } : {}) } : null;
    void (project ? store.editProject(project.id, change!) : store.createProject(trimmed, color)).then(r => {
      setBusy(false);
      if (r.status === 'applied') onClose(); else setError(why(r));
    });
  };
  return (
    <Sheet labelledBy={`${id}-title`} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px]">{project ? P.editTitle : P.newTitle}</h2>
      {!project && <p className="text-body text-muted">{P.newBody}</p>}
      <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); save(); }}>
        <label className="flex flex-col gap-1.5">
          <span className="text-small text-muted">{P.name}</span>
          <input className={FIELD} value={name} maxLength={NAME_MAX} autoFocus aria-invalid={taken || undefined} onChange={e => setName(e.target.value)} />
          {taken && <span role="alert" className="text-small text-danger-fg">{P.errors.name_taken}</span>}
        </label>
        <ColorPicker name={`${id}-color`} value={color} onChange={setColor} />
        {error && <p role="alert" className="text-small text-danger-fg">{error}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{P.cancel}</Button>
          <Button variant="primary" type="submit" className="flex-[2]" disabled={busy || !trimmed || taken}>{project ? P.save : P.create}</Button>
        </div>
        {project && onFolders && <Button disabled={busy} onClick={onFolders}>{P.folders}</Button>}
        {project && <Button variant="ghost" className="text-danger-fg!" disabled={busy} onClick={onDelete}>{P.remove}</Button>}
      </form>
    </Sheet>
  );
}

/** « Supprimer … ? »: how many agents it has, where they go (no project, or another one), then the device's check. */
function DeleteSheet({ store, project, projects, agents, onClose }: { store: MobileStore; project: PhoneProject; projects: readonly PhoneProject[]; agents: number; onClose: () => void }) {
  const id = useId();
  const canConfirm = !!useMobile(store).device?.confirm;
  const others = projects.filter(p => p.id !== project.id);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setBusy(true); setError(null);
    void store.deleteProject(project.id, moveTo).then(r => {
      setBusy(false);
      if (r.status === 'applied') onClose(); else setError(why(r));
    });
  };
  return (
    // While the passkey and the PC's answer are awaited, nothing closes the sheet: the outcome must land here.
    <Sheet labelledBy={`${id}-title`} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px]">{P.deleteTitle(project.name)}</h2>
      <p className="text-body text-muted">{P.deleteAgents(agents)}</p>
      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-small text-muted">{P.deleteWhere}</legend>
        <label className="flex items-center gap-2"><input type="radio" name={`${id}-move`} checked={moveTo === null} onChange={() => setMoveTo(null)} />{P.noProject}</label>
        <label className="flex items-center gap-2"><input type="radio" name={`${id}-move`} checked={moveTo !== null} disabled={others.length === 0} onChange={() => setMoveTo(others[0]?.id ?? null)} />{P.moveTo}</label>
        {moveTo !== null && (
          <select className={FIELD} aria-label={P.target} value={moveTo} onChange={e => setMoveTo(e.target.value)}>
            {others.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </fieldset>
      <p className={`rounded-control border border-dashed border-input px-3 py-2 text-small ${canConfirm ? 'text-muted' : 'text-attention'}`}>{canConfirm ? P.passkey : P.noPasskey}</p>
      {error && <p role="alert" className="text-small text-danger-fg">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{P.cancel}</Button>
        <Button variant="primary" className="flex-[2]" disabled={busy || !canConfirm} onClick={go}>{P.confirmDelete}</Button>
      </div>
    </Sheet>
  );
}

/** Where a folder is: this PC, or the machine's label (its id without one). */
const whereOf = (f: PhoneFolder) => (f.machine === 'local' ? P.thisPc : f.label ?? f.machine);
const baseName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? '/';
const ROW = 'flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0';

/**
 * « Dossiers de … »: the project's folders, each removable, then « Ajouter un dossier », which browses this PC's folders (its recent
 * ones first) and adds the one shown after the device's check.
 */
function FoldersSheet({ store, project, onClose }: { store: MobileStore; project: PhoneProject; onClose: () => void }) {
  const id = useId();
  const state = useMobile(store);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => { store.requestProjectFolders(project.id); }, [store, project.id]);
  useEffect(() => { if (picking) { store.requestRecentFolders(); store.listFolder(); setAt(null); } }, [store, picking]);
  const folders = state.projectFolders[project.id];
  const listing = state.folderListing;
  // The listing shown is the one last asked: until it comes, the folder asked is said to be read.
  const shown = listing && (at === null || listing.path === at) ? listing : null;
  const go = (path: string) => { setAt(path); setError(null); store.listFolder(path); };
  const canConfirm = !!state.device?.confirm;
  const settle = (r: ChatAction, after: () => void) => {
    setBusy(false);
    if (r.status === 'applied') { store.requestProjectFolders(project.id); after(); } else setError(why(r));
  };
  const remove = (f: PhoneFolder) => { setBusy(true); setError(null); void store.removeFolder(project.id, f.machine, f.path).then(r => settle(r, () => undefined)); };
  const add = (path: string) => { setBusy(true); setError(null); void store.addFolder(project.id, path).then(r => settle(r, () => setPicking(false))); };
  const close = () => { if (!busy) onClose(); };

  if (picking) {
    const recents = (state.recentFolders ?? []).filter(p => !(Array.isArray(folders) && folders.some(f => f.machine === 'local' && f.path === p)));
    return (
      <Sheet labelledBy={`${id}-title`} onClose={close}>
        <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px]">{P.pickTitle}</h2>
        <div className="flex max-h-[55dvh] flex-col gap-3 overflow-y-auto">
          {at === null && recents.length > 0 && (
            <section aria-label={P.recents} className="flex flex-col gap-1.5">
              <h3 className="text-small text-muted">{P.recents}</h3>
              <ul className="flex flex-col rounded-control border border-line">
                {recents.map(p => (
                  <li key={p} className={ROW}>
                    <span className="min-w-0 flex-1 font-mono text-small break-all">{p}</span>
                    <Button size="sm" aria-label={P.addThisLabel(p)} disabled={busy || !canConfirm} onClick={() => add(p)}>{P.addShort}</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-label={P.browse} className="flex flex-col gap-1.5">
            <h3 className="text-small text-muted">{P.browse}</h3>
            {!shown ? <p role="status" className="text-small text-muted">{P.loadingFolder}</p> : (
              <>
                <p className="font-mono text-small break-all">{shown.path}</p>
                {shown.error && <p role="alert" className="text-small text-danger-fg">{P.folderErrors[shown.error]}</p>}
                <ul className="flex flex-col rounded-control border border-line">
                  {shown.parent && (
                    <li className={ROW}><button type="button" className="flex min-h-10 flex-1 items-center gap-2 text-left" onClick={() => go(shown.parent!)}><Icon name="back" className="size-4" />{P.parent}</button></li>
                  )}
                  {shown.entries.map(name => {
                    const repo = shown.repos.find(r => r.name === name);
                    return (
                      <li key={name} className={ROW}>
                        <button type="button" aria-label={P.open(name)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left" onClick={() => go(`${shown.path === '/' ? '' : shown.path}/${name}`)}>
                          <span className="truncate">{name}</span>
                          {repo && <span className="flex-none rounded-full bg-raised px-2 text-meta text-muted">⎇ {repo.branch}</span>}
                        </button>
                      </li>
                    );
                  })}
                  {!shown.error && shown.entries.length === 0 && <li className="px-3 py-2.5 text-small text-muted">{P.empty}</li>}
                </ul>
                {shown.cut && <p className="text-meta text-muted">{P.cut}</p>}
              </>
            )}
          </section>
        </div>
        <p className="text-small text-muted">{P.onlyThisPc}</p>
        <p className={`rounded-control border border-dashed border-input px-3 py-2 text-small ${canConfirm ? 'text-muted' : 'text-attention'}`}>{canConfirm ? P.folderPasskey : P.noPasskey}</p>
        {error && <p role="alert" className="text-small text-danger-fg">{error}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => { setPicking(false); setError(null); }}>{P.back}</Button>
          <Button variant="primary" className="flex-[2]" disabled={busy || !canConfirm || !shown || !!shown.error} aria-label={shown ? P.addThisLabel(shown.path) : P.addThis}
            onClick={() => { if (shown) add(shown.path); }}>{P.addThis}</Button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet labelledBy={`${id}-title`} onClose={close}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px]">{P.foldersTitle(project.name)}</h2>
      {folders === undefined ? <p role="status" className="text-small text-muted">{P.foldersLoading}</p>
        : folders === 'gone' ? <p role="alert" className="text-small text-danger-fg">{P.errors.stale}</p>
        : folders.length === 0 ? <p className="text-body text-muted">{P.foldersNone}</p>
        : (
          <ul className="flex max-h-[45dvh] flex-col overflow-y-auto rounded-control border border-line">
            {folders.map(f => (
              <li key={`${f.machine}\n${f.path}`} className={ROW}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{baseName(f.path)}</span>
                  <span className="font-mono text-meta break-all text-muted">{f.path} · {whereOf(f)}</span>
                </span>
                <Button size="sm" variant="ghost" aria-label={P.removeFolderLabel(f.path)} disabled={busy || !state.fresh} onClick={() => remove(f)}>{P.removeFolder}</Button>
              </li>
            ))}
          </ul>
        )}
      {error && <p role="alert" className="text-small text-danger-fg">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{P.close}</Button>
        <Button variant="primary" className="flex-[2]" disabled={busy || !state.fresh || folders === 'gone'} onClick={() => { setError(null); setPicking(true); }}><Icon name="plus" className="size-4" />{P.addFolder}</Button>
      </div>
    </Sheet>
  );
}

/**
 * Réglages › Projets (`daemon.projectEdit`): the projects in their order, each with its colour and its agents; moved up or down,
 * renamed, recoloured, created empty, deleted after the device's check. Their folders stay the PC's.
 */
export function ProjectsSection({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  const [editing, setEditing] = useState<PhoneProject | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PhoneProject | null>(null);
  const [foldersOf, setFoldersOf] = useState<PhoneProject | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.daemon?.projectEdit || !state.daemon.atelier) return null;
  const projects = state.projects;
  const agentsOf = (pid: string) => [...state.sessions.values()].filter(s => s.projectId === pid && s.state !== 'exited').length;
  const off = !state.fresh || ordering;
  const move = (i: number, by: -1 | 1) => {
    setOrdering(true); setError(null);
    void store.orderProjects(moved(projects.map(p => p.id), i, by)).then(r => {
      setOrdering(false);
      if (r.status !== 'applied') setError(why(r));
    });
  };
  return (
    <section aria-labelledby="projects-title" className="flex flex-col gap-2.5">
      <h2 id="projects-title" className="text-small font-medium text-muted">{P.title}</h2>
      <ul className="flex flex-col rounded-[10px] border border-line bg-surface text-body">
        {projects.length === 0 && <li className="px-4 py-3 text-muted">{P.none}</li>}
        {projects.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
            <Dot color={p.color} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{p.name}</span>
              <span className="text-small text-muted">{P.agents(agentsOf(p.id))}</span>
            </span>
            <IconButton label={P.up(p.name)} disabled={off || i === 0} onClick={() => move(i, -1)}><Icon name="arrowUp" className="size-4" /></IconButton>
            <IconButton label={P.down(p.name)} disabled={off || i === projects.length - 1} onClick={() => move(i, 1)}><Icon name="arrowUp" className="size-4 rotate-180" /></IconButton>
            <Button size="sm" aria-label={P.editLabel(p.name)} disabled={!state.fresh} onClick={() => setEditing(p)}>{P.edit}</Button>
          </li>
        ))}
      </ul>
      <Button disabled={!state.fresh} onClick={() => setEditing('new')}><Icon name="plus" className="size-4" />{P.add}</Button>
      {error && <p role="alert" className="text-small text-danger-fg">{error}</p>}
      <p className="text-small text-muted">{state.daemon.projectFolders ? P.folders_note : P.folders_note_old}</p>
      {editing !== null && (
        <EditSheet store={store} project={editing === 'new' ? null : editing} projects={projects} onClose={() => setEditing(null)}
          onDelete={() => { if (editing !== 'new') { setDeleting(editing); setEditing(null); } }}
          onFolders={state.daemon.projectFolders ? () => { if (editing !== 'new') { setFoldersOf(editing); setEditing(null); } } : null} />
      )}
      {foldersOf && <FoldersSheet store={store} project={foldersOf} onClose={() => setFoldersOf(null)} />}
      {deleting && <DeleteSheet store={store} project={deleting} projects={projects} agents={agentsOf(deleting.id)} onClose={() => setDeleting(null)} />}
    </section>
  );
}
