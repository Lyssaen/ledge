import { useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { Helper, Pending, Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, liveHelpers, poseFor, type BotState } from '../bots/poseFor';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { Icon, ICONS } from '../ui/icons';
import { relativeTime, toolName } from '../format';
import { transition } from '../motion';
import { useI18n, type Messages } from '../i18n/lang';
import { canDismiss } from './SessionList';
import { parseReply } from '../reply/parse';
import { BranchChip } from '../ui/BranchChip';
import { ReplyCard, inline } from './ReplyCard';
import type { DocumentReference } from '../documents/references';

const mono = "'Geist Mono', ui-monospace, monospace";
const well: React.CSSProperties = { fontFamily: mono, fontSize: 13, lineHeight: '20px', padding: '10px 12px', background: 'var(--sidebar)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const rule = '1px solid var(--sidebar-border)';
/** Fixed parts of the view: its header and the reply area under the content. */
export const SESSION_HEADER_H = 60;

/** The last reply is shown when nothing is asked and the agent waits (or ended) on it: "your turn". */
export const shownReply = (s: Session) => (!s.pending && (s.state === 'idle' || s.state === 'exited') ? s.lastReply : undefined);

/** A first estimate of the view's height, before (or without) a measurement of its content. */
export function measureSessionH(s: Session, reading: boolean): number {
  const ask = !s.pending ? 0 : s.pending.kind === 'question' ? 140 + (s.pending.options?.length ?? 0) * 56 : 260;
  const reply = shownReply(s) ? Math.min(560, 160 + shownReply(s)!.text.length / 3) : 0;
  return SESSION_HEADER_H + 90 + ask + reply + (reading ? 400 : 240) + 96;
}
/** The cap the request block grows to (its content is always shorter): only the fold animation uses it. */
export const askMaxH = (p: Pending) => (p.kind === 'question' ? 160 + (p.options?.length ?? 0) * 72 : 360);

function QuestionCard({ pending, onReply, disabled, t }: { pending: Pending; onReply: (t: string) => void; disabled: boolean; t: Messages }) {
  const [choice, setChoice] = useState(0);
  const opts = pending.options ?? [];
  const card: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, boxSizing: 'border-box', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', backgroundColor: 'transparent', cursor: 'pointer', transition: transition([['border-color', 'hover'], ['background-color', 'hover']]) };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <fieldset disabled={disabled} style={{ margin: 0, padding: 0, border: 'none', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t.session.options}</legend>
        {opts.map((o, i) => (
          <label key={o} className="ledge-opt" data-checked={choice === i || undefined} style={card}>
            <input type="radio" name="opt" checked={choice === i} onChange={() => setChoice(i)} style={{ margin: 0, width: 16, height: 16, flexShrink: 0 }} />
            <span style={{ fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>{o}</span>
          </label>
        ))}
        {/* The daemon cannot type a free-text answer into the select dialog yet: the field stays visible but off. */}
        <input type="radio" name="opt" data-other aria-label={t.session.other} disabled aria-describedby="ledge-other-why" style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
        <input type="text" className="ledge-field" placeholder={t.session.otherPlaceholder} disabled aria-label={t.session.otherAnswer} aria-describedby="ledge-other-why"
          style={{ height: 40, boxSizing: 'border-box', padding: '0 12px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 14, cursor: 'not-allowed' }} />
        <span id="ledge-other-why" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.session.otherWhy}</span>
      </fieldset>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}><Button variant="primary" disabled={disabled} onClick={() => onReply(String(choice + 1))}>{t.session.send}</Button></div>
    </div>
  );
}

const HELPER_STATE: Record<Helper['state'], BotState> = { starting: 'starting', working: 'working', waiting_input: 'question', waiting_permission: 'approval', idle: 'idle', exited: 'done', error: 'error' };

/** Spec board 17: the live helpers under their bot, 20 px each, in a tree whose last branch ends in └. */
function HelpersTree({ parent, helpers, t, theme, paused, frozen, reducedMotion }: { parent: Session; helpers: Helper[]; t: Messages; theme: 'dark' | 'light'; paused: boolean; frozen?: boolean; reducedMotion?: boolean }) {
  return (
    <ul data-helpers aria-label={t.session.helpers} style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {helpers.map((h, i) => {
        const st = HELPER_STATE[h.state]; const seed = `${parent.id}:${h.id}`; const last = i === helpers.length - 1;
        return (
          <li key={h.id} data-helper data-last={last ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12, lineHeight: '16px' }}>
            <span aria-hidden="true" className="mono" style={{ width: 14, flexShrink: 0, color: 'var(--muted-foreground)' }}>{last ? '└' : '├'}</span>
            <Bot seed={seed} tool={parent.tool} state={st} pose={poseFor(seed, st)} size={20} theme={theme} paused={paused} frozen={frozen} reducedMotion={reducedMotion} />
            <span data-helper-task style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--sidebar-foreground)' }}>{h.task}</span>
            <span style={{ flexShrink: 0, color: 'var(--muted-foreground)' }}>{h.kind} · {t.botLabel[st]}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface SessionViewProps {
  session: Session; preview: string[]; visible: boolean; reading: boolean; draft: string;
  /** When the layer's fade-in starts, in ms (see `enterDelay` in motion). */
  enterDelay?: number;
  onDraft: (t: string) => void; onBack: () => void; onClose: () => void; onDecide: (d: 'accept' | 'deny') => void; onReply: (t: string) => void;
  onInterrupt: () => void; onKill: () => void; onFocus: () => void; onToggleReading: () => void; onRename?: (topic: string) => void;
  onDocument?: (ref: DocumentReference) => void;
  /** Removes a finished or read-only session from the list (shown only for those); `dismissOff` while offline. */
  onDismiss?: () => void; dismissOff?: boolean;
  /** Null when commands may be sent; otherwise why every send/decision path is disabled (offline, read-only). */
  blocked?: string | null;
  /** A decision for this request is in flight: its actions stay locked until the daemon answers. */
  deciding?: boolean;
  /** Why the last decision for this session failed (a daemon `error` reply, a dropped connection). */
  failure?: string;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean; now?: number;
  /** The view's natural content (scroll area) and reply area, measured by the surface to size itself. */
  contentRef?: Ref<HTMLDivElement>; replyRef?: Ref<HTMLDivElement>;
}

export function SessionView(p: SessionViewProps) {
  const { t } = useI18n();
  const { session: s, visible, enterDelay = 120 } = p;
  const blocked = p.blocked ?? null;
  const readOnly = s.source === 'hook_only';
  const decideOff = blocked !== null || !!p.deciding;
  const pending = s.pending;
  // Keep the last request around so the card's content stays put while it folds away.
  const [last, setLast] = useState<Pending | undefined>(pending);
  if (pending && pending !== last) setLast(pending);
  const shown = pending ?? last;
  const isQ = shown?.kind === 'question';
  const st = botState(s);
  const helpers = liveHelpers(s);
  // The daemon rests the main thread between turns while a background helper still works: the view reads as in progress.
  const busy = s.state === 'working' || (s.state === 'idle' && helpers.length > 0);
  // The preview follows its latest line, like a terminal: on open, and on each update unless the user scrolled up to read.
  const termRef = useRef<HTMLPreElement>(null);
  const stuck = useRef(true);
  const termFor = useRef(s.id);
  if (termFor.current !== s.id) { termFor.current = s.id; stuck.current = true; }
  const toBottom = () => { const el = termRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useLayoutEffect(() => { if (stuck.current) toBottom(); }, [p.preview, visible, p.reading]);
  // A permission, diff or plan prompt takes Approve/Deny only: the daemon would refuse a typed reply.
  const promptOnly = !!pending && pending.kind !== 'question';
  const replyOff = blocked !== null || promptOnly;
  const sendDraft = () => { if (!replyOff && p.draft.trim()) p.onReply(p.draft); };
  // The agent's last message, read like a plan, while it waits for the next instruction.
  const reply = shownReply(s);
  const doc = useMemo(() => (reply ? parseReply(reply.text) : null), [reply?.text]); // eslint-disable-line react-hooks/exhaustive-deps
  const replyField = useRef<HTMLTextAreaElement>(null);
  const questions = doc?.questions.length ?? 0;
  const doneCount = doc ? doc.sections.reduce((n, sec) => n + sec.blocks.reduce((m, b) => m + (b.type === 'list' ? b.items.filter(it => sec.kind === 'done' || it.checked).length : 0), 0), 0) : 0;
  const hint = blocked ?? (promptOnly ? t.session.hintPrompt(pending!.kind)
    : pending?.kind === 'question' ? t.session.hintQuestion
    : questions > 1 ? t.reply.hintAnswerAll : questions === 1 ? t.reply.hintChips
    : t.session.hintFree);
  const eyebrow = pending || (reply && s.state === 'idle' && !busy) ? t.session.eyebrow.ask : busy || s.state === 'starting' ? t.session.eyebrow.working : s.state === 'error' ? t.session.eyebrow.error : t.session.eyebrow.session;
  const badgeState = s.state === 'error' ? 'error' : pending ? (pending.kind === 'question' ? 'question' : 'approval') : st;
  const title = pending
    ? (pending.kind === 'question' ? pending.text : pending.kind === 'diff' ? t.session.title.diff(s.name) : pending.kind === 'plan' ? t.session.title.plan(s.name) : t.session.title.permission(s.name))
    : doc?.title ? doc.title
    : readOnly ? t.session.title.readonly
    : s.state === 'exited' ? t.session.title.exited : s.state === 'error' ? t.session.title.error : s.state === 'idle' && !busy ? t.session.title.idle : s.state === 'starting' ? t.session.title.starting : t.session.title.working;
  const failureText = (s.state === 'error' || p.failure) && pending ? t.session.failed(p.failure ?? s.lastError ?? t.notTaken) : null;
  return (
    <div data-layer="session" data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: SESSION_HEADER_H, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px 0 6px', borderBottom: rule }}>
        <Button variant="ghost" size="icon" aria-label={t.detail.back} title={t.detail.back} data-initial-focus onClick={p.onBack} style={{ width: 30, flexShrink: 0, color: 'var(--sidebar-foreground)' }}><Icon {...ICONS.chevronLeft} /></Button>
        <Bot seed={s.id} readOnly={readOnly} tool={s.tool} state={st} pose={poseFor(s.id, s.state)} size={32} theme={p.theme ?? 'dark'} paused={!visible} frozen={p.frozen} reducedMotion={p.reducedMotion} askKey={pending?.text} />
        <TopicLine session={s} t={t} now={p.now} onRename={p.onRename} />
        <Button variant="ghost" size="icon" aria-label={t.session.reading} title={t.session.reading} aria-pressed={p.reading} onClick={p.onToggleReading} style={{ width: 32, height: 32, flexShrink: 0, color: p.reading ? 'var(--sidebar-primary)' : 'var(--sidebar-foreground)' }}><Icon {...ICONS.expand} /></Button>
        <Button variant="ghost" size="icon" aria-label={t.session.focusTerminal} title={t.session.focusTerminal} onClick={p.onFocus} style={{ width: 32, height: 32, flexShrink: 0, color: 'var(--sidebar-foreground)' }}><Icon {...ICONS.external} /></Button>
        {p.onDismiss && canDismiss(s) && <Button variant="ghost" size="icon" data-dismiss aria-label={t.list.dismiss} title={t.list.dismiss} disabled={!!p.dismissOff} onClick={p.onDismiss} style={{ width: 32, height: 32, flexShrink: 0, color: 'var(--sidebar-foreground)' }}><Icon {...ICONS.listRemove} /></Button>}
        <Button variant="ghost" size="icon" aria-label={t.session.close} title={t.session.close} onClick={p.onClose} style={{ width: 32, height: 32, flexShrink: 0, color: 'var(--sidebar-foreground)' }}><Icon {...ICONS.close} /></Button>
      </div>

      <div data-scroll className="ledge-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div ref={p.contentRef} data-session-content style={{ display: 'flex', flexDirection: 'column', padding: '18px 16px 16px', fontSize: p.reading ? 14 : undefined, lineHeight: p.reading ? '21px' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
            <span data-eyebrow style={{ fontSize: 11, lineHeight: '16px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}>{eyebrow}</span>
            {readOnly ? <Badge state="readonly" tone={badgeState} caps /> : <Badge state={badgeState} caps />}
          </div>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: '26px', fontWeight: 650, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{title}</h2>
          {helpers.length > 0 && <HelpersTree parent={s} helpers={helpers} t={t} theme={p.theme ?? 'dark'} paused={!visible} frozen={p.frozen} reducedMotion={p.reducedMotion} />}
          {reply && doc && <>
            <span data-reply-meta style={{ marginTop: 6, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
              {[t.reply.finished(s.name, relativeTime(reply.at, p.now, t)), doneCount ? t.reply.doneCount(doneCount) : null, questions ? t.reply.questionCount(questions) : null].filter(Boolean).join(' · ')}
            </span>
            {doc.lead && <p data-reply-lead style={{ margin: '10px 0 0', fontSize: 14, lineHeight: '21px', color: 'var(--sidebar-foreground)', overflowWrap: 'anywhere' }}>{inline(doc.lead, 0, undefined, p.onDocument)}</p>}
            <div style={{ marginTop: 14 }}>
              <ReplyCard key={reply.at} doc={doc} raw={reply.text} t={t} onDraft={p.onDraft} onFocusReply={() => replyField.current?.focus()} onDocument={p.onDocument} />
            </div>
          </>}
          {readOnly && <>
            {!pending && <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '22px', color: 'var(--muted-foreground)' }}>{t.session.readonlyLead(s.name)}</p>}
            <div data-readonly-note style={{ marginTop: 14, padding: '12px 14px', background: 'var(--well)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', fontSize: 13, lineHeight: '21px', color: 'var(--muted-foreground)' }}>
              {t.session.readonlyNote}<br /><br />{t.session.readonlyNext}<br /><code style={{ fontFamily: mono, color: 'var(--sidebar-foreground)' }}>ledge {s.tool}</code>
            </div>
          </>}
          {failureText && <span role="status" style={{ marginTop: 10, fontSize: 12, lineHeight: '16px', color: 'var(--danger-text)' }}>{failureText}</span>}

          <div data-ask inert={!pending} style={{ flexShrink: 0, maxHeight: pending ? `${askMaxH(pending)}px` : '0px', opacity: pending ? 1 : 0, overflow: 'hidden', transition: pending ? transition([['max-height', 'grow'], ['opacity', 'fadeIn', 0]]) : transition([['max-height', 'cardExit'], ['opacity', 'cardExit']]) }}>
            {shown && (isQ ? <div style={{ paddingTop: 14 }}><QuestionCard key={shown.text} pending={shown} onReply={p.onReply} disabled={decideOff} t={t} /></div> : (
              <div style={{ paddingTop: 14 }}>
                <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
                  <h3 style={{ margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 650, overflowWrap: 'anywhere' }}>{shown.kind === 'permission' ? t.session.runIn(s.project) : t.session.reviewIn(s.project)}</h3>
                  <div style={well}>{shown.text}</div>
                  {shown.kind === 'permission'
                    ? <label className="ledge-check" title={t.session.alwaysWhy} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: '18px', color: 'var(--muted-foreground)', cursor: 'not-allowed', opacity: 0.7 }}>
                        <input type="checkbox" disabled aria-describedby="ledge-always-why" style={{ margin: 0, width: 15, height: 15 }} />{t.session.always}
                      </label>
                    : <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{t.session.reviewHint}</span>}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <Button variant="outline" disabled={decideOff} onClick={() => p.onDecide('deny')}>{t.session.deny}</Button>
                    <Button variant="primary" disabled={decideOff} onClick={() => p.onDecide('accept')} aria-keyshortcuts="Y">{t.session.allow}<span aria-hidden="true" style={{ display: 'inline-flex' }}><Kbd accent>Y</Kbd></span></Button>
                  </div>
                </section>
                {shown.kind === 'permission' && <p id="ledge-always-why" style={{ margin: '10px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)' }}>{t.session.scope}</p>}
              </div>
            ))}
          </div>

          {p.preview.length > 0 && <details className="ledge-terminal" open={(!pending && !reply) || p.reading} onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) { stuck.current = true; toBottom(); } }} style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <summary style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--well)', fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
              <span data-caret aria-hidden="true" style={{ display: 'inline-flex', transition: transition([['transform', 'hover']]) }}><Icon size={12} {...ICONS.chevronRight} /></span>
              <span style={{ color: 'var(--sidebar-foreground)' }}>{t.session.terminal}</span><span>· {t.session.terminalNote}</span>
            </summary>
            <pre ref={termRef} data-terminal onScroll={e => { const el = e.currentTarget; stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4; }} className="mono ledge-scroll" style={{ margin: 0, padding: '10px 12px', maxHeight: p.reading ? 360 : 200, overflow: 'auto', fontSize: 12, lineHeight: '18px', color: 'var(--muted-foreground)', background: 'var(--well)', borderTop: '1px solid var(--border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{p.preview.map((l, i) => <div key={i}>{l || ' '}</div>)}</pre>
          </details>}
        </div>
      </div>

      {/* A session started without Ledge cannot be written to: the mockup drops the reply area, the note above says why. */}
      {!readOnly && (
        <div ref={p.replyRef} data-reply-area style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 14px 10px', flexShrink: 0, borderTop: rule }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <textarea ref={replyField} data-reply rows={1} className="ledge-field" placeholder={t.session.replyPlaceholder(s.name)} aria-label={t.session.replyLabel(s.name)} aria-describedby="ledge-reply-hint" value={p.draft}
              onChange={e => p.onDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDraft(); } }}
              style={{ flexGrow: 1, minWidth: 0, minHeight: 36, maxHeight: 120, boxSizing: 'border-box', padding: '8px 2px', resize: 'none', fieldSizing: 'content', background: 'transparent', color: 'inherit', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 14, lineHeight: '20px' } as React.CSSProperties} />
            <Button variant="primary" size="icon" aria-label={t.session.sendReply} title={t.session.sendReply} disabled={replyOff || !p.draft.trim()} onClick={sendDraft} style={{ width: 32, height: 32, flexShrink: 0, marginBottom: 2 }}><Icon {...ICONS.send} /></Button>
          </div>
          {/* A failure outside a request (a rejected reply to an idle session, say): the request card shows its own. */}
          {p.failure && !pending && <span role="status" style={{ fontSize: 12, lineHeight: '16px', color: 'var(--danger-text)' }}>{p.failure}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
            <span id="ledge-reply-hint" style={{ flexGrow: 1, minWidth: 0 }}>{hint}</span>
            {s.state === 'working' && <Button variant="outline" size="sm" disabled={blocked !== null} onClick={p.onInterrupt} style={{ height: 26, padding: '0 8px', fontSize: 12, whiteSpace: 'nowrap' }}><Icon {...ICONS.stop} size={12} />{t.session.interrupt}</Button>}
            <Button variant="ghost" size="sm" disabled={blocked !== null} onClick={p.onKill} style={{ height: 26, padding: '0 6px', fontSize: 12, whiteSpace: 'nowrap', color: 'var(--danger-text)' }}>{t.session.kill}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The header's first line is the topic (the user may rename it in place), the second the name, branch, tool and age. */
function TopicLine({ session: s, t, now, onRename }: { session: Session; t: Messages; now?: number; onRename?: (topic: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const shown = s.topic ?? `${s.name} · ${s.project}`;
  const commit = () => { if (editing !== null && editing.trim() !== (s.topic ?? '')) onRename?.(editing.trim()); setEditing(null); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, paddingLeft: 4 }}>
      {editing === null
        ? <button type="button" data-topic disabled={!onRename} title={onRename ? t.session.rename : undefined} onClick={() => setEditing(s.topic ?? '')}
            // Explicit resets, not `all: unset`, so the global :focus-visible ring still shows for keyboard users.
            style={{ border: 0, background: 'transparent', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'left', display: 'block', width: '100%', boxSizing: 'border-box', cursor: onRename ? 'text' : 'default', fontSize: 14, lineHeight: '18px', fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(s.topic ? {} : { color: 'var(--muted-foreground)' }) }}>{shown}</button>
        : <input autoFocus data-topic-input aria-label={t.session.rename} className="ledge-field" maxLength={500} value={editing} placeholder={t.session.topicPlaceholder} onChange={e => setEditing(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}
            style={{ height: 22, boxSizing: 'border-box', padding: '0 6px', fontSize: 14, fontWeight: 650, background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-sm)' }} />}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
        <span>{s.name}</span>
        {s.branch && <><span aria-hidden="true">·</span><BranchChip session={s} /></>}
        <span aria-hidden="true">·</span><span>{toolName(s.tool)}</span>
        <span aria-hidden="true">·</span><span>{relativeTime(s.startedAt, now, t)}</span>
      </span>
    </div>
  );
}
