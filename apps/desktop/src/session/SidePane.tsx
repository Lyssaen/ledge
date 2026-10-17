import { useCallback, useMemo, type JSX, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { MarkdownDocument, type DocumentHeading } from '@ledge/ui/documents/markdown';
import type { DocumentReference } from '@ledge/ui/documents/references';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { findFile, nameOf, relativeTo, type ChangedFile } from './changes';
import { Delta, FileDiffs } from './DiffView';
import { clampSplit } from './prefs';
import { useDocument } from './useDocument';

export type PaneTab = { kind: 'doc'; path: string } | { kind: 'diff'; path: string } | { kind: 'plan'; key: string };   // plan: task 4
export const tabId = (t: PaneTab): string => `${t.kind}:${t.kind === 'plan' ? t.key : t.path}`;

/** « Agrandir » opens the pane this wide; « Réduire » brings it back to the default. */
const GROWN = 0.65, DEFAULT_SPLIT = 0.5;
/** ← / → on the handle move it this much. */
const SPLIT_STEP = 0.03;

const noHeadings = (_: DocumentHeading[]) => {};
const shownOf = (files: readonly ChangedFile[], path: string, cwd: string) => findFile(files, path, cwd)?.shown ?? relativeTo(path, cwd);

/** A link inside a document, read from beside it: a relative path is joined to the document's folder (the daemon would read
 *  it from the session's folder). The daemon's own `basePath` resolution is not used: the tab is keyed by the path it reads,
 *  so the same document reached from the thread or from another document is one tab. */
export function besideDoc(from: string, path: string): string {
  if (path.startsWith('/') || path.startsWith('~')) return path;
  const parts = from.split('/').slice(0, -1);
  for (const seg of path.split('/')) {
    if (seg === '..') { if (parts.length > 0 && parts.at(-1) !== '..' && parts.at(-1) !== '') parts.pop(); else if (parts.at(-1) !== '') parts.push('..'); }
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

export interface SidePaneProps {
  tabs: readonly PaneTab[]; active: string; onActive(id: string): void; onClose(id: string): void;
  split: number; onSplit(v: number): void;
  /** « Toutes les modifications »: the Changes view on this file. */
  onAllChanges(path: string): void;
  /** A document link inside a document: its tab. */
  onDocument(path: string): void;
  session: Session; files: readonly ChangedFile[]; client: DaemonClient;
}

/** The side pane (session.tsx `sidePane`, `paneDoc`, `dragSplit`): the handle, then the documents and changes opened beside
 *  the thread, a tab each (the bar shows from two), the active one with its head (title, path, « Agrandir », « Fermer »). */
export function SidePane(p: SidePaneProps): JSX.Element | null {
  const { t } = useI18n();
  const tp = t.session.pane;
  const { tabs, active, split, onSplit, files, session } = p;
  const tab = tabs.find(x => tabId(x) === active);
  if (!tab) return null;
  // A change is named by its file as it is now (a renamed one by its new name), below the cwd.
  const pathOf = (x: PaneTab) => (x.kind === 'plan' ? '' : x.kind === 'doc' ? x.path : shownOf(files, x.path, session.cwd));
  const labelOf = (x: PaneTab) => (x.kind === 'doc' ? nameOf(x.path) : x.kind === 'diff' ? tp.diffLabel(nameOf(pathOf(x))) : x.key);

  // Dragged: the pane takes what is right of the pointer (the pointer captured, so leaving the handle does not let go); the
  // split is written once per value it reaches (to the hundredth), not on every move.
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const box = el.parentElement?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    el.setPointerCapture?.(e.pointerId);
    let last = split;
    const move = (ev: PointerEvent) => {
      const x = clampSplit((box.right - ev.clientX) / box.width);
      if (x !== null && x !== last) { last = x; onSplit(x); }
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); onSplit(split + SPLIT_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onSplit(split - SPLIT_STEP); }
  };
  const grown = split >= 0.6;
  const head = (title: string, path: string) => (
    <div className="side-head">
      <span className="side-title"><strong>{title}</strong>{path && <code title={path}>{path}</code>}</span>
      <Button variant="ghost" size="sm" className="side-grow" onClick={() => onSplit(grown ? DEFAULT_SPLIT : GROWN)} title={grown ? tp.shrinkTitle : tp.growTitle}>
        <Icon d={SHELL_ICONS.split} size={13} />{grown ? tp.shrink : tp.grow}
      </Button>
      <Button variant="ghost" size="sm" className="side-close" onClick={() => p.onClose(active)} aria-label={tp.closeTitle} title={tp.closeShort}>
        <Icon d={ICONS.close.d} size={14} /><span>{tp.close}</span>
      </Button>
    </div>
  );
  return (
    <>
      <div className="split-handle" role="separator" aria-orientation="vertical" aria-label={tp.resize} tabIndex={0}
        onPointerDown={drag} onDoubleClick={() => onSplit(DEFAULT_SPLIT)} onKeyDown={onHandleKey} />
      {/* Its width comes from the page's --split (session-split). Focusable: the focus lands here when a tab closes under it. */}
      <aside className="side-pane" aria-label={tp.label} tabIndex={-1}>
        {tabs.length > 1 && (
          <div className="pane-tabs" role="tablist" aria-label={tp.tabs}>
            {tabs.map(x => {
              const id = tabId(x);
              const label = labelOf(x);
              return (
                <div key={id} className={cls('pane-tab', id === active && 'current')}>
                  <button type="button" role="tab" aria-selected={id === active} onClick={() => p.onActive(id)} title={pathOf(x) || undefined}>
                    <Icon d={x.kind === 'diff' ? SHELL_ICONS.diff : x.kind === 'plan' ? SHELL_ICONS.plan : SHELL_ICONS.file} size={12} /><span>{label}</span>
                  </button>
                  <button type="button" className="tab-close" aria-label={tp.closeTab(label)} onClick={() => p.onClose(id)}><Icon d={ICONS.close.d} size={11} /></button>
                </div>
              );
            })}
          </div>
        )}
        {/* Keyed by the tab: another one starts at its top, its own document read. */}
        {tab.kind === 'doc' ? <DocTab key={active} path={tab.path} head={head} session={session} client={p.client} onDocument={p.onDocument} />
          : tab.kind === 'diff' ? <DiffTab key={active} path={tab.path} head={head} files={files} cwd={session.cwd} onAllChanges={p.onAllChanges} />
          : <>{head(tab.key, '')}<div className="side-body" /></>}
      </aside>
    </>
  );
}

type Head = (title: string, path: string) => ReactNode;

/** A document (session.tsx `paneDoc`): read from the session's machine; titled by its front matter, else by its name. */
function DocTab({ path, head, session, client, onDocument }: { path: string; head: Head; session: Session; client: DaemonClient; onDocument(path: string): void }): JSX.Element {
  const { t } = useI18n();
  const tp = t.session.pane;
  const doc = useDocument(client, session.id, path, session.offline !== true);
  const follow = useCallback((ref: DocumentReference) => onDocument(besideDoc(path, ref.path)), [onDocument, path]);
  const errors: Record<string, string> = tp.errors;
  // Parsed again only when its text changes: the page's clock, a drag or the reply's height leave it alone.
  const text = doc.status === 'ready' ? doc.text : null;
  const body = useMemo(() => (text === null ? null : <MarkdownDocument text={text} onDocument={follow} onHeadings={noHeadings} />), [text, follow]);
  return (
    <>
      {head(doc.status === 'ready' ? doc.title ?? nameOf(path) : nameOf(path), path)}
      <div className="side-body">
        {doc.status === 'loading' ? <p className="muted" style={{ padding: 20 }}>{tp.reading}</p>
          : doc.status === 'error' ? <p className="muted" style={{ padding: 20 }}>{errors[doc.code] ?? tp.errors.other}</p>
          : body}
      </div>
    </>
  );
}

/** A file's changes (session.tsx `paneFile`): its badge, +/−, place among the changed files and « Toutes les modifications »,
 *  then its diffs as the Changes view shows them. */
function DiffTab({ path, head, files, cwd, onAllChanges }: { path: string; head: Head; files: readonly ChangedFile[]; cwd: string; onAllChanges(path: string): void }): JSX.Element {
  const { t } = useI18n();
  const tp = t.session.pane;
  const tc = t.session.changes;
  const file = findFile(files, path, cwd);
  return (
    <>
      {head(tp.diffTitle(nameOf(shownOf(files, path, cwd))), shownOf(files, path, cwd))}
      <div className="side-body">
        {file ? (
          <div className="side-diff">
            <div className="side-diff-head">
              <span className={`change-badge change-${file.change}`}>{tc.labels[file.change]}</span>
              <Delta plus={file.plus} minus={file.minus} />
              <span className="spacer" />
              <span className="file-pos mono">{files.indexOf(file) + 1} / {files.length}</span>
              <Button variant="ghost" size="sm" onClick={() => onAllChanges(file.path)}><Icon d={SHELL_ICONS.diff} size={13} />{tp.allChanges}</Button>
            </div>
            <FileDiffs key={file.path} file={file} />
          </div>
        ) : <p className="muted" style={{ padding: 20 }}>{tc.noDiff}</p>}
      </div>
    </>
  );
}
