import type { ReactNode } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { relativeTime } from '../format';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { turns, type Turn } from '../thread/turns';
import { LiveToolLine } from './LiveToolLine';

export interface ThreadProps {
  session: Session; items: ThreadItem[]; t: Messages; theme: 'dark' | 'light';
  paused: boolean; frozen?: boolean; reducedMotion?: boolean; now?: number;
  /** The main view shows the current reply as the card below the thread; the helper view shows it as its report. */
  hideCurrentReply?: boolean;
}

const mono = { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } as const;
const pre = { ...mono, margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: '17px', whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', maxHeight: 220, overflow: 'auto' };
const muted = { fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' } as const;

function Item({ item, session, t, theme, paused, frozen, reducedMotion }: { item: ThreadItem } & Omit<ThreadProps, 'items' | 'hideCurrentReply' | 'now'>) {
  switch (item.kind) {
    case 'prompt': return (
      <div data-item="prompt" data-prompt style={{ margin: '0 0 0 18px', padding: '10px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <span style={{ ...muted, display: 'block', fontSize: 10, marginBottom: 4 }}>{t.thread.you}</span>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{item.text}</p>
      </div>);
    // The bot takes the same props as the header bot in SessionView.tsx (botState/poseFor signatures live in ../bots/poseFor).
    case 'message': return (
      <div data-item="message" data-message style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '14px 0 10px' }}>
        <Bot seed={`${session.id}:msg`} tool={session.tool} state={botState(session)} pose={poseFor(session.id, session.state)} size={20} theme={theme} paused={paused} frozen={frozen} reducedMotion={reducedMotion} />
        <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 13, lineHeight: '20px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}><strong style={{ fontWeight: 600 }}>{session.name}</strong> {item.text}</p>
      </div>);
    case 'permission': return (
      <div data-item="permission" data-permission data-decision={item.decision ?? 'pending'} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ ...muted, display: 'block', fontSize: 10 }}>{t.thread.permission} · {item.decision ? t.thread.decided[item.decision] : t.thread.undecided}</span>
        <pre className="ledge-scroll" style={{ ...pre, marginTop: 6 }}>{item.text}</pre>
      </div>);
    default: return null; // tool calls share the live line; helper rows live under the title; the current reply is the card
  }
}

function PreviousTurn({ turn, t, now }: { turn: Turn; t: Messages; now?: number }) {
  return (
    <details data-item="previous-turn" data-previous-turn style={{ marginBottom: 14 }}>
      <summary style={{ ...muted, display: 'flex', justifyContent: 'space-between', cursor: 'pointer', listStyle: 'none' }}>
        <span>{t.thread.previousTurn}</span><span>{turn.prompt ? relativeTime(turn.prompt.at, now, t) : t.thread.noTime}</span>
      </summary>
      <div style={{ borderLeft: '1px solid var(--border)', padding: '8px 0 0 11px', marginTop: 8, fontSize: 12, lineHeight: '19px' }}>
        {turn.prompt && <p style={{ margin: '0 0 6px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><span style={muted}>{t.thread.you} · </span>{turn.prompt.text}</p>}
        {turn.reply && <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.reply.text}</p>}
      </div>
    </details>
  );
}

/** Spec 2026-10-13 §6: previous turns folded, then the current turn as stacked rows. No counters anywhere.
 *  Decision of 2026-10-14: tool calls are not rows but one live line, and their results are not kept in the thread. */
export function Thread(p: ThreadProps) {
  const { items, t, session, hideCurrentReply = true } = p;
  const all = turns(items);
  // Cursor tells less: the note matters most while there is nothing to show yet.
  const note = session.tool === 'cursor' && <p data-source-note style={{ ...muted, margin: '10px 0 0' }}>{t.thread.cursorNote}</p>;
  if (all.length === 0) return note
    ? <div data-thread data-empty style={{ marginTop: 12 }}><p style={{ ...muted, margin: 0 }}>{t.thread.empty}</p>{note}</div>
    : <p data-thread data-empty style={{ ...muted, margin: '12px 0 0' }}>{t.thread.empty}</p>;
  const current = all[all.length - 1]!;
  const rows: ReactNode[] = all.slice(0, -1).map(turn => <PreviousTurn key={turn.n} turn={turn} t={t} now={p.now} />);
  // The turn's tool calls are one live line, standing where its first call is: the running tool, then its mark.
  let placed = false;
  for (const it of current.items) {
    if (hideCurrentReply && it.kind === 'reply') continue;
    if (it.kind === 'tool') {
      if (!placed) { placed = true; rows.push(<LiveToolLine key="live-tools" items={current.items} t={t} now={p.now} paused={p.paused} reducedMotion={p.reducedMotion} />); }
      continue;
    }
    rows.push(<Item key={it.id} item={it} session={session} t={t} theme={p.theme} paused={p.paused} frozen={p.frozen} reducedMotion={p.reducedMotion} />);
  }
  return (
    <div data-thread style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
      {rows}
      {note}
    </div>
  );
}
