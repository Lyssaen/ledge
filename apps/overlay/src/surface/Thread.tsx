import type { ReactNode } from 'react';
import type { Session, ThreadItem } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '@ledge/client';
import { turns } from '../thread/turns';
import { LiveToolLine } from './LiveToolLine';
import { ThreadMarkdown } from '../documents/MarkdownDocument';
import type { DocumentReference } from '../documents/references';

export interface ThreadProps {
  session: Session; items: ThreadItem[]; t: Messages; theme: 'dark' | 'light';
  paused: boolean; frozen?: boolean; reducedMotion?: boolean; now?: number;
  /** The main view shows the current reply as the card below the thread; the helper view shows it as its report. */
  hideCurrentReply?: boolean;
  /** Opens a Markdown document an agent's message links to; without it such links stay text. */
  onDocument?: (ref: DocumentReference) => void;
}

const mono = { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } as const;
const pre = { ...mono, margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: '17px', whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', maxHeight: 220, overflow: 'auto' };
const muted = { fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' } as const;

function Item({ item, session, t, theme, paused, frozen, reducedMotion, onDocument }: { item: ThreadItem } & Omit<ThreadProps, 'items' | 'hideCurrentReply' | 'now'>) {
  switch (item.kind) {
    case 'prompt': return (
      <div data-item="prompt" data-prompt style={{ margin: '0 0 0 18px', padding: '10px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
        <span style={{ ...muted, display: 'block', fontSize: 10, marginBottom: 4 }}>{t.thread.you}</span>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{item.text}</p>
      </div>);
    // The bot takes the same props as the header bot in SessionView.tsx (botState/poseFor signatures live in ../bots/poseFor).
    case 'message':
    case 'reply': return (
      <div data-item={item.kind} {...(item.kind === 'message' ? { 'data-message': '' } : { 'data-reply-item': '' })} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '14px 0 10px' }}>
        <Bot seed={`${session.id}:msg`} tool={session.tool} state={botState(session)} pose={poseFor(session.id, session.state)} size={20} theme={theme} paused={paused} frozen={frozen} reducedMotion={reducedMotion} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: '20px', overflowWrap: 'anywhere' }}><strong style={{ fontWeight: 600 }}>{session.name}</strong> <ThreadMarkdown text={item.text} onDocument={onDocument} /></div>
      </div>);
    case 'permission': return (
      <div data-item="permission" data-permission data-decision={item.decision ?? 'pending'} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ ...muted, display: 'block', fontSize: 10 }}>{t.thread.permission} · {item.decision ? t.thread.decided[item.decision] : t.thread.undecided}</span>
        <pre className="ledge-scroll" style={{ ...pre, marginTop: 6 }}>{item.text}</pre>
      </div>);
    default: return null; // tool calls share the live line; helper rows live under the title
  }
}

/** Spec 2026-10-13 §6, decision of 2026-10-14: the whole conversation as one continuous thread, oldest first, read by
 *  scrolling up; no turn is folded. Tool calls are not rows but one live line, always the thread's last, and their
 *  results are not kept. The turns stay in the data (echo of a reply, the live line's calls): only the display drops them. */
export function Thread(p: ThreadProps) {
  const { items, t, session, hideCurrentReply = true } = p;
  const all = turns(items);
  // Cursor tells less: the note matters most while there is nothing to show yet.
  const note = session.tool === 'cursor' && <p data-source-note style={{ ...muted, margin: '10px 0 0' }}>{t.thread.cursorNote}</p>;
  if (all.length === 0) return note
    ? <div data-thread data-empty style={{ marginTop: 12 }}><p style={{ ...muted, margin: 0 }}>{t.thread.empty}</p>{note}</div>
    : <p data-thread data-empty style={{ ...muted, margin: '12px 0 0' }}>{t.thread.empty}</p>;
  const current = all[all.length - 1]!;
  const rows: ReactNode[] = [];
  for (const turn of all) for (const it of turn.items) {
    if (it.kind === 'tool' || (hideCurrentReply && it.kind === 'reply' && turn === current)) continue;
    rows.push(<Item key={it.id} item={it} session={session} t={t} theme={p.theme} paused={p.paused} frozen={p.frozen} reducedMotion={p.reducedMotion} onDocument={p.onDocument} />);
  }
  // The current turn's calls are one live line, under everything said so far: the running tool, then its mark.
  if (current.items.some(it => it.kind === 'tool')) rows.push(<LiveToolLine key="live-tools" items={current.items} t={t} now={p.now} paused={p.paused} reducedMotion={p.reducedMotion} />);
  return (
    <div data-thread style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
      {rows}
      {note}
    </div>
  );
}
