import { useCallback, useContext, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { agentMode } from '../term/mode';
import { changesTabId } from '../term/store';
import { TermStoreContext } from '../term/useTerms';
import { changedFiles, findFile } from './changedFiles';
import { Changes } from './Changes';
import { clampTermWidth, type SessionPrefs, type SessionView } from './prefs';
import { memoKey } from './memory';
import { openShell, RightPanel, useShellIntro } from './RightPanel';
import { SessionPage, type PageApi, type SessionPageProps } from './SessionPage';
import { subagentOf } from './exchanges';
import { useThread } from './useThread';
import { useHasBackend } from './AgentView';
import { useAgentScreen } from './useAgentScreen';

/** The terminal's xterm comes with this chunk, never in the first bundle: App's terminal store makes them through it. */
export { createSurface } from '../term/surface';
/** An IDE « Modifications » tab: its diffs come with this chunk too (ChangesPlace). */
export { ChangesTab } from './ChangesTab';
/** An IDE terminal tab of an agent. */
export { AgentTerminalTab } from './AgentTerminalTab';
// A bottom-panel shell (IDE lot 5): its xterm comes with this chunk.
export { FreeShellView } from './FreeShellView';

/** ← / → on the panel's handle move it this much. */
const TERM_STEP = 0.02;

export interface WorkspaceProps extends Omit<SessionPageProps, 'items' | 'helper' | 'onShowKids' | 'onPanel' | 'split' | 'onSplit' | 'view' | 'onView' | 'files' | 'changes' | 'onAllChanges' | 'api' | 'onOpenShell'> {
  prefs: SessionPrefs; setPrefs(fn: (p: SessionPrefs) => SessionPrefs): void;
  /** « N sous-agents »: the sidebar tree unfolds this session and scrolls to it. */
  onRevealCurrent(): void;
  /** In an IDE tab, where there is no right panel: the session's shell in the bottom panel, shown, the keyboard in it, its first
   *  line saying where it runs (OMP's « Ouvrir un shell »). */
  onShell?(session: Session, intro: (at: { dir: string; remote: boolean }) => string): void;
}

/** The session place (Fil | Terminal v3): the page, whose left view is the thread or the agent's screen, and the right panel
 *  when asked for (O), « ± Modifications » and the shells, as wide as its handle says, or alone once enlarged. It asks for the
 *  thread and finds the subagent of the place: live in session.helpers, else its thread row; a subagent known by neither (its
 *  thread not there yet, or gone) still gets its page, named by what is known. It lives as long as the session place:
 *  switching agent changes its props (useThread follows the id) and mounts a new SessionPage only. */
export function Workspace({ client, prefs, setPrefs, onRevealCurrent, onShell, ...p }: WorkspaceProps): JSX.Element {
  const items = useThread(client, p.session);
  const { t } = useI18n();
  const unnamed = t.session.subagent;
  const id = p.nav.place.kind === 'session' ? p.nav.place.helper : undefined;
  // The same object while nothing it is read from changes: the thread is memoised on it.
  const helper = useMemo(() => (id === undefined ? null : subagentOf(p.session, items, id, unnamed)), [p.session, items, id, unnamed]);
  const key = memoKey(p.session.id, helper?.id);
  // « N sous-agents »: the subagents show (if hidden) and the sidebar tree unfolds this session.
  const showKids = () => {
    if (!p.nav.helpers) p.dispatch({ type: 'helpers' });
    onRevealCurrent();
  };
  const store = useContext(TermStoreContext);
  // A pseudo-terminal, or a daemon that streams the pane: either can show the agent's screen. The stream arrives with the snapshot.
  const hasBackend = useHasBackend(client, p.session);
  const view = prefs.view;
  // The agent's screen is attached while the Terminal view shows it (in an IDE tab: its own view, R2), detached once left.
  const sid = p.session.id;
  const mode = agentMode(p.session, helper, hasBackend);
  useAgentScreen(sid, mode, view === 'terminal');
  // « Agrandir le panneau » lasts while the panel shows: hiding it forgets it.
  const [maxed, setMaxed] = useState(false);
  if (maxed && !prefs.terminal) setMaxed(false);
  // No right panel in an IDE tab (R4): the changes go by « +N −N », the shells by the bottom panel.
  const panel = prefs.terminal && !p.ide;
  const togglePanel = () => setPrefs(x => ({ ...x, terminal: !x.terminal }));
  const onView = useCallback((v: SessionView) => setPrefs(x => (x.view === v ? x : { ...x, view: v })), [setPrefs]);

  /* « ± Modifications »: the files the shown agent changed, the one shown and the narrow list, for each page anew. */
  const loaded = items !== undefined;
  const files = useMemo(() => (items ? changedFiles(items, p.session.cwd, helper?.id) : []), [items, p.session.cwd, helper?.id]);
  const [chg, setChg] = useState<{ key: string; file: string | null; listOpen: boolean }>({ key, file: null, listOpen: false });
  const own = chg.key === key ? chg : { key, file: null, listOpen: false };
  // Functional: a row clicked sets the file and closes the list in the same event.
  const setOwn = (patch: Partial<typeof own>) => setChg(c => ({ ...(c.key === key ? c : { key, file: null, listOpen: false }), ...patch }));
  // The file asked for (findFile), else the first.
  const current = (own.file === null ? undefined : findFile(files, own.file, p.session.cwd)) ?? files[0];
  const subscribe = useCallback((fn: () => void) => (store ? store.subscribe(fn) : () => {}), [store]);
  const panelTab = useSyncExternalStore(subscribe, () => store?.active(p.session.id) ?? null);
  const changesShown = panel && loaded && panelTab === changesTabId(p.session.id);
  const stepFile = (d: 1 | -1) => {
    if (!current) return;
    setOwn({ file: files[(files.indexOf(current) + d + files.length) % files.length]!.path });
  };
  // « Toutes les modifications » (the side pane's change): the panel, on Modifications, on that file.
  const onAllChanges = (path: string) => {
    // In the IDE there is no right panel: the session's Changes tab, beside, on that file.
    if (p.ide) { p.onChanges?.(path); return; }
    setOwn({ file: path, listOpen: false });
    store?.select(p.session.id, changesTabId(p.session.id));
    if (!prefs.terminal) setPrefs(x => ({ ...x, terminal: true }));
  };
  // « Edit · tour 2 »: the page lights the action in the thread (it owns the thread).
  const api = useRef<PageApi | null>(null);
  const intro = useShellIntro(client, p.session);
  // OMP's « Ouvrir un shell »: a shell in the right panel, shown, and the keyboard in it; in the IDE, the bottom panel's.
  const onOpenShell = () => {
    if (p.ide) { onShell?.(p.session, intro); return; }
    if (!store) return;
    const shellId = openShell(store, p.session, intro);
    if (!prefs.terminal) setPrefs(x => ({ ...x, terminal: true }));
    requestAnimationFrame(() => store.surface(shellId)?.focus());
  };
  const changes = !loaded
    ? <div className="changes-empty"><p className="muted">{p.session.offline ? t.session.thread.notLoaded : t.session.thread.loading}</p></div>
    : <Changes files={files} current={current?.path ?? null} onFile={f => setOwn({ file: f })} onTouch={tool => api.current?.showInThread(tool)}
        listOpen={own.listOpen} onListOpen={o => setOwn({ listOpen: o })} session={p.session} name={helper?.kind ?? p.session.name} notify={p.notify} />;
  return (
    <div className={cls('conversation-workspace', panel && 'with-terminal', panel && maxed && 'term-maxed')} style={{ '--term-width': prefs.termWidth } as CSSProperties}>
      {/* Only the page starts over for each agent (its key): the panel stays. */}
      <SessionPage key={key} {...p} items={items} helper={helper} onShowKids={showKids} onPanel={togglePanel}
        client={client} split={prefs.split} onSplit={v => setPrefs(x => ({ ...x, split: v }))} view={view} onView={onView} files={files}
        changes={{ shown: changesShown, listOpen: own.listOpen, closeList: () => setOwn({ listOpen: false }), step: stepFile }}
        onAllChanges={onAllChanges} api={api} onOpenShell={onOpenShell} />
      {panel && !maxed && <TermHandle label={t.session.panel.resize} width={prefs.termWidth} onWidth={v => setPrefs(x => ({ ...x, termWidth: v }))} />}
      {panel && (
        <RightPanel client={client} session={p.session} changes={changes} count={loaded ? files.length : null}
          maxed={maxed} onMax={() => setMaxed(m => !m)} onClose={() => setPrefs(x => ({ ...x, terminal: false }))} />
      )}
    </div>
  );
}

/** The right panel's left edge: dragged, or ← / → once focused (the column grows to the left). Each width it reaches is
 *  written once, bounded. */
function TermHandle({ label, width, onWidth }: { label: string; width: number; onWidth(v: number): void }): JSX.Element {
  // Compared with the width as last written (a drag's moves come between renders).
  const last = useRef(width);
  last.current = width;
  const set = (v: number) => {
    const x = clampTermWidth(v);
    if (x !== last.current) { last.current = x; onWidth(x); }
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const box = el.parentElement?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => set((box.right - ev.clientX) / box.width);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); set(last.current + TERM_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); set(last.current - TERM_STEP); }
  };
  return <div className="term-handle" role="separator" aria-orientation="vertical" aria-label={label} tabIndex={0} onPointerDown={drag} onKeyDown={onKey} />;
}
