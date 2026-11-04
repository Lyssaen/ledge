import { useCallback, useEffect, useState, type JSX } from 'react';
import { shellCommand, type DaemonClient } from '@ledge/fleet';
import type { NoteInfo } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { ThreadMarkdown, splitMarkdownFrontmatter } from '@ledge/ui/documents/markdown';
import { useI18n } from '../i18n/lang';
import { useDocument } from '../session/useDocument';
import { isTauri, openTerminal } from '../tauri/bridge';
import { Card } from './controls';
import type { SettingsContext } from './SettingsPage';

/** How long the notes' `brain.result` is waited for. */
const LIST_TIMEOUT_MS = 8000;
let seq = 0;

type Listed = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; dir: string; notes: NoteInfo[] };

/** One `brain.*` request to the local daemon, answered by its `brain.result` (null when it does not come in time). */
function ask(client: DaemonClient, make: (rid: string) => Parameters<DaemonClient['send']>[0]): Promise<{ reason?: string; dir?: string; notes?: NoteInfo[] } | null> {
  return new Promise(resolve => {
    const rid = `brain-${Date.now()}-${++seq}`;
    const done = (r: { reason?: string; dir?: string; notes?: NoteInfo[] } | null) => { clearTimeout(timer); off(); resolve(r); };
    const off = client.onMessage(m => { if (m.type === 'brain.result' && m.rid === rid) done(m); });
    const timer = setTimeout(() => done(null), LIST_TIMEOUT_MS);
    client.send(make(rid));
  });
}

const day = (iso: string, locale: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

/** A note opened in place: the local daemon reads it (`document.read`, an absolute path), rendered as the threads render Markdown. */
function NoteText({ client, path }: { client: DaemonClient; path: string }): JSX.Element {
  const { t } = useI18n();
  const doc = useDocument(client, undefined, path, true);
  if (doc.status === 'loading') return <p className="set-hint">{t.settings.notes.loading}</p>;
  if (doc.status === 'error') return <p className="set-error" role="alert">{t.settings.notes.readFailed}</p>;
  return <div className="note-text"><ThreadMarkdown text={splitMarkdownFrontmatter(doc.text).body} /></div>;
}

/**
 * Settings › Notes (docs/mockups/ledge-brain-notes.html, part 3): what Ledge knows of the user's notes and what it offers of them,
 * read from the local daemon. A page to read: a note's text changes in its file. « Vérifiée aujourd'hui » (its `checked`) and
 * « Effacer le signalement » are the only writes.
 */
export function Notes({ ctx }: { ctx: SettingsContext }): JSX.Element {
  const { t } = useI18n();
  const c = t.settings.notes;
  const client = ctx.client;
  const [list, setList] = useState<Listed>({ status: 'loading' });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const take = useCallback((r: Awaited<ReturnType<typeof ask>>) => {
    if (r?.notes && r.dir !== undefined) setList({ status: 'ready', dir: r.dir, notes: r.notes });
    else if (!r) setList(l => (l.status === 'ready' ? l : { status: 'failed' }));
  }, []);
  useEffect(() => {
    let live = true;
    void ask(client, rid => ({ type: 'brain.list', rid })).then(r => { if (live) take(r); });
    return () => { live = false; };
  }, [client, take]);
  const act = async (n: NoteInfo, op: 'checked' | 'unflag') => {
    setBusy(`${n.name}:${op}`); setError(null);
    const r = await ask(client, rid => ({ type: 'brain.note', rid, note: n.name, op }));
    setBusy(null);
    take(r);
    if (!r) setError(c.failed);
    else if (r.reason) setError(r.reason);
    else ctx.saved(c.done[op](n.name));
  };
  const local = ctx.machines.find(m => m.id === 'local');
  const folder = list.status === 'ready' && local && isTauri() ? shellCommand(local, list.dir) : null;
  const locale = t.time.locale;

  return (
    <>
      <Card title={c.title} hint={c.intro}>
        <div className="set-row">
          <div className="set-copy">
            <span className="set-label mono">{list.status === 'ready' ? list.dir : '~/.ledge/context'}</span>
            {list.status === 'ready' && <span className="set-hint">{c.count(list.notes.length)}</span>}
          </div>
          {folder && <div className="set-control"><Button variant="outline" size="sm" title={c.openFolderHint} onClick={() => { void openTerminal(c.title, folder); }}>{c.openFolder}</Button></div>}
        </div>
        {list.status === 'loading' && <p className="set-hint notes-state">{c.loading}</p>}
        {list.status === 'failed' && <p className="set-error notes-state" role="alert">{c.failed}</p>}
        {list.status === 'ready' && list.notes.length === 0 && <p className="set-hint notes-state">{c.none}</p>}
        {error && <p className="set-error notes-state" role="alert">{error}</p>}
        {list.status === 'ready' && list.notes.map(n => {
          const path = `${list.dir.replace(/\/$/, '')}/${n.file}`;
          return (
            <div key={n.name} className="note-row" data-note={n.name}>
              <div className="note-main">
                <span className="set-label">{n.title} <code className="note-name">{n.name}</code></span>
                <span className="set-hint">{n.when ? c.when(n.when) : c.firstLine(n.firstLine)}</span>
                <div className="note-chips">
                  <span className={n.scope === 'all' ? 'set-tag' : 'set-tag note-scope'}>{c.scope[n.scope]}</span>
                  <span className="set-tag">{n.projects.length ? c.projects(n.projects.join(', ')) : c.allProjects}</span>
                  <span className={n.oldDays ? 'set-tag note-old' : 'set-tag'}>{n.checkedAt ? c.checked(day(n.checkedAt, locale)) : c.modified(day(n.modifiedAt, locale))}{n.oldDays ? ` · ${c.old}` : ''}</span>
                  {n.additions > 0 && <span className="set-tag">{c.additions(n.additions)}</span>}
                  {n.truncated && <span className="set-tag note-old">{c.truncated}</span>}
                </div>
              </div>
              <div className="note-side">
                <Button variant="outline" size="sm" aria-expanded={open === n.name} onClick={() => setOpen(open === n.name ? null : n.name)}>{open === n.name ? c.close : c.open}</Button>
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => { void act(n, 'checked'); }}>{c.checkToday}</Button>
              </div>
              {n.flag && (
                <div className="note-flag">
                  <strong>{c.flagged}</strong>
                  <span>{n.flag.what} · {c.flagBy(n.flag.by, day(n.flag.at, locale))}</span>
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => { void act(n, 'unflag'); }}>{c.unflag}</Button>
                </div>
              )}
              {open === n.name && <NoteText client={client} path={path} />}
            </div>
          );
        })}
      </Card>
      <p className="set-footnote">{c.footer}</p>
    </>
  );
}
