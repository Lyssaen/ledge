import { Fragment, useEffect, useId, useRef, useState, type JSX } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { normalizePath, type Repo } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { isUp } from '../launch/model';
import { LISTING_TIMEOUT_MS, useFolderListing } from './useFolderListing';

const PARENT_ICON = ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-1'];
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path;
const childOf = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
/** `/`, then each folder down to `path` (absolute). */
function crumbsOf(path: string): string[] {
  const out = ['/'];
  for (const part of path.split('/').filter(Boolean)) out.push(childOf(out[out.length - 1]!, part));
  return out;
}
let next = 0;
/** A path with a `.` or `..` segment: normalizePath does not resolve them, so it would match no saved repository. */
const dotted = (path: string) => path.split('/').some(x => x === '.' || x === '..');
/** The daemon's words for a folder that is not there (resolveExact, or the raw fs error of a race): said as « not found ». */
const MISSING = /^(no such folder|not a folder): |^(ENOENT|ENOTDIR)\b/;

/** A folder name the daemon would refuse (createFolder): a `/`, a NUL, or a `.` / `..` of its own. */
const badName = (name: string) => name === '.' || name === '..' || /[/\0]/.test(name);
/** The daemon's words for a name already taken in the folder (createFolder). */
const EXISTS = /^already exists: /;

type Check = { id: string; machine: string; label: string; path: string };
type Creation = { id: string; machine: string; label: string; parent: string; name: string };

/** The project editor's folder browser (the mockup's FolderPicker): a machine, then its folders from the home it resolves, the Git
 *  repositories with their branch; or a path typed and checked on its machine; or a new folder made in the one shown (#32), listed
 *  ready to add once the machine has made it. Nothing is added before the machine has answered.
 *  `taken`: already in the draft (« Ajouté »); `owner`: the name of another project that has it (« Déjà dans {p} »), else null. */
export function FolderPicker(p: {
  client: DaemonClient; machines: readonly MachineState[];
  taken(machine: string, path: string): boolean; owner?(machine: string, path: string): string | null; onAdd(repo: Repo & { branch: string | null }): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.projects.picker;
  const { client, machines } = p;
  const [machineId, setMachineId] = useState<string | null>(() => (machines.find(m => m.id === 'local' && isUp(m)) ?? machines.find(isUp) ?? machines[0])?.id ?? null);
  const [dir, setDir] = useState<string | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** The new folder's name while its field is open, null when closed; its creation in flight; the last one made, to focus and announce. */
  const [newName, setNewName] = useState<string | null>(null);
  const [newError, setNewError] = useState('');
  const [creation, setCreation] = useState<Creation | null>(null);
  const [created, setCreated] = useState<{ machine: string; path: string; name: string; label: string } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fieldId = useId();
  const current = machines.find(m => m.id === machineId);
  const online = !!current && isUp(current);
  const label = current?.label ?? machineId ?? '';
  const listing = useFolderListing(client, online ? machineId : null, dir, attempt);
  const retry = () => setAttempt(n => n + 1);
  // The folder shown: the one the machine resolved once it answered (the home's `~` expanded), the one asked meanwhile.
  const shown = listing.status === 'ready' ? listing.path : dir;

  // A typed path's check: its own requestId; the answer adds the repository, or says it is not there. A silence is said too.
  const onAdd = useRef(p.onAdd);
  onAdd.current = p.onAdd;
  const taken = useRef(p.taken);
  taken.current = p.taken;
  const ownerOf = (machine: string, path: string) => p.owner?.(machine, path) ?? null;
  const owner = useRef(ownerOf);
  owner.current = ownerOf;
  const machinesNow = useRef(machines);
  machinesNow.current = machines;
  useEffect(() => {
    if (!check) return;
    const off = client.onMessage(m => {
      if (m.type !== 'repos.info' || m.requestId !== check.id) return;
      const info = m.repos.find(r => r.path === check.path);
      setCheck(null);
      if (!info?.exists) {
        // The fleet answers « not found » for every path of a machine that dropped: that is said as offline.
        const m = machinesNow.current.find(x => x.id === check.machine);
        setError(m && isUp(m) ? c.notFound(check.label) : c.offlinePath(check.label));
        return;
      }
      if (taken.current(check.machine, check.path)) { setError(c.alreadyListed); return; }   // added from the list meanwhile
      const other = owner.current(check.machine, check.path);
      if (other !== null) { setError(c.ownedBy(other)); return; }                             // another project took it meanwhile
      onAdd.current({ machine: check.machine, path: check.path, branch: info.branch });
      setTyped(''); setError('');
    });
    const timer = setTimeout(() => { setCheck(null); setError(c.timeout); }, LISTING_TIMEOUT_MS);
    client.send({ type: 'repos.inspect', requestId: check.id, paths: [check.path], machineId: check.machine });
    return () => { off(); clearTimeout(timer); };
  }, [check, client, c]);

  // A creation: its own requestId; the machine's answer lists the new folder (or the parent with why it refused). Made, the folder
  // shown is listed again, with the new one ready to add; refused or silent, the field keeps the name to fix.
  useEffect(() => {
    if (!creation) return;
    const off = client.onMessage(m => {
      if (m.type !== 'folder.listing' || m.requestId !== creation.id) return;
      setCreation(null);
      if (m.error === undefined) { setNewName(null); setNewError(''); setCreated({ machine: creation.machine, path: m.path, name: creation.name, label: creation.label }); setAttempt(n => n + 1); return; }
      setNewError(m.error === 'offline' ? c.createOffline(creation.label) : EXISTS.test(m.error) ? c.exists(creation.name) : c.createFailed(m.error));
    });
    const timer = setTimeout(() => { setCreation(null); setNewError(c.createTimeout(creation.label)); }, LISTING_TIMEOUT_MS);
    client.send({ type: 'folder.create', parent: creation.parent, name: creation.name, machineId: creation.machine, requestId: creation.id });
    return () => { off(); clearTimeout(timer); };
  }, [creation, client, c]);
  // The folder just made, once listed: its « Add » takes the focus.
  useEffect(() => {
    if (!created || listing.status !== 'ready' || created.machine !== machineId || childOf(listing.path, created.name) !== created.path) return;
    listRef.current?.querySelector<HTMLElement>(`li[data-name="${CSS.escape(created.name)}"] button[data-add]`)?.focus();
  }, [created, listing, machineId]);

  const closeNew = () => { setNewName(null); setNewError(''); setCreation(null); };
  const go = (path: string) => { setDir(path); closeNew(); };
  const pickMachine = (id: string) => { setMachineId(id); setDir(undefined); setError(''); setCheck(null); closeNew(); setCreated(null); };
  const create = () => {
    if (newName === null || creation || machineId === null || listing.status !== 'ready') return;
    const name = newName.trim();
    if (!name) { setNewError(c.nameEmpty); return; }
    if (badName(name)) { setNewError(c.nameInvalid); return; }
    setNewError('');
    setCreation({ id: `create-${++next}`, machine: machineId, label, parent: listing.path, name });
  };
  const addTyped = () => {
    if (!typed.trim() || machineId === null || check) return;
    if (!online) { setError(c.offlinePath(label)); return; }
    const path = normalizePath(typed);
    if (!path.startsWith('/') || dotted(path)) { setError(c.absolute); return; }
    if (p.taken(machineId, path)) { setError(c.alreadyListed); return; }
    const other = ownerOf(machineId, path);
    if (other !== null) { setError(c.ownedBy(other)); return; }
    setError('');
    setCheck({ id: `typed-${++next}`, machine: machineId, label, path });
  };

  return (
    <div className="picker">
      <div className="picker-machines" role="radiogroup" aria-label={c.machines}>
        {machines.map(m => {
          const up = isUp(m);
          return (
            <label key={m.id} className={`chip ${machineId === m.id ? 'selected' : ''}`}>
              <input type="radio" name="picker-machine" checked={machineId === m.id} onChange={() => pickMachine(m.id)} />
              <i className={`machine-dot ${up ? '' : 'off'}`} />{m.label}{!up && <small>{c.offline}</small>}
            </label>
          );
        })}
      </div>
      {online ? (
        <>
          {shown !== undefined && (
            <div className="picker-bar">
              <nav className="picker-crumbs mono" aria-label={c.crumbs}>
                {crumbsOf(shown).map((x, i) => (
                  <Fragment key={x}>
                    {i > 0 && <span aria-hidden="true">/</span>}
                    <button type="button" onClick={() => (x === shown ? retry() : go(x))} aria-current={x === shown ? 'location' : undefined}>{x === '/' ? c.root : baseName(x)}</button>
                  </Fragment>
                ))}
              </nav>
              {listing.status === 'ready' && newName === null && (
                <Button size="sm" variant="ghost" className="picker-new" onClick={() => { setNewName(''); setNewError(''); }}><Icon d={ICONS.folderPlus.d} size={13} />{c.newFolder}</Button>
              )}
            </div>
          )}
          {newName !== null && listing.status === 'ready' && (
            <div className="picker-create">
              <Icon d={ICONS.folderPlus.d} size={14} />
              <input autoFocus className="mono" value={newName} spellCheck={false} autoComplete="off" aria-label={c.newFolderName(listing.path, label)}
                onChange={e => { setNewName(e.target.value); setNewError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); create(); }
                  // Escape closes the field only: the dialog around stays open.
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNew(); }
                }}
                aria-invalid={!!newError} aria-describedby={newError ? `${fieldId}-new-error` : undefined} />
              <Button size="sm" disabled={!newName.trim() || creation !== null} onClick={create}>{creation ? c.creating : c.create}</Button>
              <Button size="sm" variant="ghost" onClick={closeNew}>{c.cancel}</Button>
            </div>
          )}
          {newError && <p id={`${fieldId}-new-error`} className="set-error" role="alert">{newError}</p>}
          {listing.status === 'error' ? (
            <p className="picker-offline" role="status">
              {listing.message === 'offline' ? c.offlineBody(label) : MISSING.test(listing.message) ? c.notFound(label) : listing.message}
              <button type="button" className="picker-retry" onClick={retry}>{c.retry}</button>
            </p>
          ) : (
            <ul ref={listRef} className="picker-list" aria-label={shown === undefined ? undefined : c.contents(shown, label)} aria-busy={listing.status === 'loading'}>
              {listing.status === 'ready' && (
                <>
                  {listing.parent !== null && (
                    <li><button type="button" className="picker-name" onClick={() => go(listing.parent!)}><Icon d={PARENT_ICON} size={14} />{c.parent}</button></li>
                  )}
                  {listing.entries.map(name => {
                    const path = childOf(listing.path, name);
                    const branch = listing.repos.get(name);
                    const git = branch !== undefined;
                    const added = p.taken(machineId!, path);
                    const other = added ? null : ownerOf(machineId!, path);
                    return (
                      <li key={name} className={git ? 'is-git' : ''} data-name={name}>
                        <button type="button" className="picker-name" onClick={() => go(path)} title={c.open(name)}>
                          <Icon d={git ? ICONS.branch.d : ICONS.folder.d} size={14} /><span>{name}</span><Icon d={ICONS.chevronRight.d} size={12} />
                        </button>
                        {git ? <span className="picker-branch mono">⎇ {branch}</span> : <span className="picker-branch">{c.noGit}</span>}
                        <Button size="sm" variant={git ? 'outline' : 'ghost'} data-add disabled={added || other !== null} onClick={() => p.onAdd({ machine: machineId!, path, branch: branch ?? null })}
                          aria-label={added ? c.addedLabel(name) : other !== null ? c.ownedLabel(name, other) : c.addLabel(name, label)}>
                          {added ? <><Icon d={ICONS.check.d} size={13} />{c.added}</> : other !== null ? c.ownedBy(other) : c.add}
                        </Button>
                      </li>
                    );
                  })}
                </>
              )}
            </ul>
          )}
        </>
      ) : (
        <p className="picker-offline">{c.offlineBody(label)}</p>
      )}
      <div className="picker-typed">
        <label className="visually-hidden" htmlFor={fieldId}>{c.typed(label)}</label>
        <input id={fieldId} className="mono" value={typed} placeholder={c.typedPlaceholder(label)} spellCheck={false}
          onChange={e => { setTyped(e.target.value); setError(''); setCheck(null); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addTyped(); } }}
          aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined} />
        <Button size="sm" disabled={!typed.trim() || check !== null} onClick={addTyped}>{c.add}</Button>
      </div>
      {error && <p id={`${fieldId}-error`} className="set-error" role="alert">{error}</p>}
      <p className="visually-hidden" role="status">{created ? c.created(created.name, created.label) : ''}</p>
    </div>
  );
}
