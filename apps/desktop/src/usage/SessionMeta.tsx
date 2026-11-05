import { useState, type JSX } from 'react';
import { contextShare, type Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { modelName, span } from './model';
export { modelName };
import { useNow } from './useUsageView';

const CLOCK = ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M12 7v5l3 2'];


/** Under the line, fixed: the heading's containers clip what overflows them. */
const below = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.bottom + 8 }; };
const kTokens = (n: number) => `${Math.round(n / 1000)} k`;
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * The session's heading line (docs/mockups/ledge-harness-usage.html, « En-tête de session »): machine · repository, then the
 * model, the effort, the context gauge and the duration — what is not known is not shown. Hovered or focused, a tooltip says
 * where each comes from: chosen at launch, read from the transcript (N1: a Claude Code effort read there is shown), tokens.
 */
export function SessionMeta({ session, place, near }: { session: Session; place: string[]; near: number }): JSX.Element {
  const { t, lang } = useI18n();
  const m = t.session.metaLine;
  const now = useNow();
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const share = contextShare(session.context);
  const warn = share !== undefined && share >= near;
  const from = (f: 'transcript' | undefined) => (f === 'transcript' ? m.fromTranscript : m.atLaunch);
  const effort = session.effort ? (t.launch.efforts[session.effort] ?? session.effort).toLowerCase() : null;
  const started = Date.parse(session.startedAt);
  const age = Number.isFinite(started) ? span(now - started, lang) : null;
  const sep = <span className="msep"> · </span>;
  const rows: [string, string][] = [
    ...(session.model ? [[m.model, `${modelName(session.model)} · ${from(session.modelFrom)}`] as [string, string]] : []),
    ...(effort ? [[m.effort, `${effort} · ${from(session.effortFrom)}`] as [string, string]] : []),
    ...(session.context ? [[m.context, m.tokens(kTokens(session.context.used), kTokens(session.context.window), Math.round(near * 100))] as [string, string]] : []),
    ...(age ? [[m.duration, (session.startedSeen ? m.seenAt : m.openedAt)(hm(new Date(started)), age)] as [string, string]] : [])
  ];
  return (
    <span className="pane-meta mono session-meta" tabIndex={rows.length ? 0 : undefined} aria-describedby={tip ? 'session-meta-tip' : undefined}
      onMouseEnter={e => setTip(below(e.currentTarget))} onMouseLeave={() => setTip(null)} onFocus={e => setTip(below(e.currentTarget))} onBlur={() => setTip(null)}>
      {place.map((p, i) => <span key={i}>{i > 0 && sep}{p}</span>)}
      {session.model && <>{sep}<span className="mdl">{modelName(session.model)}</span></>}
      {effort && <>{sep}<span>{m.effortIs(effort)}</span></>}
      {share !== undefined && <>{sep}<span className={cls('mctx', warn && 'amber')}><span className="ugauge"><i style={{ width: `${Math.round(share * 100)}%` }} /></span>{t.handover.gauge(Math.round(share * 100))}</span></>}
      {age && <>{sep}<span className="mdur"><Icon d={CLOCK} size={11} />{age}</span></>}
      {tip && rows.length > 0 && (
        <span className="meta-tip" role="tooltip" id="session-meta-tip" style={{ left: tip.x, top: tip.y }}>
          {rows.map(([k, v]) => <span key={k} className="meta-tip-row"><span className="mk">{k}</span><span>{v}</span></span>)}
        </span>
      )}
    </span>
  );
}
