import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ACTION_ERROR_CODES, type ActionErrorCode, type ChatAction } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { useChatCopy } from './copy';
import { inline } from './inline';

export type ActionRisk = ChatAction['risk'];
/** A row as the card draws it. No state: proposed. `refused`: nothing was sent; `failed`: sent, it went wrong; `denied`: a
 *  permission's « Deny » reached the session; `stale`: the request changed since the card, nothing was sent. */
export type ActionRowState = 'proposed' | 'running' | 'done' | 'failed' | 'refused' | 'denied' | 'stale';

/** One action of the card, as the protocol's `ChatAction` gives it (`actionRowOf`): its registry id `action`, whose verb the
 *  front's copy holds (« Apply » for an id it does not know), the daemon's `summary` (names in **bold**, the fallback),
 *  `detail` to read in full before confirming, `target` the session named by its lines, `code` why it was refused or failed.
 *  A permission adds its `request` quoted verbatim and `deny` its other button. */
export interface ActionRowView {
  action?: string; summary: string; risk: ActionRisk; state?: ActionRowState; detail?: string;
  request?: { kind: string; text: string }; deny?: { summary: string }; target?: string;
  error?: string; code?: ActionErrorCode; doneAt?: string;
}

const CODES: ReadonlySet<string> = new Set(ACTION_ERROR_CODES);
/** A row of the protocol, as the card draws it: a code the front does not know yet (a newer daemon) reads as `failed`. */
export function actionRowOf(a: ChatAction): ActionRowView {
  const row: ActionRowView = { action: a.action, summary: a.summary, risk: a.risk };
  if (a.detail !== undefined) row.detail = a.detail;
  if (a.session !== undefined) row.target = a.session;
  if (a.state !== undefined) row.state = a.state;
  if (a.doneAt !== undefined) row.doneAt = a.doneAt;
  if (a.error !== undefined) row.error = a.error;
  if (a.code !== undefined) row.code = CODES.has(a.code) ? a.code as ActionErrorCode : 'failed';
  return row;
}

export interface ActionCardProps {
  rows: readonly ActionRowView[];
  /** Ignored (on every device): the card folds into a line, « Review » opens it again. */
  ignoredAt?: string;
  /** The island's width: a row's buttons go under its text. */
  narrow?: boolean; disabled?: boolean;
  /** The rows to apply, in order; an irreversible one is confirmed in the card first. */
  onApply: (rows: number[]) => void; onDeny: (row: number) => void; onIgnore: () => void; onReview: () => void; onOpen: (row: number) => void;
}

type Shown = ActionRowState | 'held';
const RISK_ICON = { read: ICONS.eye, reversible: ICONS.undo, destructive: ICONS.warning } as const;
const muted: CSSProperties = { color: 'var(--muted-foreground)' };
const small: CSSProperties = { height: 26, padding: '0 10px', gap: 6, fontSize: 12 };
const big: CSSProperties = { height: 28, padding: '0 10px', gap: 6, fontSize: 12 };
const danger: CSSProperties = { color: 'var(--danger-text)', borderColor: 'color-mix(in srgb, var(--destructive) 50%, var(--input))' };
const dangerFill: CSSProperties = { background: 'var(--destructive)', color: 'var(--destructive-foreground)', borderColor: 'transparent' };
const foot: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' };
const plain = (s: string) => s.replace(/\*\*/g, '');
const spinner = <span aria-hidden className="ledge-spin" style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid currentColor', borderRightColor: 'transparent' }} />;

/** The generic card (#94, docs/mockups/ledge-action-card.html): a row per action; past one, a plan whose rows are steps
 *  on a numbered rail, applied in order up to the first failure. An irreversible step is confirmed in the card itself:
 *  its buttons go, details unfold, the foot asks. Shared by the Desktop and the island. */
export function ActionCard(p: ActionCardProps) {
  const t = useChatCopy(); const c = t.chat.action!;
  const [confirming, setConfirming] = useState<number[] | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLElement>(null);
  // The button that asked: its node goes while the card confirms, so it is found again by its key.
  const asker = useRef<string | null>(null);
  useEffect(() => {
    if (confirming) { cancel.current?.focus(); return; }
    if (asker.current !== null) box.current?.querySelector<HTMLElement>(`[data-action-ask="${asker.current}"]`)?.focus();
    asker.current = null;
  }, [confirming]);
  // The card changed elsewhere (a row applied on another device, ignored then reviewed): what was confirmed no longer holds.
  const seen = `${p.ignoredAt ?? ''}|${p.rows.map(r => r.state ?? 'proposed').join()}`;
  const [was, setWas] = useState(seen);
  if (was !== seen) { setWas(seen); if (confirming) setConfirming(null); }
  const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(t.time.locale, { hour: '2-digit', minute: '2-digit' }) : '');
  const many = p.rows.length > 1;

  if (p.ignoredAt !== undefined) return (
    <div data-action-ignored style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, ...muted }}>
      <Icon size={11} {...ICONS.close} />{c.ignored(p.rows.length, clock(p.ignoredAt))}
      <Button variant="ghost" size="sm" disabled={p.disabled} onClick={p.onReview} style={{ height: 22, padding: '0 6px', fontSize: 12 }}>{c.review}</Button>
    </div>
  );

  const states = p.rows.map(r => r.state ?? 'proposed');
  const stopAt = states.findIndex(s => s === 'failed' || s === 'refused');
  const shown: Shown[] = states.map((s, i) => (s === 'proposed' && stopAt >= 0 && i > stopAt ? 'held' : s));
  const open = shown.flatMap((s, i) => (['done', 'running', 'denied', 'stale'].includes(s) ? [] : [i]));
  const risky = (rows: readonly number[]) => rows.some(i => p.rows[i]!.risk === 'destructive');
  const ask = (rows: number[], key: string) => { if (risky(rows)) { asker.current = key; setConfirming(rows); } else p.onApply(rows); };
  const go = (rows: number[]) => { setConfirming(null); p.onApply(rows); };
  const verb = (r: ActionRowView) => (r.action !== undefined ? c.verbs[r.action] : undefined) ?? c.apply;
  const dots = (rows: readonly number[]) => (risky(rows) ? '…' : '');
  const ignore = <Button variant="ghost" size="sm" disabled={p.disabled} onClick={p.onIgnore} style={{ ...small, ...muted }}>{c.ignore}</Button>;

  const node = (s: Shown, i: number, r: ActionRowView) => {
    const k = i + 1;
    const label = s === 'done' || s === 'failed' || s === 'refused' || s === 'running' ? c.stepState[s](k) : c.step(k);
    const look: CSSProperties = s === 'done' ? { background: 'var(--success)', borderColor: 'var(--success)', color: 'var(--background)' }
      : s === 'failed' ? { background: 'var(--destructive)', borderColor: 'var(--destructive)', color: 'var(--destructive-foreground)' }
      : s === 'refused' ? { borderColor: 'var(--muted-foreground)' }
      : s === 'running' ? { borderColor: 'var(--sidebar-border)' }
      : r.risk === 'destructive' ? { borderColor: 'color-mix(in srgb, var(--destructive) 70%, transparent)', color: 'var(--danger-text)', borderStyle: s === 'held' ? 'dashed' : 'solid' }
      : { borderStyle: s === 'held' ? 'dashed' : 'solid' };
    return (
      <div style={{ position: 'relative', alignSelf: 'stretch', display: 'flex', justifyContent: 'center' }}>
        {/* The thread to the steps before and after, whatever the row's height. */}
        <span aria-hidden style={{ position: 'absolute', left: '50%', width: 1.5, transform: 'translateX(-50%)', top: i > 0 ? -10 : 10, bottom: i === p.rows.length - 1 ? 'calc(100% - 10px)' : -10, background: 'color-mix(in srgb, var(--muted-foreground) 45%, transparent)' }} />
        <span data-action-node role="img" aria-label={label} style={{ position: 'relative', width: 20, height: 20, marginTop: -1, borderRadius: '50%', border: '1.5px solid var(--input)', display: 'grid', placeItems: 'center', font: "500 11px/1 'Geist Mono', ui-monospace, monospace", color: 'var(--muted-foreground)', background: 'var(--well)', ...look }}>
          {s === 'done' ? <Icon size={11} {...ICONS.check} /> : s === 'failed' || s === 'refused' ? <Icon size={10} {...ICONS.close} /> : k}
          {s === 'running' && <span aria-hidden className="ledge-spin" style={{ position: 'absolute', inset: -1.5, borderRadius: '50%', border: '1.5px solid transparent', borderTopColor: 'var(--foreground)' }} />}
        </span>
      </div>
    );
  };

  const side = (s: Shown, i: number, r: ActionRowView): ReactNode => {
    if (confirming) return s === 'done' ? <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon size={11} {...ICONS.check} />{c.confirm.alreadyDone}</span> : null;
    const destructive = r.risk === 'destructive';
    switch (s) {
      case 'proposed': case 'held': return <>
        {!many && s === 'proposed' && ignore}
        {r.deny && <Button size="sm" disabled={p.disabled} onClick={() => p.onDeny(i)} style={small}>{c.deny}</Button>}
        <Button size="sm" disabled={p.disabled} data-action-ask={i} onClick={() => ask([i], String(i))} style={{ ...small, ...(destructive ? danger : {}) }}>{verb(r)}{dots([i])}</Button>
      </>;
      case 'running': return <Button size="sm" disabled style={small}>{spinner}{c.running}</Button>;
      case 'done': return <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon size={11} {...ICONS.check} />{c.done(clock(r.doneAt))}</span>;
      case 'failed': return <>{!many && ignore}<Button size="sm" disabled={p.disabled} data-action-ask={i} onClick={() => ask([i], String(i))} style={small}>{c.retry}</Button></>;
      case 'refused': return <span style={muted}>{c.refusedState}</span>;
      // Grey, not green: the no reached the session, nothing was applied.
      case 'denied': return <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon size={11} {...ICONS.check} />{c.denied(clock(r.doneAt))}</span>;
      case 'stale': return <Button size="sm" disabled={p.disabled} onClick={() => p.onOpen(i)} style={small}><Icon size={11} {...ICONS.external} />{c.open(r.target ?? '')}</Button>;
    }
  };

  const row = (r: ActionRowView, i: number) => {
    const s = shown[i]!;
    const settled = ['done', 'stale', 'refused', 'denied'].includes(s);
    const dim = !!confirming && s === 'done';
    const destructive = r.risk === 'destructive';
    const what = side(s, i, r);
    const fade: CSSProperties = dim ? { opacity: 0.55 } : {};
    return (
      <div key={i} data-action-row={s} data-destructive={destructive || undefined} data-dim={dim || undefined}
        style={{ display: 'grid', gridTemplateColumns: `${many ? '22px ' : ''}minmax(0,1fr)${p.narrow ? '' : ' auto'}`, gap: '4px 10px', padding: '9px 12px', alignItems: 'start', borderTop: i > 0 ? '1px solid var(--sidebar-border)' : undefined, background: destructive && !settled ? 'color-mix(in srgb, var(--destructive) 6%, transparent)' : undefined }}>
        {many && node(s, i, r)}
        <div style={{ minWidth: 0, ...fade }}>
          <div style={{ overflowWrap: 'anywhere' }}>{inline(s === 'denied' && r.deny ? r.deny.summary : r.summary)}</div>
          {s !== 'denied' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', marginTop: 3, fontSize: 11.5, lineHeight: '16px', ...muted }}>
              <span title={c.riskTip[r.risk]} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...(destructive ? { color: 'var(--danger-text)', fontWeight: 500 } : {}) }}><Icon size={11} {...RISK_ICON[r.risk]} />{c.risk[r.risk]}</span>
              {destructive && s === 'proposed' && !confirming && <span>· {c.askAgain}</span>}
            </div>
          )}
          {r.detail && <div data-action-detail data-clamped={(!confirming && s !== 'done') || undefined} style={{ marginTop: 5, overflowWrap: 'anywhere', ...muted, ...(!confirming && s !== 'done' ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}) }}>{r.detail}</div>}
          {r.request && (
            <pre data-action-request={s === 'stale' ? 'old' : s === 'denied' ? 'faded' : 'live'} style={{ margin: '6px 0 0', padding: '7px 9px', border: '1px solid var(--sidebar-border)', borderLeft: '2px solid var(--muted-foreground)', borderRadius: 4, background: 'var(--sidebar)', font: "11.5px/17px 'Geist Mono', ui-monospace, monospace", whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 120, overflow: 'auto', color: 'var(--sidebar-foreground)', ...(s === 'stale' ? { textDecoration: 'line-through', opacity: 0.6 } : s === 'denied' ? { opacity: 0.6 } : {}) }}>
              <span style={{ display: 'block', font: "500 10.5px/15px 'Geist', system-ui, sans-serif", marginBottom: 2, ...muted }}>{r.request.kind}</span>{r.request.text}
            </pre>
          )}
          {s === 'failed' && <div role="alert" style={{ marginTop: 5, color: 'var(--danger-text)', overflowWrap: 'anywhere' }}>{c.failed(r.error ?? '')}</div>}
          {s === 'refused' && <div role="alert" style={{ marginTop: 5, color: 'var(--danger-text)', overflowWrap: 'anywhere' }}>{c.refused(r.error ?? '')}</div>}
          {s === 'held' && <div style={{ marginTop: 5, ...muted }}>{c.held(stopAt + 1)}</div>}
          {s === 'stale' && <div style={{ marginTop: 5, color: 'var(--warning)' }}>{c.stale(r.target ?? '')}</div>}
          {s === 'denied' && <div style={{ marginTop: 5, ...muted }}>{c.deniedNote(r.target ?? '')}</div>}
        </div>
        {what && <div data-action-side data-under={p.narrow || undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', ...(p.narrow ? { gridColumn: many ? 2 : 1, justifySelf: 'start' } : { justifySelf: 'end' }), ...fade }}>{what}</div>}
      </div>
    );
  };

  const footer = (): ReactNode => {
    if (confirming) {
      const one = confirming.length === 1 ? p.rows[confirming[0]!]! : null;
      return (
        <div data-action-foot role="group" aria-label={c.confirm.label} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setConfirming(null); } }}
          style={{ ...foot, flexDirection: 'column', alignItems: 'stretch', gap: 8, background: 'color-mix(in srgb, var(--destructive) 5%, transparent)' }}>
          <strong style={{ fontSize: 13 }}>{one ? c.confirm.one(plain(one.summary)) : c.confirm.many(confirming.length, confirming.length === p.rows.length)}</strong>
          <span style={{ fontSize: 12, ...muted }}>{one ? c.confirm.oneWhy : c.confirm.manyWhy(confirming.filter(i => p.rows[i]!.risk === 'destructive').length)}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button ref={cancel} size="sm" onClick={() => setConfirming(null)} style={small}>{c.confirm.cancel}</Button>
            <Button size="sm" disabled={p.disabled} onClick={() => go(confirming)} style={{ ...big, ...dangerFill }}>{one ? verb(one) : c.confirm.go(confirming.length)}</Button>
          </div>
        </div>
      );
    }
    if (!many) return null;
    if (shown.every(s => s === 'done')) {
      const last = p.rows.map(r => r.doneAt).filter((x): x is string => !!x).sort().at(-1);
      return <div data-action-foot style={foot}><span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={12} {...ICONS.check} />{c.planDone(clock(last))}</span></div>;
    }
    const running = shown.indexOf('running');
    if (running >= 0) return <div data-action-foot style={foot}><Button variant="primary" size="sm" disabled style={big}>{spinner}{c.progress(running + 1, p.rows.length)}</Button><span style={{ flex: 1, minWidth: 160, fontSize: 12, ...muted }}>{c.inOrder}</span></div>;
    if (!open.length) return null;
    // From the failed step again, or past a refused one: its target is gone, it would only be refused again.
    const rows = stopAt >= 0 && states[stopAt] === 'refused' ? open.filter(i => i !== stopAt) : open;
    const label = stopAt < 0 ? c.all(rows.length) : states[stopAt] === 'refused' ? c.skip(stopAt + 1, rows.length) : c.resume(stopAt + 1, rows.length);
    const later = rows.filter(i => p.rows[i]!.risk === 'destructive').length;
    return (
      <div data-action-foot style={foot}>
        <Button variant="primary" size="sm" disabled={p.disabled || !rows.length} data-action-ask="all" onClick={() => ask(rows, 'all')} style={big}><Icon size={10} {...ICONS.play} />{label}{dots(rows)}</Button>
        <span style={{ flex: 1, minWidth: 160, fontSize: 12, ...muted }}>{stopAt >= 0 ? c.notReplayed : later ? `${c.inOrder} · ${c.destructiveLater(later)}` : c.inOrder}</span>
        {ignore}
      </div>
    );
  };

  return (
    <section ref={box} data-action-card data-confirming={confirming ? true : undefined} aria-label={c.label(p.rows.length)}
      style={{ border: `1px solid ${confirming ? 'color-mix(in srgb, var(--destructive) 55%, var(--sidebar-border))' : 'var(--sidebar-border)'}`, borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {p.rows.map(row)}
      {footer()}
    </section>
  );
}
