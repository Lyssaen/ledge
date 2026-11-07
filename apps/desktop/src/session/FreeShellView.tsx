import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type JSX } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { TermStoreContext, useFreeShell } from '../term/useTerms';
import { useTabPlace } from '../workspace/tabPlace';
import { Banner } from './AgentView';

/** A bottom-panel shell (`shell:<n>`), in a panel tile or a dock tab: its xterm, moved in, never re-made (its screen and
 *  scrollback stay); ended, the right panel's banner and « Rouvrir »; unavailable, its banner. */
export function FreeShellView({ id }: { id: string }): JSX.Element {
  const { t } = useI18n();
  const tt = t.session.terminal;
  const store = useContext(TermStoreContext);
  if (!store) throw new Error('FreeShellView needs a TermStoreContext provider');
  const shell = useFreeShell(id);
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  const surface = useSyncExternalStore(subscribe, () => store.surface(id));
  const body = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !surface) return;
    for (const c of [...el.children]) if (c !== surface.host) c.remove();
    if (surface.host.parentElement !== el) el.appendChild(surface.host);
    surface.fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => surface.fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [surface]);
  // Shown = its xterm is in a visible place: the WebGL budget goes to the terminals shown last.
  const visible = useTabPlace()?.visible !== false;
  const shown = !!surface && visible;
  useEffect(() => {
    if (!shown) return;
    store.setShown(id, true);
    return () => store.setShown(id, false);
  }, [store, id, shown]);

  const reopen = () => { store.reopenFree(id); store.surface(id)?.focus(); };
  const banner = shell?.status === 'unavailable' ? <Banner>{tt.shellUnavailable}</Banner>
    : shell?.status === 'ended'
      ? <Banner action={<Button variant="outline" size="sm" onClick={reopen}>{tt.reopen}</Button>}>{shell.end?.lost ? tt.shellLost : shell.end?.code == null ? tt.shellEndedNoCode : tt.shellEnded(shell.end.code)}</Banner>
      : null;
  return (
    <div className="ide-free-shell">
      {banner}
      {surface ? <div key="screen" ref={body} className="terminal-screen" /> : <div key="blank" className="terminal-screen" />}
    </div>
  );
}
