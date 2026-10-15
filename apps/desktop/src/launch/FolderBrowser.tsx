import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/lang';
import { answer, ask, BROWSER_START, childOf, crumbs, unsent, type Browser, type FolderRequest } from './folders';
import { isPathAccepted } from './form';
import type { LaunchFleet } from './useLaunch';

export interface FolderBrowserProps {
  fleet: LaunchFleet;
  machine: string;
  /** The machine's display name (« Devbox · SSH »). */
  label: string;
  ready: boolean;
  /** The form's folder field: listed first when accepted, else home. */
  start: string;
  onChoose(path: string): void;
  onClose(): void;
}

/** The folders of the chosen machine, one at a time, under the folder field (not in the mockup; spec §9.2). */
export function FolderBrowser(p: FolderBrowserProps) {
  const { t } = useI18n(); const b = t.launch.browse;
  const [state, setState] = useState<Browser>(BROWSER_START);
  const [newName, setNewName] = useState<string | null>(null);
  const current = useRef<Browser>(BROWSER_START);
  const props = useRef(p);
  useEffect(() => { props.current = p; });
  const rootRef = useRef<HTMLElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const apply = useCallback((next: Browser) => { current.current = next; setState(next); }, []);
  const send = useCallback((msg: FolderRequest, next: Browser) => {
    apply(props.current.fleet.sendTo(props.current.machine, msg) ? next : unsent(next));
  }, [apply]);
  const list = useCallback((path?: string) => {
    const next = ask(current.current, 'list');
    if (!next) return;
    setNewName(null);
    send(path?.trim() ? { type: 'folder.list', path: path.trim() } : { type: 'folder.list' }, next);
  }, [send]);
  const create = () => {
    const shown = current.current.shown; const name = newName?.trim();
    if (!shown || !name) return;
    const next = ask(current.current, 'create');
    if (next) send({ type: 'folder.create', parent: shown.path, name }, next);
  };

  // One request on open (a second mount in StrictMode is refused by `ask`), focus inside so Escape stays here.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    list(isPathAccepted(props.current.start) ? props.current.start : undefined);
  }, [list]);
  useEffect(() => p.fleet.onMachineMessage((machine, m) => {
    if (machine !== props.current.machine || m.type !== 'folder.listing') return;
    const created = current.current.pending === 'create' && !m.error;
    const { browser, next } = answer(current.current, m);
    if (browser === current.current) return;
    if (next) send(next, browser); else apply(browser);
    if (created) setNewName(null);
  }), [p.fleet, apply, send]);
  // The answer comes back on the connection that asked: once it is gone, stop waiting.
  useEffect(() => { if (!p.ready && current.current.pending) apply(unsent(current.current)); }, [p.ready, apply]);
  useEffect(() => { if (newName !== null) newRef.current?.focus(); }, [newName !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const { shown, pending } = state;
  const loading = pending !== null && pending !== 'create';
  const offline = state.offline || !p.ready;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    if (newName !== null) setNewName(null); else p.onClose();
  };

  return (
    <section ref={rootRef} className="folder-browser" aria-label={b.title(p.label)} onKeyDown={onKeyDown}>
      <div className="folder-browser-top">
        <strong>{b.title(p.label)}</strong>
        <button type="button" className="settings-button" data-initial-focus onClick={p.onClose}>{b.close}</button>
      </div>
      <nav aria-label={b.path} className="folder-crumbs">
        {shown && crumbs(shown.path).map((c, i, all) => (
          <span key={c.path}>
            {i > 1 && <span aria-hidden="true">/</span>}
            {i === all.length - 1
              ? <span aria-current="location">{c.name}</span>
              : <button type="button" onClick={() => list(c.path)}>{c.name}</button>}
          </span>
        ))}
      </nav>
      <div className="folder-list" aria-busy={loading}>
        {newName !== null && (
          <div className="folder-new">
            <input ref={newRef} aria-label={b.newFolderName} value={newName} maxLength={255} autoComplete="off" spellCheck={false}
              onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
            <button type="button" className="settings-button" disabled={!newName.trim() || pending !== null} onClick={create}>{b.create}</button>
          </div>
        )}
        {!shown && loading && <span className="folder-hint">{b.loading}</span>}
        {shown?.parent && <button type="button" className="folder-row" aria-label={b.up} onClick={() => list(shown.parent!)}><span aria-hidden="true">..</span></button>}
        {shown?.entries.map(name => (
          <button key={name} type="button" className="folder-row" aria-label={b.open(name)} onClick={() => list(childOf(shown.path, name))}>
            <span>{name}</span><span aria-hidden="true">›</span>
          </button>
        ))}
        {shown && shown.entries.length === 0 && <span className="folder-hint">{b.empty}</span>}
      </div>
      <div className="folder-actions">
        <button type="button" className="settings-button" disabled={!shown || newName !== null} onClick={() => setNewName('')}>{b.newFolder}</button>
        <button type="button" className="primary" disabled={!shown || loading} onClick={() => shown && p.onChoose(shown.path)}>{b.choose}</button>
      </div>
      {offline
        ? <p role="status" className="folder-error">{b.offline(p.label)}</p>
        : state.error && <p role="status" className="folder-error">{b.failed(state.error)}</p>}
    </section>
  );
}
