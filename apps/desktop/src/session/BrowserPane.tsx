import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { useDaemon, type DaemonClient } from '@ledge/fleet';
import type { BrowserLive, Session, ThreadItem } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SessionBot } from '../shell/SessionBot';
import { SHELL_ICONS } from '../shell/icons';
import { cls } from '../shell/cls';
import { openUrl } from '../tauri/bridge';
import { BrowserTab, type CaptureFocus } from './BrowserTab';
import type { Capture } from './captures';
import { clock } from './exchanges';
import {
  bare, enabledAnswer, hasDirect, isLocal, keepEnabledAnswer, kindOf, lastActionOf, markOffSeen, noAddress, openable, pageOf, sideOnOpen,
  useBrowser, useBrowserFrames, type BrowserAction, type BrowserKind, type BrowserSide, type Frame
} from './browserLive';

export interface BrowserPaneProps {
  captures: readonly Capture[]; focus: CaptureFocus; client: DaemonClient; session: Session;
  /** The session's thread: the agent's last browser action (Claude). */
  items: readonly ThreadItem[] | undefined;
  /** An OMP seat of OpenRig: no address, no named action, no captures (docs/mockups/ledge-browser-live.html, view 2). */
  seat: boolean;
  helperName(id: string): string | undefined;
  head(title: string, path: string, extra?: ReactNode): ReactNode;
  onShowInThread(toolId: string): void;
  onClose(): void;
}

/** How long « Otto a rouvert son navigateur » stays (design-ux 6). */
export const REOPENED_MS = 4000;
/** How long the live frame stays empty before « En attente de la première image… » shows (design-ux 17:39Z). */
export const WAIT_TEXT_MS = 500;

/**
 * The « Navigateur » tab (docs/mockups/ledge-browser-live.html): the agent's own browser on « Direct » (« Fermé » once closed),
 * beside the captures it took (« Captures », the tab of PR #163, unchanged). Without a browser to follow, the captures alone,
 * as before. The film is watched only while its side shows.
 */
export function BrowserPane(p: BrowserPaneProps): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  const { session, captures } = p;
  const browser = useBrowser(session);
  const kind = kindOf(browser, isLocal(session));
  const [asked, setAsked] = useState(p.focus);
  const [side, setSide] = useState<BrowserSide>(() => sideOnOpen(kind, captures.length, p.focus.key !== null));
  if (asked !== p.focus) { setAsked(p.focus); setSide(sideOnOpen(kind, captures.length, p.focus.key !== null)); }
  // A side with nothing to show gives way to the other.
  const shown: BrowserSide = !hasDirect(kind) ? 'captures' : side === 'captures' && captures.length === 0 ? 'direct' : side;

  // « Le direct n'est pas activé » is said once for the whole app (design-ux 1b).
  useEffect(() => { if (kind === 'off' && shown === 'direct') markOffSeen(); }, [kind, shown]);
  // The browser back after it closed: on its Direct side again, and a notice for a while (design-ux 6).
  const was = useRef(kind);
  const [reopened, setReopened] = useState(false);
  useEffect(() => {
    const back = was.current === 'closed' && kind === 'live';
    was.current = kind;
    if (!back) return;
    setReopened(true);
    const timer = setTimeout(() => setReopened(false), REOPENED_MS);
    return () => clearTimeout(timer);
  }, [kind]);

  const watching = shown === 'direct' && (kind === 'live' || kind === 'closed');
  const { frame, fps } = useBrowserFrames(p.client, session.id, watching, browser?.state, pageOf(browser));

  if (!hasDirect(kind)) return <BrowserTab captures={captures} focus={p.focus} client={p.client} session={session} helperName={p.helperName} head={p.head} onShowInThread={p.onShowInThread} onClose={p.onClose} />;

  const sw = (
    <div className="browser-switch" role="tablist" aria-label={tb.switchLabel}>
      <button type="button" role="tab" aria-selected={shown === 'direct'} onClick={() => setSide('direct')}>
        {kind === 'live' ? <i className="live-dot" aria-hidden="true" /> : <span className="off-dot" aria-hidden="true" />}{kind === 'closed' ? tb.closed : tb.live}
      </button>
      {captures.length > 0 && (
        <button type="button" role="tab" aria-selected={shown === 'captures'} onClick={() => setSide('captures')}>{tb.captures}<span className="tab-count mono">{captures.length}</span></button>
      )}
      {/* Back while the captures show: they stay, the notice says it under the switch (design-ux 6). */}
      {reopened && shown === 'captures' && <span className="browser-toast floating" role="status"><i className="live-dot" aria-hidden="true" />{tb.reopened(session.name)}</span>}
    </div>
  );
  const head = (title: string, path: string, extra?: ReactNode) => p.head(title, path, <>{sw}{extra}</>);
  if (shown === 'captures') {
    return <BrowserTab captures={captures} focus={p.focus} client={p.client} session={session} helperName={p.helperName} head={head} onShowInThread={p.onShowInThread} onClose={p.onClose} />;
  }
  return (
    <>
      {head(tb.tab, '')}
      <div className="side-body browser-live">
        {kind === 'live' ? <LiveSide key={pageOf(browser)} session={session} browser={browser!} frame={frame} fps={fps} seat={p.seat} reopened={reopened} action={p.seat ? null : lastActionOf(p.items)} onShowInThread={p.onShowInThread} />
          : kind === 'closed' ? <ClosedSide session={session} browser={browser!} frame={frame} seat={p.seat} />
          : kind === 'off' ? <OffSide session={session} client={p.client} />
          : <RemoteSide session={session} onCaptures={() => setSide('captures')} />}
      </div>
    </>
  );
}

/** The address line: the page's address and title; for an OMP seat (or a page without address), « Navigateur de l'agent ». */
function UrlLine({ url, title, seat, closed, image }: { url?: string; title?: string; seat: boolean; closed: boolean; image: boolean }): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  if (seat || !url) {
    return (
      <div className="browser-address">
        <Icon d={SHELL_ICONS.browser} size={12} /><span>{tb.agentBrowser}</span>
        {title && <span className="muted">· {closed ? tb.lastPage(title) : title}</span>}
      </div>
    );
  }
  const after = closed && image ? tb.lastUrl : title;
  return (
    <div className="browser-address" title={url}>
      <Icon d={SHELL_ICONS.browser} size={12} /><code>{noAddress(url) ? url : bare(url)}</code>
      {after && <span className="muted">· {after}</span>}
    </div>
  );
}

function LiveSide({ session, browser, frame, fps, seat, reopened, action, onShowInThread }: { session: Session; browser: BrowserLive; frame: Frame | null; fps: number | null; seat: boolean; reopened: boolean; action: BrowserAction | null; onShowInThread(toolId: string): void }): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  // Live, a frame of the film (since the page last changed, useBrowserFrames); the image the daemon kept only when it is of
  // this page (its address) and of this live period, never an older page's (review qitem-20261103173211).
  const keptHere = browser.image !== undefined && browser.image.url === browser.url && (!browser.since || Date.parse(browser.image.at) >= Date.parse(browser.since));
  const shown = frame && (frame.live || keptHere) ? frame : null;
  // No image of this page yet: the frame empty at once, « En attente… » only past half a second, so a quick navigation does not
  // flash a text (design-ux 17:39Z). Keyed by the page, a new page starts over.
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (shown) { setLate(false); return; }
    const timer = setTimeout(() => setLate(true), WAIT_TEXT_MS);
    return () => clearTimeout(timer);
  }, [shown === null]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="browser-live-head">
        <span className="browser-live-badge"><i className="live-dot" aria-hidden="true" />{tb.live}</span>
        <span className="browser-driver"><SessionBot session={session} size={14} />{tb.driver(session.name)}</span>
        <span className="spacer" />
        {fps !== null && <span className="browser-fps mono">{tb.fps(fps)}</span>}
      </div>
      <UrlLine url={browser.url} title={browser.title} seat={seat} closed={false} image />
      <div className={cls('browser-screen live', !shown && 'wait')} title={tb.readOnly(session.name)} data-testid="browser-screen">
        {shown ? <img src={shown.src} alt={tb.live} draggable={false} /> : late && <span className="muted">{tb.waiting}</span>}
        {reopened && <div className="browser-toast" role="status"><i className="live-dot" aria-hidden="true" />{tb.reopened(session.name)}</div>}
      </div>
      {seat
        ? <div className="browser-last"><span className="muted">{tb.using(session.name, clock(browser.since ?? new Date().toISOString()))}</span></div>
        : action && <LastAction action={action} onShowInThread={onShowInThread} />}
    </>
  );
}

/** « Clique « 1 · Desktop » · il y a 2 s » and « dans le fil » (design-ux 15:26Z). */
function LastAction({ action, onShowInThread }: { action: BrowserAction; onShowInThread(toolId: string): void }): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const verb = tb.verbs[action.short] ?? action.short;
  const text = action.fields !== undefined ? `${verb} ${tb.fields(action.fields)}` : action.seconds !== undefined ? `${tb.waitTime} ${tb.seconds(action.seconds)}` : verb;
  const ago = Math.max(0, Math.round((now - new Date(action.at).getTime()) / 1000));
  return (
    <div className="browser-last">
      <span className="browser-verb">{text}</span>
      {action.objects.map((o, i) => <span key={i} className="browser-object">{i > 0 && <span className="muted">{tb.selectIn}</span>}<code>« {o} »</code></span>)}
      <span className="muted">· {tb.ago(ago)}</span>
      <span className="spacer" />
      <Button variant="ghost" size="sm" onClick={() => onShowInThread(action.toolId)}><Icon d={SHELL_ICONS.thread} size={13} />{tb.inThread}</Button>
    </div>
  );
}

function ClosedSide({ session, browser, frame, seat }: { session: Session; browser: BrowserLive; frame: Frame | null; seat: boolean }): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  const url = browser.url ?? browser.image?.url;
  const title = browser.title ?? browser.image?.title;
  const at = clock(browser.closedAt ?? browser.since ?? new Date().toISOString());
  const badge = seat ? (browser.closed === 'stopped' ? tb.seatStopped(at) : tb.tabsClosed(at)) : tb.closedAt(at);
  const open = !seat && openable(url);
  // Closed, only the image the daemon kept (sent on the watch), dated by it.
  const image = browser.image !== undefined && frame !== null && !frame.live;
  return (
    <>
      <div className="browser-live-head">
        <span className="browser-closed-badge"><span className="off-dot" aria-hidden="true" />{badge}</span>
        <span className="spacer" />
        {open && <Button variant="outline" size="sm" onClick={() => openUrl(url)}><Icon d={ICONS.external.d} size={13} />{tb.openMine}</Button>}
      </div>
      <UrlLine url={url} title={title} seat={seat} closed image={image} />
      <div className={cls('browser-screen closed', !image && 'wait')} data-testid="browser-screen">
        {image ? <><img src={frame.src} alt={tb.closed} draggable={false} /><span className="browser-stamp">{tb.lastImage(clock(browser.image!.at))}</span></> : <span className="muted">{tb.noImage}</span>}
      </div>
      {seat ? <p className="browser-hint">{browser.closed === 'stopped' ? tb.stoppedHint : tb.tabsClosedHint(session.name)} {tb.noAddress}</p>
        : open && <p className="browser-hint">{tb.openHint(session.name)}</p>}
    </>
  );
}

/** « Le direct n'est pas activé », its confirmation, then the daemon's answer (design-ux 2). */
function OffSide({ session, client }: { session: Session; client: DaemonClient }): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  const [step, setStep] = useState<'box' | 'confirm' | 'asking'>('box');
  const [answer, setAnswer] = useState(enabledAnswer);
  const rid = useRef<string | null>(null);
  // The connection lost before the answer: nothing to wait for any more, the box again.
  const { status } = useDaemon();
  useEffect(() => { if (status !== 'open' && rid.current !== null) { rid.current = null; setAnswer(null); setStep('box'); } }, [status]);
  useEffect(() => client.onMessage(m => {
    if (m.type !== 'browser.enabled' || m.rid !== rid.current) return;
    rid.current = null; keepEnabledAnswer(m); setAnswer(m); setStep('box');
  }), [client]);
  const enable = () => {
    rid.current = `enable-${Date.now().toString(36)}`;
    setStep('asking');
    client.send({ type: 'browser.enable', rid: rid.current, confirmed: true });
  };
  if (answer && answer.outcome !== 'refused') {
    return (
      <div className="changes-empty browser-problem" role="status">
        <span className="browser-ok"><Icon d={ICONS.check.d} size={22} /></span>
        <strong>{tb.enabled}</strong><p>{tb.enabledBody}</p>
      </div>
    );
  }
  // Refused: « Réessayer » asks again at once, the person having agreed already (design-ux 17:23Z); the answer replaces the box.
  if (answer && step !== 'confirm') {
    return (
      <div className="changes-empty browser-problem" role="status">
        <Icon d={ICONS.warning.d} size={22} />
        <strong>{tb.refused[answer.reason ?? 'write_failed']}</strong>
        {answer.path && answer.reason !== 'not_configured' && <p><code>{answer.path}</code></p>}
        <Button variant="outline" size="sm" onClick={enable} disabled={step === 'asking'}>{step === 'asking' ? tb.working : tb.retry}</Button>
      </div>
    );
  }
  if (step !== 'box') {
    return (
      <div className="browser-confirm" role="dialog" aria-label={tb.enableTitle}>
        <strong>{tb.enableTitle}</strong>
        <p>{tb.enableBody.lead}<code>{tb.enableBody.flag}</code>{tb.enableBody.rest}</p>
        <p className="muted">{tb.enableRisk}</p>
        <div className="browser-confirm-btns">
          <Button variant="outline" size="sm" onClick={() => setStep('box')} disabled={step === 'asking'}>{tb.cancel}</Button>
          <Button variant="primary" size="sm" onClick={enable} disabled={step === 'asking'}>{tb.confirm}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="changes-empty browser-problem">
      <Icon d={SHELL_ICONS.browser} size={22} />
      <strong>{tb.off}</strong><p>{tb.offBody(session.name)}</p>
      <Button variant="outline" size="sm" onClick={() => setStep('confirm')}>{tb.enable}</Button>
    </div>
  );
}

function RemoteSide({ session, onCaptures }: { session: Session; onCaptures(): void }): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  return (
    <div className="changes-empty browser-problem">
      <Icon d={SHELL_ICONS.machine} size={22} />
      <strong>{tb.remote}</strong><p>{tb.remoteBody(session.name, session.machineName ?? session.machineId ?? '')}</p>
      <Button variant="outline" size="sm" onClick={onCaptures}>{tb.seeCaptures}</Button>
    </div>
  );
}

export type { BrowserKind };
