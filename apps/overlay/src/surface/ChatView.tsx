import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { ChatStep, ChatTurn, Session } from '@ledge/protocol';
import { ResidentMascot } from '../bots/ResidentMascot';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { relativeTime } from '../format';
import { transition } from '../motion';
import { useI18n, type Messages } from '../i18n/lang';
import { inline } from './ReplyCard';
import { groupSessions } from '@ledge/client';
import type { DocumentReference } from '../documents/references';

export const CHAT_HEADER_H = 56;
export interface ChatViewProps {
  turns: ChatTurn[]; live: { qid: string; text: string } | null; sessions: Session[]; visible: boolean; enterDelay?: number;
  /** Null when questions may be sent; otherwise why not (offline). */
  offline: string | null;
  onAsk: (text: string) => void; onCancel: (qid: string) => void; onReset: () => void; onBack: () => void; onClose: () => void; onOpenSession: (id: string) => void;
  onDocument?: (ref: DocumentReference) => void;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean; now?: number; contentRef?: Ref<HTMLDivElement>;
}

const stepLabel = (s: ChatStep, t: Messages) => s.kind === 'sessions' ? t.chat.step.sessions : s.kind === 'repo' ? t.chat.step.repo(s.path ?? '') : t.chat.step[s.kind](s.name ?? '');
const sourceLabel = (s: ChatStep, t: Messages) => s.kind === 'sessions' ? t.chat.source.sessions : s.kind === 'repo' ? t.chat.source.repo(s.name ?? s.path ?? '') : t.chat.source[s.kind](s.name ?? '');

/** `**Nova**` for a known bot becomes a `ledge://session/<id>` link that opens its session. */
function linkBots(text: string, sessions: Session[]): string {
  return sessions.reduce((acc, s) => acc.replaceAll(`**${s.name}**`, `[${s.name}](ledge://session/${s.id})`), text);
}

/** Simple Markdown: paragraphs, bullet lists, `###` headings; inline marks through the reply renderer. */
function Answer({ text, sessions, onOpen, onDocument }: { text: string; sessions: Session[]; onOpen: (id: string) => void; onDocument?: (ref: DocumentReference) => void }) {
  const onLink = (url: string) => { if (!url.startsWith('ledge://')) return false; const m = /^ledge:\/\/session\/(.+)$/.exec(url); if (m) onOpen(m[1]!); return true; };
  const blocks = linkBots(text, sessions).split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: '19px', minWidth: 0 }}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every(l => /^[-*] /.test(l))) return <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2), 0, onLink, onDocument)}</li>)}</ul>;
        if (/^#{1,3} /.test(b)) return <h3 key={i} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{inline(b.replace(/^#{1,3} /, ''), 0, onLink, onDocument)}</h3>;
        return <p key={i} style={{ margin: 0, overflowWrap: 'anywhere' }}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, 0, onLink, onDocument)}</span>)}</p>;
      })}
    </div>
  );
}

export function ChatView(p: ChatViewProps) {
  const { t } = useI18n();
  const { turns, live, visible, enterDelay = 120 } = p;
  const running = turns.find(x => x.answeredAt === undefined && x.error === undefined) ?? null;
  const busy = !!running;
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = thread.current; if (visible && el) el.scrollTop = el.scrollHeight; }, [turns, live?.text]);
  useEffect(() => { if (visible && !busy) field.current?.focus({ preventScroll: true }); }, [visible, busy]);
  // The resident pulses while Ledge reads.
  const [pulse, setPulse] = useState(0);
  useEffect(() => { if (!busy || !visible || p.reducedMotion) return; const id = setInterval(() => setPulse(k => k + 1), 1400); return () => clearInterval(id); }, [busy, visible, p.reducedMotion]);
  const submit = (q: string) => { const v = q.trim(); if (!v || busy || p.offline) return; p.onAsk(v); setText(''); };
  const repos = groupSessions(p.sessions).length;
  const mascot = (size: number, pulsing = false) => <ResidentMascot size={size} theme={p.theme ?? 'dark'} paused={!visible} frozen={p.frozen} reducedMotion={p.reducedMotion} gestureKey={pulsing && busy ? pulse : undefined} gestureKind="pulse" />;
  return (
    <div data-layer="chat" data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: CHAT_HEADER_H, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <Button variant="ghost" size="icon" aria-label={t.chat.back} title={t.chat.back} data-initial-focus onClick={p.onBack}><Icon {...ICONS.chevronLeft} /></Button>
        {mascot(28, true)}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
          <span data-brand style={{ fontSize: 14, lineHeight: '18px', fontWeight: 650 }}>{t.chat.title}<span style={{ color: 'var(--sidebar-primary)' }}>.</span></span>
          <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.chat.subtitle(p.sessions.length, repos)}</span>
        </div>
        {/* A new conversation forgets the day's turns and Claude session; offered between questions, once there is something to forget. */}
        <Button variant="ghost" size="icon" aria-label={t.chat.reset} title={t.chat.reset} disabled={busy || !!p.offline || turns.length === 0} onClick={p.onReset}><Icon {...ICONS.plus} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.chat.close} title={t.chat.close} onClick={p.onClose}><Icon {...ICONS.close} /></Button>
      </div>
      <div ref={thread} data-scroll className="ledge-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div ref={p.contentRef} data-chat-content style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px 10px' }}>
          {turns.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, padding: '18px 16px 8px', color: 'var(--muted-foreground)', fontSize: 12.5, lineHeight: '18px' }}>
              {mascot(44)}<strong style={{ color: 'var(--sidebar-foreground)', fontSize: 14 }}>{t.chat.emptyTitle}</strong><span>{t.chat.emptyHint(p.sessions.length)}</span>
            </div>
          )}
          {turns.map(turn => (
            <div key={turn.qid} data-turn style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}><span style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: '12px 12px 4px 12px', background: 'var(--secondary)', fontSize: 13, lineHeight: '19px', overflowWrap: 'anywhere' }}>{turn.question}</span></div>
              {turn.error === 'cancelled' ? <span data-chat-stopped style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.chat.stopped}</span>
                : turn.error !== undefined && <span data-chat-error role="alert" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--destructive)' }}>{t.chat.error(turn.error)}</span>}
              {turn.error === undefined && (turn.answeredAt !== undefined || turn.steps.length > 0 || live?.qid === turn.qid || running?.qid === turn.qid) && (
                <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10, alignItems: 'start' }}>
                  {mascot(24, running?.qid === turn.qid)}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
                    {turn.answeredAt === undefined && (
                      <div data-steps style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
                        {turn.steps.length === 0 && <span>{t.chat.thinking}</span>}
                        {turn.steps.map((s, i) => <span key={i} style={{ display: 'flex', gap: 4, color: i === turn.steps.length - 1 ? 'var(--sidebar-foreground)' : undefined }}>{i < turn.steps.length - 1 && <span aria-hidden>✓</span>}<span>{stepLabel(s, t)}</span></span>)}
                      </div>
                    )}
                    {(turn.answer || (turn.answeredAt === undefined && live?.qid === turn.qid && live.text)) && <Answer text={turn.answer || live!.text} sessions={p.sessions} onOpen={p.onOpenSession} onDocument={p.onDocument} />}
                    {turn.answeredAt !== undefined && (
                      <div data-sources style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', paddingTop: 6, borderTop: '1px solid var(--sidebar-border)', fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
                        <span style={{ fontWeight: 500 }}>{t.chat.sources}</span>
                        {turn.steps.length === 0 ? <span>{t.chat.sourcesNone}</span> : [...new Set(turn.steps.map(s => sourceLabel(s, t)))].map(l => <span key={l}>{l}</span>)}
                        <span>{t.chat.ago(relativeTime(turn.answeredAt, p.now, t))}</span>
                      </div>
                    )}
                    {running?.qid === turn.qid && <div><Button variant="ghost" size="sm" onClick={() => p.onCancel(turn.qid)} style={{ height: 22, padding: '0 6px', gap: 4, fontSize: 11.5, color: 'var(--muted-foreground)' }}><Icon size={10} {...ICONS.stop} />{t.chat.stop}</Button></div>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {turns.length === 0 && (
        <div data-chips style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 16px 10px' }}>
          {t.chat.chips.map(c => <Button key={c} variant="outline" size="sm" disabled={busy || !!p.offline} onClick={() => submit(c)} style={{ height: 28, padding: '0 10px', borderRadius: 999, fontSize: 12 }}>{c}</Button>)}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
        {p.offline && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{p.offline}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input ref={field} data-chat-input type="text" className="ledge-field" aria-label={t.chat.ask} placeholder={t.chat.askPlaceholder} value={text} disabled={busy || !!p.offline}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(text); } else if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }}
            style={{ flex: 1, minWidth: 0, height: 34, boxSizing: 'border-box', padding: '0 10px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 13 }} />
          <Button variant="primary" size="icon" aria-label={t.chat.send} title={t.chat.send} disabled={busy || !!p.offline || !text.trim()} onClick={() => submit(text)} style={{ width: 34, height: 34 }}><Icon {...ICONS.send} /></Button>
        </div>
      </div>
    </div>
  );
}
