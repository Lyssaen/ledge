import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import type { ChatAction, ChatPoint, ChatTurn, PointItem } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { useChatCopy, type ChatCopy } from './copy';
import { inline } from './inline';
export { newestPointRead } from './point';

type Nav = NonNullable<PointItem['nav']>[number];
type Answer = { id: string } | { text: string };
/** A row's answer or suggestion the daemon refused unconfirmed (`confirm_required`). */
export interface PointConfirm { item: string; answer?: Answer }

export interface PointTurnProps {
  turn: ChatTurn & { point: ChatPoint };
  /** The point's machine, shown once more than one machine is linked. */
  machineName?: string;
  onAnswer: (item: string, a: Answer) => void;
  onNav: (n: Nav) => void;
  onSuggestion: (item: string) => void;
  /** The mascot of the header (the chat's resident, 18 px); none in a test. */
  mascot?: ReactNode;
  /** The row whose answer or suggestion is on its way (an empty string: a row of another turn): every button waits. */
  busy?: string | null;
  /** What the daemon asked to confirm (a destructive answer, or the suggestion when `answer` is absent): the row's buttons give
   *  way to the question. */
  confirming?: PointConfirm | null;
  onConfirm?: () => void; onCancelConfirm?: () => void;
  /** The machine is offline: nothing can be sent. */
  disabled?: boolean;
}

const GROUPS = ['atoi', 'done', 'ongoing', 'rigs'] as const;
/** Each tone's dot, in the chat's own state colors. */
const TONE: Record<PointItem['tone'], string> = {
  perm: 'var(--destructive)', ask: 'var(--warning)', work: 'var(--info)', idle: 'var(--success)', off: 'color-mix(in srgb, var(--muted-foreground) 70%, transparent)'
};
const muted: CSSProperties = { color: 'var(--muted-foreground)' };
const btn: CSSProperties = { height: 22, padding: '0 8px', gap: 5, fontSize: 11.5, fontWeight: 400, borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0 };
const ghost: CSSProperties = { ...btn, ...muted };
const danger: CSSProperties = { color: 'var(--danger-text)', borderColor: 'color-mix(in srgb, var(--destructive) 45%, transparent)' };
const dangerFill: CSSProperties = { background: 'var(--destructive)', color: 'var(--destructive-foreground)', borderColor: 'transparent' };
const mono = "'Geist Mono', ui-monospace, Consolas, monospace";
const plain = (s: string) => s.replace(/\*\*/g, '');

/** A suggestion's button: the point's own words for its action, else the card's verb, else « Apply ». */
function suggestionLabel(a: ChatAction, t: ChatCopy): string {
  const c = t.chat.action, vars = a.vars ?? {};
  return t.chat.point?.suggest[a.action]?.(vars) ?? c?.words.verb(a.action, vars) ?? c?.verbs[a.action] ?? c?.apply ?? plain(a.summary);
}

/**
 * The point Ledge writes on its own (docs/mockups/ledge-operator.html, board 1): a header (mascot, « Ledge », « de lui-même »,
 * the time), the lead sentence, then its rows by group, each with its dot, who, rig, text, sub and buttons. A settled row keeps
 * its receipt instead of buttons; once every row is settled the point folds to one line.
 */
export function PointTurn(p: PointTurnProps): JSX.Element {
  const t = useChatCopy();
  const c = t.chat.point!;
  const point = p.turn.point;
  const clock = (iso: string) => new Date(iso).toLocaleTimeString(t.time.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const frame: CSSProperties = {
    background: 'var(--card)', border: '1px solid color-mix(in srgb, var(--sidebar-primary) 40%, var(--sidebar-border))', borderRadius: 9,
    padding: '8px 10px', fontSize: 12, lineHeight: '17px', minWidth: 0, color: 'var(--sidebar-foreground)'
  };

  if (point.foldedAt) return (
    <article data-point data-point-folded aria-label={c.folded(clock(point.foldedAt))} style={{ ...frame, display: 'flex', alignItems: 'center', gap: 6, ...muted }}>
      {p.mascot}<span>{c.folded(clock(point.foldedAt))}</span>
    </article>
  );

  return (
    <article data-point aria-label={`Ledge · ${clock(p.turn.askedAt)}`} style={frame}>
      <div data-point-head style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, lineHeight: '16px', marginBottom: 6, ...muted }}>
        {p.mascot}
        <b style={{ color: 'var(--sidebar-foreground)', fontWeight: 600 }}>{t.chat.title}</b>
        <span>{c.by}</span>
        {p.machineName && <span data-point-machine>· {p.machineName}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: mono }}>{clock(p.turn.askedAt)}</span>
      </div>
      <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{inline(point.lead)}</p>
      {GROUPS.map(g => {
        const rows = point.items.filter(i => i.group === g);
        if (!rows.length) return null;
        return (
          <div key={g} role="group" aria-label={`${c.groups[g]} ${rows.length}`} data-point-group={g} style={{ marginTop: 8 }}>
            <h5 style={{ margin: '0 0 4px', fontSize: 10.5, lineHeight: '14px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 500, display: 'flex', gap: 6, alignItems: 'center', ...muted }}>
              {c.groups[g]} <span style={{ fontFamily: mono, letterSpacing: 0 }}>{rows.length}</span>
            </h5>
            {rows.map((i, k) => <Row key={i.id} item={i} first={k === 0} {...p} clock={clock} />)}
          </div>
        );
      })}
    </article>
  );
}

function Row(p: PointTurnProps & { item: PointItem; first: boolean; clock: (iso: string) => string }): JSX.Element {
  const t = useChatCopy();
  const c = t.chat.point!, a = t.chat.action;
  const { item } = p;
  const [answering, setAnswering] = useState(false);
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (answering) field.current?.focus(); }, [answering]);
  const asked = p.confirming?.item === item.id ? p.confirming : null;
  const confirming = !!asked;
  const busy = p.busy === item.id;
  // One answer at a time across the thread: any row on its way holds every button.
  const off = !!p.disabled || (p.busy !== null && p.busy !== undefined);
  const permission = item.ref?.kind === 'session.request' && item.tone === 'perm';
  const quoted = item.group === 'atoi' && item.tone === 'ask';
  // A finished row says when; the others say how long, in their sub, as the daemon wrote it.
  const sub = [item.sub, item.group === 'done' ? p.clock(item.at) : undefined].filter(Boolean).join(' · ');
  const s = item.suggestion;
  const send = () => { const v = text.trim(); if (!v) return; p.onAnswer(item.id, { text: v }); setAnswering(false); setText(''); };

  const buttons = (): ReactNode => {
    if (item.settled) return null;
    if (confirming) return null;
    const list: ReactNode[] = [];
    for (const x of item.answers ?? []) {
      list.push(<Button key={`a-${x.id}`} size="sm" variant={x.style === 'primary' ? 'primary' : 'outline'} disabled={off} onClick={() => p.onAnswer(item.id, { id: x.id })} style={{ ...btn, ...(x.style === 'danger' ? danger : {}) }}>{x.label}</Button>);
    }
    if (item.freeText) list.push(<Button key="reply" size="sm" variant="ghost" disabled={off} aria-expanded={answering} onClick={() => setAnswering(v => !v)} style={ghost}>{c.reply}</Button>);
    const navs = item.nav ?? [];
    for (const n of navs.filter(n => n.kind === 'pr')) list.push(<Button key={`n-${n.kind}-${n.id}`} size="sm" onClick={() => p.onNav(n)} style={btn}>{c.nav.pr}</Button>);
    if (s && s.state !== 'done') {
      const running = s.state === 'running' || busy;
      list.push(<Button key="suggest" size="sm" disabled={off || running} onClick={() => p.onSuggestion(item.id)} style={{ ...btn, ...(s.risk === 'destructive' ? danger : {}) }}>{running && a ? a.running : suggestionLabel(s, t)}</Button>);
    }
    // The screens a row opens: shown while the row keeps the panel's narrow width (three buttons at most), after its answers.
    for (const n of navs.filter(n => n.kind !== 'pr')) if (list.length < 3) list.push(<Button key={`n-${n.kind}-${n.id}`} size="sm" variant="ghost" onClick={() => p.onNav(n)} style={ghost}>{c.nav[n.kind]}</Button>);
    return list.length ? <div data-point-acts style={{ gridColumn: 2, display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 3 }}>{list}</div> : null;
  };

  const confirm = (): ReactNode => {
    if (!asked || item.settled || !a) return null;
    // The question in the generic card's words: the suggestion's own line, or the answer named for whom it goes.
    const answer = asked.answer;
    const option = answer && 'id' in answer ? item.answers?.find(x => x.id === answer.id) : undefined;
    const label = !answer ? (s ? suggestionLabel(s, t) : a.apply) : 'text' in answer ? c.answer.send : option?.label ?? answer.id;
    const question = !answer ? a.confirm.one(plain((s?.vars ? a.words.line[s.action]?.(s.vars) : undefined) ?? s?.summary ?? label))
      : c.confirmAnswer('text' in answer ? c.quote(answer.text) : label, item.who);
    return (
      <div data-point-confirm role="group" aria-label={a.confirm.label} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); p.onCancelConfirm?.(); } }}
        style={{ gridColumn: 2, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 5, padding: '7px 8px', borderRadius: 6, background: 'color-mix(in srgb, var(--destructive) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--destructive) 40%, var(--sidebar-border))' }}>
        <strong style={{ fontSize: 12, fontWeight: 600 }}>{question}</strong>
        <span style={{ fontSize: 11.5, ...muted }}>{a.confirm.oneWhy}</span>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <Button size="sm" autoFocus onClick={() => p.onCancelConfirm?.()} style={btn}>{a.confirm.cancel}</Button>
          <Button size="sm" disabled={p.disabled} onClick={() => p.onConfirm?.()} style={{ ...btn, ...dangerFill }}>{label}</Button>
        </div>
      </div>
    );
  };

  return (
    <div data-point-item={item.id} data-settled={item.settled ? true : undefined}
      style={{ display: 'grid', gridTemplateColumns: '12px minmax(0,1fr)', gap: '2px 7px', padding: '5px 0', borderTop: p.first ? undefined : '1px dashed var(--sidebar-border)' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, background: TONE[item.tone], opacity: item.settled ? 0.5 : 1 }} />
      <div style={{ minWidth: 0, overflowWrap: 'anywhere', ...(item.settled ? muted : {}) }}>
        <b style={{ fontWeight: 600 }}>{item.who}</b>
        {item.rig && <span style={muted}> · {item.rig}</span>}
        {/* A rig's ask that offers options is a decision to take (board 1's pill). */}
        {item.ref?.kind === 'rig.ask' && !!item.answers?.length && !item.settled && <> <span data-point-pill style={{ fontSize: 10.5, lineHeight: '15px', border: '1px solid color-mix(in srgb, var(--sidebar-primary) 50%, transparent)', color: 'var(--sidebar-primary)', borderRadius: 8, padding: '0 6px', whiteSpace: 'nowrap', display: 'inline-block' }}>{c.decision}</span></>}
        {permission ? <>{' '}{c.wantsToRun} <code style={{ fontFamily: mono, fontSize: 11 }}>{item.text}</code></>
          : quoted ? <><br />{c.quote(item.text)}</>
            : <> {item.text}</>}
        {sub && <small style={{ display: 'block', fontSize: 11, ...muted }}>{sub}</small>}
        {item.settled && (
          <span data-point-receipt style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11, color: 'var(--success)' }}>
            ✓ {[item.settled.answer, c.settled[item.settled.where], p.clock(item.settled.at)].filter(Boolean).join(' · ')}
          </span>
        )}
        {!item.settled && s?.state === 'done' && a && <span data-point-receipt style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 11, color: 'var(--success)' }}>✓ {suggestionLabel(s, t)} · {a.done(s.doneAt ? p.clock(s.doneAt) : '')}</span>}
        {!item.settled && item.error && <span role="alert" style={{ display: 'block', fontSize: 11, color: 'var(--danger-text)' }}>{c.error(item.error)}</span>}
      </div>
      {buttons()}
      {confirm()}
      {answering && !item.settled && !confirming && (
        <div data-point-answer style={{ gridColumn: 2, display: 'flex', gap: 5, marginTop: 4 }}>
          <input ref={field} className="ledge-field" aria-label={c.answer.label} placeholder={c.answer.placeholder} value={text} disabled={off}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } else if (e.key === 'Escape') { e.stopPropagation(); setAnswering(false); } }}
            style={{ flex: 1, minWidth: 0, height: 26, boxSizing: 'border-box', padding: '0 8px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 6, fontSize: 12 }} />
          <Button size="sm" variant="ghost" onClick={() => { setAnswering(false); setText(''); }} style={ghost}>{c.answer.cancel}</Button>
          <Button size="sm" variant="primary" disabled={off || !text.trim()} onClick={send} style={btn}>{c.answer.send}</Button>
        </div>
      )}
    </div>
  );
}
