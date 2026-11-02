import { useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { useImageUrl, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { ImageViewer } from '../images/Thumbs';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { exchangesOf, type Capture } from './captures';
import { clock } from './exchanges';

/** Where the tab is asked to open: a capture's key, or null for the latest. A new object each time it is asked (the same
 *  thumbnail clicked again brings the tab back to it). */
export interface CaptureFocus { key: string | null }

export interface BrowserTabProps {
  /** The session's captures, in thread order (capturesOf). */
  captures: readonly Capture[];
  focus: CaptureFocus;
  client: DaemonClient; session: Session;
  /** A subagent's name, by its id. */
  helperName(id: string): string | undefined;
  /** The pane's head: its title, and `extra` before « Agrandir » / « Fermer ». */
  head(title: string, path: string, extra?: ReactNode): ReactNode;
  /** « dans le fil »: the capture's tool row lit in the thread. */
  onShowInThread(toolId: string): void;
  /** The thread cleared under the tab: « Fermer ». */
  onClose(): void;
}

const SIDES = ['A', 'B'] as const;

/** The page's address without its scheme (« localhost:5173/ »), and the path a strip cell shows (« /tarifs »). */
const bare = (url: string) => url.replace(/^[a-z]+:\/\//i, '');
const pathOf = (url: string) => {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
};

/** The « Navigateur » tab (spec §5.4, mockup screens 2 and 3): the selected capture large, with its meta line and « Comparer »,
 *  « Agrandir », « dans le fil »; below it the strip of every capture, a divider between exchanges, scrolled to its end when
 *  one arrives. « Comparer » turns the strip into a pick of two, shown side by side (stacked in a narrow pane). */
export function BrowserTab({ captures, focus, client, session, helperName, head, onShowInThread, onClose }: BrowserTabProps): JSX.Element {
  const { t } = useI18n();
  const tb = t.session.browser;
  const route = { id: session.id };
  // The selected capture: the one asked for; gone from the thread (or none asked), the latest.
  const [asked, setAsked] = useState(focus);
  const [selected, setSelected] = useState(focus.key);
  if (asked !== focus) { setAsked(focus); setSelected(focus.key); }
  const current = captures.find(c => c.key === selected) ?? captures.at(-1);
  if (current && current.key !== selected) setSelected(current.key);
  // Comparing: the keys picked, A then B (null: the single view).
  const [picks, setPicks] = useState<readonly string[] | null>(null);
  const live = picks?.filter(k => captures.some(c => c.key === k)) ?? null;
  const [viewer, setViewer] = useState<number | null>(null);
  const refs = useMemo(() => captures.map(c => c.ref), [captures]);

  // A capture that arrives while the tab is open: the strip shows its end. The selected cell is kept in view.
  const strip = useRef<HTMLDivElement>(null);
  const count = useRef(captures.length);
  useLayoutEffect(() => {
    const grew = captures.length > count.current;
    count.current = captures.length;
    if (grew && strip.current) strip.current.scrollLeft = strip.current.scrollWidth;
  }, [captures.length]);
  const currentKey = current?.key;
  useLayoutEffect(() => {
    strip.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [currentKey]);

  if (!current) {
    return (
      <>
        {head(tb.tab, '')}
        <div className="side-body">
          <div className="changes-empty browser-none">
            <Icon d={SHELL_ICONS.browser} size={22} />
            <strong>{tb.none}</strong>
            <Button variant="outline" size="sm" onClick={onClose}>{t.session.pane.close}</Button>
          </div>
        </div>
      </>
    );
  }

  const who = (c: Capture) => (c.helperId === undefined ? session.name : helperName(c.helperId) ?? t.session.subagent);
  const choose = (key: string) => {
    if (live === null) { setSelected(key); return; }
    setPicks(live.includes(key) ? live.filter(k => k !== key) : live.length >= 2 ? [key] : [...live, key]);
  };
  const first = captures[0]!, last = captures.at(-1)!;
  const span = clock(first.at) === clock(last.at) ? clock(first.at) : `${clock(first.at)} → ${clock(last.at)}`;
  const shown = viewer === null ? undefined : captures[viewer];

  return (
    <>
      {head(tb.tab, '', live !== null && <Button variant="ghost" size="sm" className="browser-quit" onClick={() => setPicks(null)}>{tb.compareOn}</Button>)}
      <div className="side-body browser-tab">
        <div className="browser-stage">
          {live === null ? (
            <>
              <div className="browser-meta">
                <Meta c={current} who={who(current)} />
                {/* Together, at the line's end (on a line of their own in a narrow pane). */}
                <span className="browser-actions">
                  <Button variant="ghost" size="sm" onClick={() => setPicks([])}><Icon d={SHELL_ICONS.split} size={13} />{tb.compare}</Button>
                  <Button variant="ghost" size="sm" onClick={() => setViewer(captures.indexOf(current))}><Icon d={ICONS.expand.d} size={13} />{tb.enlarge}</Button>
                  <Button variant="ghost" size="sm" onClick={() => onShowInThread(current.toolId)}><Icon d={SHELL_ICONS.thread} size={13} />{tb.inThread}</Button>
                </span>
              </div>
              <Shot client={client} route={route} c={current} />
            </>
          ) : (
            <div className="browser-pair">
              {SIDES.map((side, i) => {
                const c = captures.find(x => x.key === live[i]);
                return c ? (
                  <div key={side} className="browser-side" data-testid="compare-side">
                    <div className="browser-meta"><span className="browser-badge">{side}</span><Meta c={c} who={who(c)} /></div>
                    <Shot client={client} route={route} c={c} />
                  </div>
                ) : (
                  <div key={side} className="browser-side empty">
                    <div className="browser-meta"><span className="browser-badge">{side}</span></div>
                    <div className="browser-big" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="browser-strip">
          <div className="browser-strip-lab">
            {live === null ? <><span>{tb.count(captures.length, exchangesOf(captures))}</span><span className="spacer" /><span className="mono">{span}</span></> : <span>{tb.pick}</span>}
          </div>
          <div className="browser-cells" ref={strip}>
            {captures.map((c, i) => {
              const pick = live?.indexOf(c.key) ?? -1;
              return [
                i > 0 && captures[i - 1]!.turn !== c.turn && <span key={`turn:${c.key}`} className="browser-turn" aria-hidden="true" />,
                <Cell key={c.key} client={client} route={route} c={c} who={who(c)} onClick={() => choose(c.key)}
                  current={live === null && c.key === current.key} picking={live !== null} badge={pick >= 0 ? SIDES[pick] : undefined} />
              ];
            })}
          </div>
        </div>
      </div>
      {shown && <ImageViewer client={client} refs={refs} route={route} index={viewer!} onIndex={setViewer} onClose={() => setViewer(null)} who={who(shown)} at={clock(shown.at)} />}
    </>
  );
}

/** A capture's meta line: its page, time, size, who took it and, when it is not a browser screenshot, the tool. */
function Meta({ c, who }: { c: Capture; who: string }): JSX.Element {
  return (
    <>
      {c.url && <span className="browser-url mono" title={c.url}>{bare(c.url)}</span>}
      <span className="mono">{clock(c.at)}</span>
      <span className="mono">{c.ref.width}×{c.ref.height}</span>
      <span>{who}</span>
      {c.tool && <span className="mono">{c.tool}</span>}
    </>
  );
}

/** A capture large, fetched full size. */
function Shot({ client, route, c }: { client: DaemonClient; route: { id: string }; c: Capture }): JSX.Element {
  const { t } = useI18n();
  const { url, failed } = useImageUrl(client, c.ref, route, false);
  return (
    <div className="browser-big" aria-busy={!url && !failed}>
      {url ? <img src={url} alt={t.images.capture} draggable={false} /> : failed && <span className="muted">{t.images.unavailable}</span>}
    </div>
  );
}

/** One capture in the strip: its preview, its page and size, its time and who took it; outlined when selected, badged when picked. */
function Cell({ client, route, c, who, current, picking, badge, onClick }: { client: DaemonClient; route: { id: string }; c: Capture; who: string; current: boolean; picking: boolean; badge?: string; onClick(): void }): JSX.Element {
  const { url } = useImageUrl(client, c.ref, route, c.ref.preview);
  const place = c.url ? pathOf(c.url) : c.tool;
  return (
    <button type="button" className={cls('browser-cell', (current || badge !== undefined) && 'selected')} data-capture={c.key} onClick={onClick}
      aria-current={current ? 'true' : undefined} aria-pressed={picking ? badge !== undefined : undefined}>
      <span className="browser-thumb">
        {url && <img src={url} alt="" draggable={false} />}
        {badge && <span className="browser-badge">{badge}</span>}
      </span>
      <span className="browser-c1 mono">{[place, `${c.ref.width}×${c.ref.height}`].filter(Boolean).join(' · ')}</span>
      <span className="browser-c2">{clock(c.at)} · {who}</span>
    </button>
  );
}
