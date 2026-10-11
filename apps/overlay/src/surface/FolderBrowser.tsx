import { useEffect, useRef, useState } from 'react';
import type { FolderListing } from '../daemon/store';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { transition } from '../motion';
import { DetailHeader } from './DetailHeader';
import { useI18n } from '../i18n/lang';

/** What the browser asks the daemon; each is answered with a `folder.listing`. */
export type FolderRequest = { type: 'folder.list'; path?: string } | { type: 'folder.create'; parent: string; name: string };
type Shown = Omit<FolderListing, 'seq' | 'error'>;
/** What the pending request was, which decides how its answer (or its refusal) lands. */
type Asked = 'list' | 'create' | 'fallback';

const hint: React.CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, height: 36, flexShrink: 0, padding: '0 8px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontSize: 13, transition: transition([['background-color', 'hover']]) };
const field: React.CSSProperties = { height: 32, boxSizing: 'border-box', padding: '0 10px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'inherit', flexGrow: 1, minWidth: 0 };

const childOf = (path: string, name: string) => (path === '/' ? `/${name}` : `${path}/${name}`);
/** The breadcrumb: the root, then each folder down to `path`, with the path that lists it. */
const crumbs = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  return [{ name: '/', path: '/' }, ...parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` }))];
};

export interface FolderBrowserProps {
  /** The folder to open on (the form's field); home when empty. */
  start: string;
  /** The daemon's last answer, from the store: only one newer than the pending request is taken. */
  listing: FolderListing | null;
  onFolders: (m: FolderRequest) => void;
  onChoose: (path: string) => void; onBack: () => void; onClose: () => void;
}

/**
 * The launch form's folder browser: the subfolders of one folder at a time, a breadcrumb to go back up, a new folder
 * made in place. It lives in the form's layer so the form keeps what was typed; Escape or ‹ returns to it.
 */
export function FolderBrowser(p: FolderBrowserProps) {
  const { t } = useI18n();
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ asked: Asked; after: number } | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const ask = (m: FolderRequest, asked: Asked) => { setPending({ asked, after: p.listing?.seq ?? 0 }); p.onFolders(m); };
  const list = (path?: string) => { setError(null); setNewName(null); ask(path?.trim() ? { type: 'folder.list', path: path.trim() } : { type: 'folder.list' }, 'list'); };
  const create = () => { if (shown && newName?.trim()) ask({ type: 'folder.create', parent: shown.path, name: newName.trim() }, 'create'); };

  // Focus moves into the browser (its back button), so the keyboard, Escape included, stays with it.
  useEffect(() => { rootRef.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus(); list(p.start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const l = p.listing;
    if (!l || !pending || l.seq <= pending.after) return;
    const { asked } = pending;
    setPending(null);
    const { seq: _, error: why, ...at } = l;
    if (why) {
      setError(why);
      // A refused creation lists its parent: stay there with the name to fix. A folder that cannot be listed leaves
      // the browser where it was, or falls back to home on the first one.
      if (asked === 'create') setShown(at);
      else if (!shown && asked === 'list') ask({ type: 'folder.list' }, 'fallback');
      return;
    }
    setShown(at);
    if (asked !== 'fallback') setError(null);
    if (asked === 'create') setNewName(null);
    listRef.current?.scrollTo?.({ top: 0 });
  }, [p.listing?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (newName !== null) newRef.current?.focus(); }, [newName !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = !shown || (!!pending && pending.asked !== 'create');
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Escape belongs to the browser: it never reaches the surface, which would leave the form for the list.
    e.preventDefault(); e.stopPropagation();
    if (newName !== null) setNewName(null); else p.onBack();
  };

  return (
    <div ref={rootRef} data-layer="browse" onKeyDown={onKeyDown} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <DetailHeader title={t.browse.title} backLabel={t.browse.back} onBack={p.onBack} onClose={p.onClose} />
      {/* Reversed so a short path sits on the left while a long one is clipped on its left, keeping the current folder. */}
      <nav aria-label={t.browse.path} className="mono" style={{ display: 'flex', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden', flexShrink: 0, padding: '8px 17px', borderBottom: '1px solid var(--sidebar-border)', fontSize: 12, whiteSpace: 'nowrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {shown && crumbs(shown.path).map((c, i, all) => {
            const last = i === all.length - 1;
            return (
              <span key={c.path} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                {i > 1 && <span aria-hidden="true" style={hint}>/</span>}
                {last
                  ? <span aria-current="location" style={{ padding: '2px 4px', fontWeight: 600 }}>{c.name}</span>
                  : <button type="button" className="ledge-recent" onClick={() => list(c.path)} style={{ ...row, height: 24, padding: '0 4px', fontSize: 12, fontFamily: 'inherit', color: 'var(--muted-foreground)' }}>{c.name}</button>}
              </span>
            );
          })}
        </span>
      </nav>
      <div ref={listRef} className="ledge-scroll" style={{ overflowY: 'auto', minHeight: 0, flexGrow: 1, overscrollBehavior: 'contain' }}>
        <div aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 9px', opacity: loading && shown ? 0.6 : 1, transition: transition([['opacity', 'hover']]) }}>
          {newName !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px' }}>
              <Icon size={16} {...ICONS.folderPlus} />
              <input ref={newRef} aria-label={t.browse.newFolderName} className="ledge-field" value={newName} onChange={e => setNewName(e.target.value)} autoComplete="off" spellCheck={false}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} style={field} />
              <Button variant="secondary" size="sm" disabled={!newName.trim() || !!pending} onClick={create}>{t.browse.create}</Button>
            </div>
          )}
          {!shown && <span style={{ ...hint, padding: '8px' }}>{t.browse.loading}</span>}
          {shown?.parent && (
            <button type="button" aria-label={t.browse.up} className="ledge-recent" onClick={() => list(shown.parent!)} style={row}>
              <Icon size={16} {...ICONS.folderUp} /><span className="mono" style={hint}>..</span>
            </button>
          )}
          {shown?.entries.map(name => (
            <button key={name} type="button" aria-label={t.browse.open(name)} className="ledge-recent" onClick={() => list(childOf(shown.path, name))} style={row}>
              <Icon size={16} {...ICONS.folder} />
              <span style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
              <Icon size={14} {...ICONS.chevronRight} />
            </button>
          ))}
          {shown && shown.entries.length === 0 && <span style={{ ...hint, padding: '8px' }}>{t.browse.empty}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 17px 14px', borderTop: '1px solid var(--sidebar-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Button variant="outline" disabled={!shown || newName !== null} onClick={() => { setError(null); setNewName(''); }}><Icon size={16} {...ICONS.folderPlus} />{t.browse.newFolder}</Button>
          <Button variant="primary" disabled={loading} onClick={() => shown && p.onChoose(shown.path)}>{t.browse.choose}</Button>
        </div>
        {error && <span role="status" style={{ ...hint, color: 'var(--danger-text)' }}>{t.browse.failed(error)}</span>}
      </div>
    </div>
  );
}
