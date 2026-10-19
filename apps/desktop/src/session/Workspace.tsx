import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from 'react';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { ptyBackend } from '../term/backend';
import { agentMode } from '../term/mode';
import { TermStoreContext } from '../term/useTerms';
import { clampTermWidth, type SessionPrefs } from './prefs';
import { memoKey } from './memory';
import { SessionPage, type SessionPageProps } from './SessionPage';
import { TermPane } from './TermPane';
import { subagentOf } from './exchanges';
import { useThread } from './useThread';

/** The terminal's xterm comes with this chunk, never in the first bundle: App's terminal store makes them through it. */
export { createSurface } from '../term/surface';

/** ← / → on the terminal's handle move it this much. */
const TERM_STEP = 0.02;

export interface WorkspaceProps extends Omit<SessionPageProps, 'items' | 'helper' | 'onShowKids' | 'onTerminal' | 'split' | 'onSplit'> {
  prefs: SessionPrefs; setPrefs(fn: (p: SessionPrefs) => SessionPrefs): void;
  /** « N sous-agents »: the sidebar tree unfolds this session and scrolls to it. */
  onRevealCurrent(): void;
}

/** The session place (the mockup's conversation-workspace): the page, and the terminal's column when asked for (O), as wide
 *  as its handle says, or alone once enlarged. The project's agents and their subagents are the sidebar tree's.
 *  It asks for the thread and finds the subagent of the place: live in session.helpers, else its thread row; a subagent
 *  known by neither (its thread not there yet, or gone) still gets its page, named by what is known. It lives as long as the
 *  session place: switching agent changes its props (useThread follows the id) and mounts a new SessionPage only. */
export function Workspace({ client, prefs, setPrefs, onRevealCurrent, ...p }: WorkspaceProps): JSX.Element {
  const items = useThread(client, p.session);
  const { t } = useI18n();
  const unnamed = t.session.subagent;
  const id = p.nav.place.kind === 'session' ? p.nav.place.helper : undefined;
  // The same object while nothing it is read from changes: the thread is memoised on it.
  const helper = useMemo(() => (id === undefined ? null : subagentOf(p.session, items, id, unnamed)), [p.session, items, id, unnamed]);
  // « N sous-agents »: the subagents show (if hidden) and the sidebar tree unfolds this session.
  const showKids = () => {
    if (!p.nav.helpers) p.dispatch({ type: 'helpers' });
    onRevealCurrent();
  };
  const store = useContext(TermStoreContext);
  // The same answer as the pane's own, so the store attaches in the mode the pane shows.
  const [hasBackend] = useState(() => ptyBackend() !== null);
  // The agent's screen is attached while the pane shows it (re-asking in the same mode keeps the attachment), detached once hidden.
  useEffect(() => {
    if (prefs.terminal) store?.showAgent(p.session.id, agentMode(p.session, helper, hasBackend));
    else store?.hideAgent();
  }, [store, prefs.terminal, p.session, helper, hasBackend]);
  useEffect(() => () => store?.hideAgent(), [store]);
  // « Agrandir le terminal » lasts while the pane shows: hiding it forgets it.
  const [maxed, setMaxed] = useState(false);
  if (maxed && !prefs.terminal) setMaxed(false);
  // The pane names a subagent as the top bar does, by its kind.
  const sub = useMemo(() => (helper ? { id: helper.id, name: helper.kind } : null), [helper]);
  const toggleTerminal = () => setPrefs(x => ({ ...x, terminal: !x.terminal }));
  return (
    <div className={cls('conversation-workspace', prefs.terminal && 'with-terminal', prefs.terminal && maxed && 'term-maxed')} style={{ '--term-width': prefs.termWidth } as CSSProperties}>
      {/* Only the page starts over for each agent (its key): the terminal stays. */}
      <SessionPage key={memoKey(p.session.id, helper?.id)} {...p} items={items} helper={helper} onShowKids={showKids} onTerminal={toggleTerminal}
        client={client} split={prefs.split} onSplit={v => setPrefs(x => ({ ...x, split: v }))} />
      {prefs.terminal && !maxed && <TermHandle label={t.session.terminal.resize} width={prefs.termWidth} onWidth={v => setPrefs(x => ({ ...x, termWidth: v }))} />}
      {prefs.terminal && (
        <TermPane client={client} session={p.session} helper={sub} notify={p.notify} maxed={maxed} onMax={() => setMaxed(m => !m)}
          onClose={() => setPrefs(x => ({ ...x, terminal: false }))} onGoParent={() => p.dispatch({ type: 'open', id: p.session.id })} />
      )}
    </div>
  );
}

/** The terminal column's left edge: dragged, or ← / → once focused (the column grows to the left). Each width it reaches is
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
