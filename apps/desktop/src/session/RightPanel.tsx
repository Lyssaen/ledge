import { useCallback, useLayoutEffect, useRef, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { useMachines, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { tildeHome } from '../term/home';
import { changesTabId, type Tab, type TermStore } from '../term/store';
import { useTerms } from '../term/useTerms';
import { Banner } from './AgentView';

export type RightPanelProps = {
  client: DaemonClient; session: Session;
  /** The « ± Modifications » tab's content (Changes, in its narrow layout) and its count (null: the thread is not there yet). */
  changes: ReactNode; count: number | null;
  maxed: boolean; onMax(): void; onClose(): void;
};

/** Opens a shell in the session's folder (on its machine) and makes it the panel's tab, its first line saying where it runs:
 *  « + », and OMP's « Ouvrir un shell ». */
export function openShell(store: TermStore, session: Session, intro: (tab: Tab) => string): string {
  const id = store.newShell(session.id);
  store.select(session.id, id);
  const tab = store.tabs(session.id).find(x => x.id === id);
  if (tab?.status === 'running') store.surface(id)?.write(`${intro(tab)}\r\n`);
  return id;
}

/** A shell's first line: where it runs, in whose folder. */
export function useShellIntro(client: DaemonClient, session: Session): (tab: Tab) => string {
  const { t } = useI18n();
  const tt = t.session.terminal;
  const home = useMachines(client).find(m => m.id === (session.machineId ?? 'local'))?.daemon?.home;
  const host = session.machineId && session.machineId !== 'local' ? machineOf(session) : tt.local;
  return tab => (tab.remote ? tt.shellIntroSsh(host, session.name, tildeHome(tab.dir, home)) : tt.shellIntro(session.name, tildeHome(tab.dir, home)));
}

/** The right panel (Fil | Terminal v3): « ± Modifications » first, fixed, then your shells, then « + »; it reopens on the tab
 *  last used. The agent's screen is not here: it is the session's Terminal view, on the left. On a subagent's page `session`
 *  is its parent (the shells are the session's). */
export function RightPanel(p: RightPanelProps): JSX.Element {
  const { session } = p;
  const { t } = useI18n();
  const tt = t.session.terminal;
  const tp = t.session.panel;
  const sid = session.id;
  const { tabs, active, store } = useTerms(sid);
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  const shell = tabs.find(x => x.id === active);
  const surface = useSyncExternalStore(subscribe, () => (shell ? store.surface(shell.id) : undefined));
  const remote = !!session.machineId && session.machineId !== 'local';
  const host = remote ? machineOf(session) : tt.local;
  // Folders read from the session's machine's home (`~/…`) when its daemon gives it.
  const home = useMachines(p.client).find(m => m.id === (session.machineId ?? 'local'))?.daemon?.home;
  const folder = (dir: string) => tildeHome(dir, home);
  const body = useRef<HTMLDivElement>(null);
  // A tab clicked, a shell added or reopened: its screen takes the keyboard once it is in.
  const take = useRef(false);

  useLayoutEffect(() => {
    const want = take.current;
    take.current = false;
    const el = body.current;
    if (!el || !surface) return;
    // The xterm moves in, never re-made: its screen and scrollback stay.
    for (const c of [...el.children]) if (c !== surface.host) c.remove();
    if (surface.host.parentElement !== el) el.appendChild(surface.host);
    surface.fit();
    if (want) surface.focus();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => surface.fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [surface]);
  // Asked in a render that did not change the screen: not for the next screen to come in.
  useLayoutEffect(() => { take.current = false; });

  const label = (x: Tab) => tt.shellTab(x.n, folder(x.dir));
  const intro = useShellIntro(p.client, session);
  /** Starts or restarts a shell through `act`, its first line saying where it runs, before the shell's own output. */
  const starting = (id: string, act: () => void) => {
    const before = store.surface(id);
    const was = store.tabs(sid).find(x => x.id === id);
    act();
    if (surface && store.surface(id) === surface) surface.focus();
    else take.current = true;
    const after = store.tabs(sid).find(x => x.id === id);
    if (!after || after.status !== 'running' || was?.status === 'running') return;
    store.surface(id)?.write(`${before ? '\r\n' : ''}${intro(after)}\r\n`);
  };
  const select = (id: string) => starting(id, () => store.select(sid, id));
  const addShell = () => { take.current = true; openShell(store, session, intro); };

  const banner = shell?.status === 'unavailable' ? <Banner>{tt.shellUnavailable}</Banner>
    : shell?.status === 'ended'
      ? <Banner action={<Button variant="outline" size="sm" onClick={() => starting(shell.id, () => store.reopen(sid, shell.id))}>{tt.reopen}</Button>}>{shell.end?.lost ? tt.shellLost : shell.end?.code == null ? tt.shellEndedNoCode : tt.shellEnded(shell.end.code)}</Banner>
      : null;
  const changesOn = active === changesTabId(sid) || !shell;

  return (
    <section className="right-panel" role="region" aria-label={tp.label}>
      <div className="pane-heading term-heading">
        <div className="term-tabs" role="tablist" aria-label={tp.label}>
          <div className={cls('term-tab', changesOn && 'current')}>
            <button type="button" role="tab" aria-selected={changesOn} onClick={() => store.select(sid, changesTabId(sid))}>
              <Icon d={SHELL_ICONS.diff} size={12} /><span>{t.session.views.changes}</span>{p.count !== null && <span className="tab-count mono">{p.count}</span>}
            </button>
          </div>
          {tabs.map(x => (
            <div key={x.id} className={cls('term-tab', x.id === active && 'current')}>
              <button type="button" role="tab" aria-selected={x.id === active} onClick={() => select(x.id)}>
                <Icon d={SHELL_ICONS.terminal} size={12} /><span>{label(x)}</span>
              </button>
              <button type="button" className="tab-close" aria-label={tt.closeTab(label(x))} onClick={() => store.close(sid, x.id)}><Icon d={ICONS.close.d} size={11} /></button>
            </div>
          ))}
          <button type="button" className="term-add" aria-label={tt.addShell} title={tt.addShell} onClick={addShell}><Icon d={ICONS.plus.d} size={13} /></button>
        </div>
        <span className="spacer" />
        {!changesOn && <span className="term-chip mono">{shell.remote ? tt.remote(host) : tt.local}</span>}
        <Button variant="ghost" size="icon" className="term-icon" onClick={p.onMax} aria-label={p.maxed ? tp.unmax : tp.max} title={p.maxed ? tp.unmax : tp.max}>
          <Icon d={p.maxed ? SHELL_ICONS.collapse : ICONS.expand.d} size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="term-icon" onClick={p.onClose} aria-label={t.top.panelHide} title={t.top.panelHideTitle}><Icon d={ICONS.close.d} size={14} /></Button>
      </div>
      {changesOn ? <div className="panel-changes">{p.changes}</div> : (
        <>
          {banner}
          {/* Keyed: leaving the screen drops its div, and the xterm moved into it with it (the store keeps the xterm). */}
          {surface ? <div key={shell.id} ref={body} className="terminal-screen" /> : <div key="blank" className="terminal-screen" />}
          <div className="terminal-footer">
            <span className={cls('term-dot', shell.status === 'running' ? 'on' : 'off')} aria-hidden="true">●</span>
            {shell.status === 'running' && <span>{tt.shell}</span>}
            <span className="mono">{tt.shellTarget(shell.remote ? host : undefined)}</span>
          </div>
        </>
      )}
    </section>
  );
}
