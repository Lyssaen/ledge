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

type Check = { id: string; machine: string; label: string; path: string };

/** The project editor's folder browser (the mockup's FolderPicker): a machine, then its folders from the home it resolves, the Git
 *  repositories with their branch; or a path typed and checked on its machine. Nothing is added before the machine has answered. */
export function FolderPicker(p: {
  client: DaemonClient; machines: readonly MachineState[];
  taken(machine: string, path: string): boolean; onAdd(repo: Repo & { branch: string | null }): void;
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
      onAdd.current({ machine: check.machine, path: check.path, branch: info.branch });
      setTyped(''); setError('');
    });
    const timer = setTimeout(() => { setCheck(null); setError(c.timeout); }, LISTING_TIMEOUT_MS);
    client.send({ type: 'repos.inspect', requestId: check.id, paths: [check.path], machineId: check.machine });
    return () => { off(); clearTimeout(timer); };
  }, [check, client, c]);

  const pickMachine = (id: string) => { setMachineId(id); setDir(undefined); setError(''); setCheck(null); };
  const addTyped = () => {
    if (!typed.trim() || machineId === null || check) return;
    if (!online) { setError(c.offlinePath(label)); return; }
    const path = normalizePath(typed);
    if (!path.startsWith('/')) { setError(c.absolute); return; }
    if (p.taken(machineId, path)) { setError(c.alreadyListed); return; }
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
            <nav className="picker-crumbs mono" aria-label={c.crumbs}>
              {crumbsOf(shown).map((x, i) => (
                <Fragment key={x}>
                  {i > 0 && <span aria-hidden="true">/</span>}
                  <button type="button" onClick={() => (x === shown ? retry() : setDir(x))} aria-current={x === shown ? 'location' : undefined}>{x === '/' ? c.root : baseName(x)}</button>
                </Fragment>
              ))}
            </nav>
          )}
          {listing.status === 'error' ? (
            <p className="picker-offline" role="status">
              {listing.message === 'offline' ? c.offlineBody(label) : listing.message}
              <button type="button" className="picker-retry" onClick={retry}>{c.retry}</button>
            </p>
          ) : (
            <ul className="picker-list" aria-label={shown === undefined ? undefined : c.contents(shown, label)} aria-busy={listing.status === 'loading'}>
              {listing.status === 'ready' && (
                <>
                  {listing.parent !== null && (
                    <li><button type="button" className="picker-name" onClick={() => setDir(listing.parent!)}><Icon d={PARENT_ICON} size={14} />{c.parent}</button></li>
                  )}
                  {listing.entries.map(name => {
                    const path = childOf(listing.path, name);
                    const branch = listing.repos.get(name);
                    const git = branch !== undefined;
                    const added = p.taken(machineId!, path);
                    return (
                      <li key={name} className={git ? 'is-git' : ''}>
                        <button type="button" className="picker-name" onClick={() => setDir(path)} title={c.open(name)}>
                          <Icon d={git ? ICONS.branch.d : ICONS.folder.d} size={14} /><span>{name}</span><Icon d={ICONS.chevronRight.d} size={12} />
                        </button>
                        {git ? <span className="picker-branch mono">⎇ {branch}</span> : <span className="picker-branch">{c.noGit}</span>}
                        <Button size="sm" variant={git ? 'outline' : 'ghost'} disabled={added} onClick={() => p.onAdd({ machine: machineId!, path, branch: branch ?? null })}
                          aria-label={added ? c.addedLabel(name) : c.addLabel(name, label)}>
                          {added ? <><Icon d={ICONS.check.d} size={13} />{c.added}</> : c.add}
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
    </div>
  );
}
