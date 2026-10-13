import type { ReactNode } from 'react';
import type { Session, ThreadItem, ToolItem, FileChange } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { duration, relativeTime } from '../format';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { turns, type Turn } from '../thread/turns';

export interface ThreadProps {
  session: Session; items: ThreadItem[]; t: Messages; theme: 'dark' | 'light';
  paused: boolean; frozen?: boolean; reducedMotion?: boolean; now?: number;
  /** The main view shows the current reply as the card below the thread; the helper view shows it as its report. */
  hideCurrentReply?: boolean;
}

const mono = { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } as const;
const pre = { ...mono, margin: 0, padding: '8px 10px', fontSize: 11, lineHeight: '17px', whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', maxHeight: 220, overflow: 'auto' };
const muted = { fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' } as const;
const label = { fontSize: 10, lineHeight: '14px', letterSpacing: '.08em', textTransform: 'uppercase' as const, color: 'var(--muted-foreground)', margin: '8px 0 4px' };

const STATUS_MARK: Record<ToolItem['status'], { mark: string; color: string }> = {
  success: { mark: '✓', color: 'var(--success, var(--sidebar-primary))' }, failed: { mark: '!', color: 'var(--destructive)' },
  running: { mark: '◌', color: 'var(--warning)' }, unknown: { mark: '·', color: 'var(--muted-foreground)' }
};

function FileRow({ file, status, t }: { file: FileChange; status: ToolItem['status']; t: Messages }) {
  const confirmed = status === 'success';
  const state = confirmed ? t.thread.file.confirmed : status === 'running' ? t.thread.file.writing : t.thread.file.unconfirmed;
  return (
    <details data-file data-confirmed={confirmed ? 'true' : 'false'} style={{ margin: '0 0 0 25px' }}>
      <summary style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', cursor: 'pointer', listStyle: 'none' }}>
        <span aria-hidden style={{ color: confirmed ? 'var(--success, var(--sidebar-primary))' : 'var(--muted-foreground)', fontSize: 13 }}>{confirmed ? '✓' : '·'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ ...mono, display: 'block', fontSize: 11, lineHeight: '16px', fontWeight: 500, overflowWrap: 'anywhere' }}>{file.path}</strong>
          <small style={{ ...muted, display: 'block', fontSize: 10 }}>{t.thread.file[file.change]} · {state}</small>
        </span>
      </summary>
      {file.diff && <pre className="ledge-scroll" style={{ ...pre, marginBottom: 8 }}>{file.diff}</pre>}
    </details>
  );
}

/** One action: its row folded, its input and result unfolded. Missing data is said, never guessed (spec §1). */
export function ActionRow({ item, t }: { item: ToolItem; t: Messages }) {
  const { mark, color } = STATUS_MARK[item.status];
  const isCommand = /^(bash|shell|command|exec)/i.test(item.tool);
  const bottom = item.status === 'running' ? t.thread.waiting : item.status === 'failed' ? t.thread.failed : item.status === 'success' ? t.thread.received : t.thread.unknownState;
  return (
    <article data-item="action" data-action data-status={item.status} style={{ borderBottom: '1px solid var(--border)' }}>
      <details>
        <summary style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 1px', cursor: 'pointer', listStyle: 'none' }}>
          <span aria-hidden style={{ color, width: 14, textAlign: 'center', fontSize: 12 }}>{mark}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 12, lineHeight: '16px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</strong>
          </span>
          {item.status === 'running' && <span style={{ ...muted, fontSize: 10 }}>{t.thread.running}</span>}
          {item.status === 'failed' && <span style={{ ...muted, fontSize: 10, color: 'var(--destructive)' }}>{t.thread.failed}</span>}
          <span aria-hidden style={{ ...muted, fontSize: 10 }}>›</span>
        </summary>
        <div style={{ padding: '0 0 10px 23px' }}>
          {item.input && <><div style={label}>{isCommand ? t.thread.command : t.thread.params}</div><pre className="ledge-scroll" style={pre}>{item.input}</pre></>}
          {item.error
            ? <><div style={label}>{t.thread.error}</div><pre data-action-output className="ledge-scroll" style={{ ...pre, borderColor: 'color-mix(in srgb, var(--destructive) 40%, transparent)' }}>{item.error}</pre></>
            : item.output !== undefined
              ? <><div style={label}>{t.thread.result}</div><pre data-action-output className="ledge-scroll" style={pre}>{item.output}</pre></>
              : item.status !== 'running' && <p style={{ ...muted, margin: '8px 0 0' }}>{t.thread.noResult}</p>}
          <p style={{ ...muted, margin: '8px 0 0', fontSize: 10 }}>{bottom} · {item.durationMs !== undefined ? duration(item.durationMs, t) : t.thread.noDuration}</p>
        </div>
      </details>
      {item.files.map((f, i) => <FileRow key={`${i}-${f.path}`} file={f} status={item.status} t={t} />)}
    </article>
  );
}

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
    case 'tool': return <ActionRow item={item} t={t} />;
    case 'permission': return (
      <div data-item="permission" data-permission data-decision={item.decision ?? 'pending'} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ ...muted, display: 'block', fontSize: 10 }}>{t.thread.permission} · {item.decision ? t.thread.decided[item.decision] : t.thread.undecided}</span>
        <pre className="ledge-scroll" style={{ ...pre, marginTop: 6 }}>{item.text}</pre>
      </div>);
    default: return null; // helper rows live under the title; the current reply is the card
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

/** Spec 2026-10-13 §6: previous turns folded, then the current turn as stacked rows. No counters anywhere. */
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
  for (const it of current.items) {
    if (hideCurrentReply && it.kind === 'reply') continue;
    rows.push(<Item key={it.id} item={it} session={session} t={t} theme={p.theme} paused={p.paused} frozen={p.frozen} reducedMotion={p.reducedMotion} />);
  }
  return (
    <div data-thread style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
      {rows}
      {note}
    </div>
  );
}
