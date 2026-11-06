import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type JSX, type ReactNode } from 'react';
import { useDaemon, useMachines, useTerminalHolders, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import { cls } from '../shell/cls';
import { ptyBackend } from '../term/backend';
import { useBackquote } from '../term/keys';
import { agentMode, type AgentMode } from '../term/mode';
import { agentTabId, type AgentLink } from '../term/store';
import { TermStoreContext } from '../term/useTerms';
import { useTabPlace } from '../workspace/tabPlace';

const OFF: AgentLink = { state: 'off', attempt: 0 };
const noStore = () => () => {};

export type AgentDot = 'on' | 'wait' | 'off';
export interface Agent {
  mode: AgentMode; link: AgentLink;
  /** The session runs on another machine, named `host` (else the local machine's name, wsl). */
  remote: boolean; host: string;
  /** The Terminal tab's state dot: on while its screen can be typed into, wait while it reconnects, off otherwise. */
  dot: AgentDot;
}

/** A pseudo-terminal, or a daemon that streams the pane: either can show the agent's screen (the store attaches by the same rule). */
export function useHasBackend(client: DaemonClient, session: Pick<Session, 'machineId'>): boolean {
  const machines = useMachines(client);
  return ptyBackend() !== null || machines.find(m => m.id === (session.machineId ?? 'local'))?.daemon?.terminalStream === true;
}

/** The agent's screen as the session page knows it: how it can be shown (agentMode), its link, where it runs. On a subagent's
 *  page `session` is its parent. Without a terminal store (a page rendered alone) the link is off. */
export function useAgent(session: Session, helper: { id: string } | null, readOnly = false, streams?: boolean): Agent {
  const { t } = useI18n();
  const store = useContext(TermStoreContext);
  // `streams`: the caller knows the machine streams panes (useHasBackend); absent, only a pseudo-terminal counts.
  const [pty] = useState(() => ptyBackend() !== null);
  const hasBackend = streams ?? pty;
  const subscribe = useCallback((fn: () => void) => (store ? store.subscribe(fn) : noStore()), [store]);
  const link = useSyncExternalStore(subscribe, () => store?.link(session.id) ?? OFF);
  const base = agentMode(session, helper, hasBackend);
  // A capture (R3) is a live screen the store opens read-only: the mode the store reads that way is the subagent's.
  const mode: AgentMode = readOnly && base.kind === 'live' ? { kind: 'parent', parentId: session.id } : base;
  const remote = !!session.machineId && session.machineId !== 'local';
  const dot: AgentDot = mode.kind !== 'live' ? 'off' : link.state === 'reconnecting' ? 'wait' : 'on';
  return { mode, link, remote, host: remote ? machineOf(session) : t.session.terminal.local, dot };
}

export interface AgentViewProps {
  client: DaemonClient; session: Session; helper: { id: string; name: string } | null; agent: Agent; notify(text: string): void;
  onGoParent(): void;
  /** OMP's « Ouvrir un shell »: a shell in the right panel. */
  onOpenShell?(): void;
}

/** The view showing the agent's screen outside the IDE: the one page. */
const PAGE = 'page';

/** The Terminal view (Fil | Terminal v3): the agent's own screen, alone and full frame under the session's heading. A banner
 *  says why it cannot be typed into (T3, T4), the footer gives the link's state and the key back to the thread. Without a
 *  screen to attach (the browser build, an offline machine, a session with no tmux pane) it shows the daemon's preview of the
 *  last lines, read only; an OMP session, which has no agent screen, offers a shell instead. In an IDE tab the view is the
 *  tab (its key): a session's one xterm sits in the tab that holds it, and another tab of the same session says so and can
 *  bring it back (R2), showing the preview meanwhile. */
export function AgentView(p: AgentViewProps): JSX.Element {
  const { session, helper, agent } = p;
  const { mode, link, remote, host } = agent;
  const { t } = useI18n();
  const tt = t.session.terminal;
  const sid = session.id;
  const store = useContext(TermStoreContext);
  const subscribe = useCallback((fn: () => void) => (store ? store.subscribe(fn) : noStore()), [store]);
  // The store makes the agent's xterm when it starts attaching, before the link says anything.
  const surface = useSyncExternalStore(subscribe, () => store?.surface(agentTabId(sid)));
  const tabPlace = useTabPlace();
  const viewer = tabPlace?.key ?? PAGE;
  const holder = useSyncExternalStore(subscribe, () => store?.viewerOf(sid) ?? null);
  const screenMode = mode.kind === 'live' || mode.kind === 'parent' || mode.kind === 'offline';
  // Another view holds the screen: the xterm stays there (it can sit in one place only). Outside the IDE the page draws it as
  // before, even while none holds it; an IDE tab only once it holds it, so a hidden tab never takes it from a shown one.
  const elsewhere = screenMode && holder !== null && holder !== viewer;
  const lines = useDaemon().previews.get(sid) ?? [];
  const phone = useTerminalHolders(p.client).get(sid);
  const screen = screenMode && (holder === viewer || (holder === null && tabPlace === null)) ? surface : undefined;
  const typing = mode.kind === 'live' && link.state === 'attached' && !elsewhere;
  // Ctrl + ² hands it the keyboard while it is live and not reconnecting (keys typed while it attaches wait for it).
  const typeable = mode.kind === 'live' && link.state !== 'reconnecting' && screen !== undefined;

  const now = useCountdown(link.state === 'reconnecting');
  const key = useBackquote();
  const [focused, setFocused] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !screen) return;
    // The xterm moves in, never re-made: its screen and scrollback stay.
    for (const c of [...el.children]) if (c !== screen.host) c.remove();
    if (screen.host.parentElement !== el) el.appendChild(screen.host);
    screen.fit();
    setFocused(el.contains(document.activeElement));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => screen.fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [screen]);
  const onBlur = (e: FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); };

  const banner = ((): ReactNode => {
    if (elsewhere) return <Banner action={<Button variant="outline" size="sm" onClick={() => store?.showAgent(sid, mode, viewer)}>{t.ide.showHere}</Button>}>{t.ide.agentElsewhere}</Banner>;
    // A phone holds the hand (spec 2026-11-02 mobile terminal, 5a): both keyboards type, and the PC can take it back.
    if (phone !== undefined) {
      const takeBack = () => { try { p.client.fleet?.releaseTerminal(sid); } catch { p.notify(t.offline); } };
      return <Banner tone="info" action={<Button variant="outline" size="sm" onClick={takeBack}>{tt.takeBack}</Button>}>{tt.phoneHolds(phone, session.name)}</Banner>;
    }
    if ((mode.kind === 'live' || mode.kind === 'parent') && link.state === 'reconnecting') {
      const s = Math.max(0, Math.ceil(((link.retryAt ?? now) - now) / 1000));
      return <Banner tone="warn" action={<Button variant="outline" size="sm" onClick={() => store?.retryNow(sid)}>{tt.reconnect}</Button>}>{remote ? tt.lost(host, s, link.attempt, session.name) : tt.detached(session.name, s, link.attempt)}</Banner>;
    }
    if (mode.kind === 'parent' && helper) return <Banner action={<Button variant="outline" size="sm" onClick={p.onGoParent}>{tt.goParent(session.name)}</Button>}>{tt.subagent(helper.name, session.name)}</Banner>;
    if (mode.kind === 'offline') {
      // The fleet does not say since when a machine is down, and the time the view first saw it would be wrong: no time.
      return <Banner action={<Button variant="outline" size="sm" onClick={() => p.client.fleet?.retry(session.machineId ?? 'local')}>{tt.retry}</Button>}>{tt.offlineBanner(host)}</Banner>;
    }
    if (mode.kind === 'preview') return <Banner>{mode.why === 'outside' ? tt.outside(session.name) : tt.ended(session.name)}</Banner>;
    return null;
  })();

  const target = session.tmuxSession ? tt.tmuxTarget(session.tmuxSession, remote ? host : undefined) : tt.noTmux;
  const [state, dot, where] = ((): [string | null, 'on' | 'wait' | 'off', string | null] => {
    if (mode.kind === 'native') return [tt.noAgentScreen, 'off', null];
    if (mode.kind === 'browser') return [tt.readOnly, 'off', null];
    if (mode.kind === 'offline') return [tt.offline, 'off', host];
    if (mode.kind === 'preview') return [tt.preview, 'off', target];
    // R2: the banner says it; the footer gives no state of a screen not drawn here, only the pane's name.
    if (elsewhere) return [null, 'off', target];
    if (!surface) return [tt.readOnly, 'off', target];
    if (link.state === 'reconnecting') return [tt.reconnecting, 'wait', target];
    if (link.state === 'off') return [tt.connecting, 'wait', target];
    if (mode.kind === 'parent') return [tt.readOnly, 'off', target];
    return [remote ? tt.attachedSsh : tt.attached, 'on', target];
  })();

  return (
    <section className="agent-view" role="region" aria-label={tt.title} data-typeable={typeable} data-session={sid} data-elsewhere={elsewhere || undefined}>
      {banner}
      {/* Keyed: leaving the screen drops its div, and the xterm moved into it with it (the store keeps the xterm). */}
      {mode.kind === 'native'
        ? (
          <div key="native" className="agent-native">
            <div>
              <strong>{tt.nativeTitle(session.name)}</strong>
              {p.onOpenShell && <span>{tt.nativeBody}</span>}
              {p.onOpenShell && <Button variant="outline" size="sm" onClick={p.onOpenShell}><Icon d={ICONS.plus.d} size={13} />{tt.openShell}</Button>}
            </div>
          </div>
        )
        : screen
          ? <div key="screen" ref={body} className="terminal-screen" onFocus={() => setFocused(true)} onBlur={onBlur} />
          : (
            <div key="preview" className="terminal-content mono">
              {lines.length > 0
                ? <div className="terminal-output">{lines.map((line, i) => <div key={i}>{line === '' ? ' ' : line}</div>)}</div>
                : <p className="muted">{tt.empty}</p>}
            </div>
          )}
      <div className="terminal-footer">
        <span className={cls('term-dot', dot)} aria-hidden="true">●</span>
        {state && <span>{state}</span>}
        {where && <span className="mono">{where}</span>}
        {typing && <><span className="spacer" /><span className={cls(focused && 'footkey')}>{focused ? tt.toThread(key) : tt.toTerminal(key)}</span></>}
      </div>
    </section>
  );
}

export function Banner({ children, action, tone }: { children: ReactNode; action?: ReactNode; tone?: 'warn' | 'info' }): JSX.Element {
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
