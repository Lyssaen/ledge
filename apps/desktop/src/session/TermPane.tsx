import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type JSX, type ReactNode } from 'react';
import { useDaemon, useMachines, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { ptyBackend } from '../term/backend';
import { tildeHome } from '../term/home';
import { useBackquote } from '../term/keys';
import { agentMode } from '../term/mode';
import { agentTabId, type Tab } from '../term/store';
import type { TermSurface } from '../term/surface';
import { useTerms } from '../term/useTerms';
import { openSessionTerminal } from './terminal';

type ShellTab = Extract<Tab, { kind: 'shell' }>;
export type TermPaneProps = {
  client: DaemonClient; session: Session; helper: { id: string; name: string } | null; notify(text: string): void;
  maxed: boolean; onMax(): void; onClose(): void; onGoParent(): void;
};

/** The terminal beside the conversation (the mockup's TermPane): the agent's screen and your shells in tabs, a banner for the
 *  states where the screen cannot be typed into (T3, T4), and a footer with the link's state. On a subagent's page `session`
 *  is its parent. Without a screen to attach (the browser build, an offline machine, a session with no tmux pane) the agent
 *  tab shows the daemon's preview of its last lines (session.preview), read only. */
export function TermPane(p: TermPaneProps): JSX.Element {
  const { session, helper } = p;
  const { t } = useI18n();
  const tt = t.session.terminal;
  const sid = session.id;
  const { tabs, active, link, store } = useTerms(sid);
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  // Not in useTerms: the store makes the agent's xterm when it starts attaching, before the link says anything.
  const agentSurface = useSyncExternalStore(subscribe, () => store.surface(agentTabId(sid)));
  const activeSurface = useSyncExternalStore(subscribe, () => store.surface(active));
  const [hasBackend] = useState(() => ptyBackend() !== null);
  const mode = agentMode(session, helper, hasBackend);
  const lines = useDaemon().previews.get(sid) ?? [];
  const remote = !!session.machineId && session.machineId !== 'local';
  const host = remote ? machineOf(session) : tt.local;
  const tab = tabs.find(x => x.id === active) ?? tabs[0]!;
  // Folders read from the session's machine's home (`~/…`) when its daemon gives it.
  const home = useMachines(p.client).find(m => m.id === (session.machineId ?? 'local'))?.daemon?.home;
  const folder = (dir: string) => tildeHome(dir, home);
  // live or parent with nothing attached (no argv for it): the preview, without the « hors de Ledge » banner.
  const screen = mode.kind === 'live' || mode.kind === 'parent' || mode.kind === 'offline' ? agentSurface : undefined;
  const shown: TermSurface | undefined = tab.kind === 'agent' ? screen : activeSurface;
  const typing = tab.kind === 'agent' ? mode.kind === 'live' && link.state === 'attached' : tab.status === 'running';

  const now = useCountdown(link.state === 'reconnecting');
  const key = useBackquote();
  const [focused, setFocused] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // A tab clicked, a shell added or reopened: its screen takes the keyboard once it is in, as Ctrl + ² does.
  const take = useRef(false);

  useLayoutEffect(() => {
    const want = take.current;
    take.current = false;
    const el = body.current;
    if (!el || !shown) return;
    // The xterm moves in, never re-made: its screen and scrollback stay.
    for (const c of [...el.children]) if (c !== shown.host) c.remove();
    if (shown.host.parentElement !== el) el.appendChild(shown.host);
    shown.fit();
    if (want) shown.focus();
    // A tab change takes the focus away with the xterm it moves out, without a blur everywhere.
    setFocused(el.contains(document.activeElement));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => shown.fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);
  // Asked in a render that did not change the screen: not for the next screen to come in.
  useLayoutEffect(() => { take.current = false; });

  const label = (x: Tab) => (x.kind === 'agent' ? tt.agentTab(session.name) : tt.shellTab(x.n, folder(x.dir)));
  /** Starts or restarts a shell through `act`, its first line saying where it runs, before the shell's own output. */
  const starting = (id: string, act: () => void) => {
    const before = store.surface(id);
    const was = store.tabs(sid).find(x => x.id === id);
    act();
    if (shown && store.surface(id) === shown) shown.focus();
    else take.current = true;
    const after = store.tabs(sid).find((x): x is ShellTab => x.id === id && x.kind === 'shell');
    if (!after || after.status !== 'running' || (was?.kind === 'shell' && was.status === 'running')) return;
    const intro = after.remote ? tt.shellIntroSsh(host, session.name, folder(after.dir)) : tt.shellIntro(session.name, folder(after.dir));
    store.surface(id)?.write(`${before ? '\r\n' : ''}${intro}\r\n`);
  };
  const select = (id: string) => starting(id, () => store.select(sid, id));
  const addShell = () => {
    const first = tabs.find((x): x is ShellTab => x.kind === 'shell');
    const id = store.addShell(sid, first?.dir ?? session.workdir ?? session.cwd, first?.remote ?? remote);
    select(id);
  };
  const external = () => { void openSessionTerminal(p.client, session).then(ok => { if (!ok) p.notify(tt.openFailed(session.name)); }); };
  const onBlur = (e: FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); };

  const banner = ((): ReactNode => {
    if (tab.kind === 'shell') {
      if (tab.status === 'unavailable') return <Banner>{tt.shellUnavailable}</Banner>;
      if (tab.status === 'ended') return <Banner action={<Button variant="outline" size="sm" onClick={() => starting(tab.id, () => store.reopen(sid, tab.id))}>{tt.reopen}</Button>}>{tab.end?.lost ? tt.shellLost : tab.end?.code == null ? tt.shellEndedNoCode : tt.shellEnded(tab.end.code)}</Banner>;
      return null;
    }
    if ((mode.kind === 'live' || mode.kind === 'parent') && link.state === 'reconnecting') {
      const s = Math.max(0, Math.ceil(((link.retryAt ?? now) - now) / 1000));
      return <Banner tone="warn" action={<Button variant="outline" size="sm" onClick={() => store.retryNow(sid)}>{tt.reconnect}</Button>}>{remote ? tt.lost(host, s, link.attempt, session.name) : tt.detached(session.name, s, link.attempt)}</Banner>;
    }
    if (mode.kind === 'parent' && helper) return <Banner action={<Button variant="outline" size="sm" onClick={p.onGoParent}>{tt.goParent(session.name)}</Button>}>{tt.subagent(helper.name, session.name)}</Banner>;
    if (mode.kind === 'offline') {
      // The fleet does not say since when a machine is down, and the time the pane first saw it would be wrong: no time.
      return <Banner action={<Button variant="outline" size="sm" onClick={() => p.client.fleet?.retry(session.machineId ?? 'local')}>{tt.retry}</Button>}>{tt.offlineBanner(host)}</Banner>;
    }
    if (mode.kind === 'preview') return <Banner>{mode.why === 'outside' ? tt.outside(session.name) : tt.ended(session.name)}</Banner>;
    return null;
  })();

  const target = session.tmuxSession ? tt.tmuxTarget(session.tmuxSession, remote ? host : undefined) : tt.noTmux;
  const [state, dot, where] = ((): [string, 'on' | 'wait' | 'off', string | null] => {
    // A shell's login shell is not known here: its machine alone (`shellTarget` takes the name once it is).
    if (tab.kind === 'shell') return [tab.status === 'running' ? tt.shell : '', tab.status === 'running' ? 'on' : 'off', tt.shellTarget(tab.remote ? host : undefined)];
    if (mode.kind === 'browser') return [tt.readOnly, 'off', null];
    if (mode.kind === 'offline') return [tt.offline, 'off', host];
    if (mode.kind === 'preview') return [tt.preview, 'off', target];
    if (!agentSurface) return [tt.readOnly, 'off', target];
    if (link.state === 'reconnecting') return [tt.reconnecting, 'wait', target];
    if (link.state === 'off') return [tt.connecting, 'wait', target];
    if (mode.kind === 'parent') return [tt.readOnly, 'off', target];
    return [remote ? tt.attachedSsh : tt.attached, 'on', target];
  })();

  return (
    <section className="terminal-pane" role="region" aria-label={tt.title}>
      <div className="pane-heading term-heading">
        {mode.kind === 'browser'
          ? <span className="term-title"><Icon d={SHELL_ICONS.terminal} size={15} />{tt.title}</span>
          : (
            <div className="term-tabs" role="tablist">
              {tabs.map(x => (
                <div key={x.id} className={cls('term-tab', x.id === active && 'current')}>
                  <button type="button" role="tab" aria-selected={x.id === active} onClick={() => select(x.id)}>
                    <Icon d={SHELL_ICONS.terminal} size={12} /><span>{label(x)}</span>
                  </button>
                  {x.kind === 'shell' && <button type="button" className="tab-close" aria-label={tt.closeTab(label(x))} onClick={() => store.close(sid, x.id)}><Icon d={ICONS.close.d} size={11} /></button>}
                </div>
              ))}
              <button type="button" className="term-add" aria-label={tt.addShell} title={tt.addShell} onClick={addShell}><Icon d={ICONS.plus.d} size={13} /></button>
            </div>
          )}
        <span className="spacer" />
        <span className="term-chip mono">{remote ? tt.remote(host) : tt.local}</span>
        {mode.kind !== 'browser' && mode.kind !== 'offline' && mode.kind !== 'native' && (
          <Button variant="ghost" size="icon" className="term-icon" onClick={external} aria-label={tt.external} title={tt.external}><Icon d={ICONS.external.d} size={14} /></Button>
        )}
        <Button variant="ghost" size="icon" className="term-icon" onClick={p.onMax} aria-label={p.maxed ? tt.unmax : tt.max} title={p.maxed ? tt.unmax : tt.max}>
          <Icon d={p.maxed ? SHELL_ICONS.collapse : ICONS.expand.d} size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="term-icon" onClick={p.onClose} aria-label={t.top.terminalHide} title={t.top.terminalHideTitle}><Icon d={ICONS.close.d} size={14} /></Button>
      </div>
      {banner}
      {/* Keyed: leaving the screen drops its div, and the xterm moved into it with it (the store keeps the xterm). */}
      {shown
        ? <div key="screen" ref={body} className="terminal-screen" onFocus={() => setFocused(true)} onBlur={onBlur} />
        : tab.kind === 'agent'
          ? (
            <div key="preview" className="terminal-content mono">
              {lines.length > 0
                ? <div className="terminal-output">{lines.map((line, i) => <div key={i}>{line === '' ? ' ' : line}</div>)}</div>
                : <p className="muted">{tt.empty}</p>}
            </div>
          )
          : <div key="blank" className="terminal-screen" />}
      <div className="terminal-footer">
        <span className={cls('term-dot', dot)} aria-hidden="true">●</span>
        {state && <span>{state}</span>}
        {where && <span className="mono">{where}</span>}
        {typing && <><span className="spacer" /><span>{focused ? tt.toThread(key) : tt.toTerminal(key)}</span></>}
      </div>
    </section>
  );
}

function Banner({ children, action, tone }: { children: ReactNode; action?: ReactNode; tone?: 'warn' }): JSX.Element {
  return <div className={cls('term-banner', tone)} role="status"><span>{children}</span>{action}</div>;
}

/** The clock, read again every second while a reconnection is pending: the banner counts down. */
function useCountdown(on: boolean): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
  return Date.now();
}
