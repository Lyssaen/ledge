import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { hideProposal, type ChatStep, type ChatTurn, type Session, type Tool } from '@ledge/protocol';
import { ResidentMascot } from '../bots/ResidentMascot';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { transition } from '../motion';
import { MarkdownLinks } from '../documents/links';
import { useChatCopy, type ChatCopy } from './copy';
import { relativeTime } from './format';
import { inline } from './inline';
import { LaunchGroupCard } from './LaunchGroupCard';
import { LaunchCard } from './LaunchCard';
import { CloseGroupCard } from './CloseGroupCard';
import { RelayCard } from './RelayCard';
import { ProjectCard } from './ProjectCard';
import { TeamCard } from './TeamCard';
import { TaskCard } from './TaskCard';
import { ActionCard, actionRowOf } from './ActionCard';
import { groupSessions } from '@ledge/fleet';
import type { DocumentReference } from '../documents/references';

export const CHAT_HEADER_H = 56;
/** The composer under the thread: its padding, the 34 px field and the top border. */
export const CHAT_COMPOSER_H = 10 + 34 + 10 + 1;
export interface ChatViewProps {
  turns: ChatTurn[]; live: { qid: string; text: string } | null; sessions: Session[]; visible: boolean; enterDelay?: number;
  /** Null when questions may be sent; otherwise why not (offline). */
  offline: string | null;
  onAsk: (text: string) => void; onCancel: (qid: string) => void; onReset: () => void; onBack?: () => void; onClose: () => void; onOpenSession: (id: string) => void;
  /** The sober island has no session list to return to. */
  showBack?: boolean;
  /** Extra controls in the header, before close. The sober island puts its menu here. */
  headerExtra?: ReactNode;
  onDocument?: (ref: DocumentReference, qid?: string) => void;
  turnAvailable?: (qid: string) => boolean;
  /** The chat card being launched (its turn's qid) and the card's actions (spec 2026-10-12 §6). */
  launchingQid?: string | null; onLaunchProposal?: (qid: string, rows?: number[]) => void; onTerminal?: (id: string) => void;
  /** A launch card's model chooser (#58), drawn by the front; left out, the card launches the agent's default. */
  renderModel?: (qid: string, tool: Tool, disabled: boolean) => ReactNode;
  /** The rows of `launchingQid`'s card in flight (#24): the grouped card says « Launching » on those. */
  launchingRows?: readonly number[] | null;
  /** The close card's turn being closed (its qid), the rows in flight, and its action. Not `onClose`, which closes the panel. */
  closingQid?: string | null; closingRows?: readonly number[] | null; onCloseSessions?: (qid: string, rows?: number[]) => void;
  /** The relay card's turn being sent (its qid) and its actions. */
  relayingQid?: string | null; onRelay?: (qid: string) => void; onRelayCancel?: (qid: string) => void;
  /** The project card's « Review the proposal » (lot 11): without it (the island) there is no card, the answer stands alone.
   *  `projectNamed`: the current name of the project an `addTo` designates, or undefined when none exists (then a new project). */
  onProject?: (qid: string) => void; projectNamed?: (name: string) => string | undefined;
  /** The team and task cards (roles spec §3.8): drawn when the front gives their actions and their copy. `teamBusy` is the
   *  turn whose team is being launched, `taskBusy` the task row being given. */
  onLaunchTeam?: (qid: string) => void; onSaveTeam?: (qid: string) => void; onOpenTeam?: (teamId: string) => void;
  onGiveTask?: (qid: string, row: number) => void; teamBusy?: string | null; taskBusy?: { qid: string; row: number } | null;
  /** The generic card (#94): drawn when the front gives `onAct` and its copy. `actingQid` / `actingRows` the turn and rows being
   *  applied (useActionCards); `onIgnoreCards` « Ignore » the turn's cards, `undo` for « Review ». `onDenyAction` the row's
   *  « Deny », once the daemon gives a permission its deny row. */
  onAct?: (qid: string, rows: number[], confirmed: boolean) => void; actingQid?: string | null; actingRows?: readonly number[] | null;
  onIgnoreCards?: (qid: string, undo: boolean) => void; onDenyAction?: (qid: string, row: number) => void;
  /** A launch time as the front words it. */
  clock?: (iso: string) => string;
  /** Desktop: in the flow of its parent column (no absolute positioning, no fade), no Back button; Close stays in the header. */
  docked?: boolean;
  /** Hover or keyboard focus of a `ledge://session/<id>` link in an answer; null when it ends. */
  onAgentHover?: (id: string | null) => void;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  /** Ledge's home view (ledge home spec §2.2): `pinned` stays at the top of the thread while the conversation scrolls under it
   *  (« Le point »), `above` sits over the field (the suggestions), `footnote` under it; `multiline` makes the field a text
   *  area (Enter sends, Shift + Enter breaks the line); `subtitle` replaces the header's second line; `hideHeader` leaves the
   *  header to the front; `onFieldKey` sees the field's keys first (a mention list), true when it took the key. */
  pinned?: ReactNode; above?: ReactNode; footnote?: ReactNode; multiline?: boolean; subtitle?: string; hideHeader?: boolean;
  onFieldKey?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => boolean;
  /** The field's text, when the front holds it (the suggestions and mentions write into it). */
  draft?: string; onDraft?: (text: string) => void;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean; now?: number; contentRef?: Ref<HTMLDivElement>;
}

const stepLabel = (s: ChatStep, t: ChatCopy) => s.kind === 'sessions' ? t.chat.step.sessions : s.kind === 'repo' ? t.chat.step.repo(s.path ?? '') : t.chat.step[s.kind](s.name ?? '');
const sourceLabel = (s: ChatStep, t: ChatCopy) => s.kind === 'sessions' ? t.chat.source.sessions : s.kind === 'repo' ? t.chat.source.repo(s.name ?? s.path ?? '') : t.chat.source[s.kind](s.name ?? '');

/** `**Nova**` for a known bot becomes a `ledge://session/<id>` link that opens its session. */
function linkBots(text: string, sessions: Session[]): string {
  return sessions.reduce((acc, s) => acc.replaceAll(`**${s.name}**`, `[${s.name}](ledge://session/${s.id})`), text);
}

/** Simple Markdown: paragraphs, bullet lists, `###` headings; inline marks through the reply renderer. */
function Answer({ text, sessions, onOpen, onDocument }: { text: string; sessions: Session[]; onOpen: (id: string) => void; onDocument?: (ref: DocumentReference) => void }) {
  const openUrl = useContext(MarkdownLinks);
  const onLink = (url: string) => { if (!url.startsWith('ledge://')) return false; const m = /^ledge:\/\/session\/(.+)$/.exec(url); if (m) onOpen(m[1]!); return true; };
  const blocks = linkBots(text, sessions).split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: '19px', minWidth: 0 }}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every(l => /^[-*] /.test(l))) return <ul key={i} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2), 0, onLink, onDocument, openUrl)}</li>)}</ul>;
        if (/^#{1,3} /.test(b)) return <h3 key={i} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{inline(b.replace(/^#{1,3} /, ''), 0, onLink, onDocument, openUrl)}</h3>;
        return <p key={i} style={{ margin: 0, overflowWrap: 'anywhere' }}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, 0, onLink, onDocument, openUrl)}</span>)}</p>;
      })}
    </div>
  );
}

export function ChatView(p: ChatViewProps) {
  const t = useChatCopy();
  const { turns, live, visible, enterDelay = 120 } = p;
  const running = turns.find(x => x.answeredAt === undefined && x.error === undefined) ?? null;
  const busy = !!running;
  const [own, setOwn] = useState('');
  const text = p.draft ?? own;
  const setText = (v: string) => { if (p.onDraft) p.onDraft(v); else setOwn(v); };
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const setField = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    field.current = el;
    const r = p.inputRef; if (typeof r === 'function') r(el); else if (r) (r as { current: HTMLInputElement | HTMLTextAreaElement | null }).current = el;
  };
  const SESSION_LINK = 'a[href^="ledge://session/"]';
  const agentOf = (target: EventTarget | null) => {
    const a = target instanceof Element ? target.closest(SESSION_LINK) : null;
    return a ? /^ledge:\/\/session\/(.+)$/.exec(a.getAttribute('href') ?? '')?.[1] ?? null : null;
  };
  const lit = useRef<string | null>(null);
  const hover = p.onAgentHover && ((id: string | null) => { if (id === lit.current) return; lit.current = id; p.onAgentHover!(id); });
  useLayoutEffect(() => { const el = thread.current; if (visible && el) el.scrollTop = el.scrollHeight; }, [turns, live?.text]);
  // Between questions the field takes the focus back. Docked (Desktop), only from the page or from inside the chat: a dialog opened
  // meanwhile (the search palette…) keeps it.
  useEffect(() => {
    if (!visible || busy) return;
    const at = document.activeElement;
    if (p.docked && at && at !== document.body && !root.current?.contains(at)) return;
    field.current?.focus({ preventScroll: true });
  }, [visible, busy]);
  // The resident pulses while Ledge reads.
  const [pulse, setPulse] = useState(0);
  useEffect(() => { if (!busy || !visible || p.reducedMotion) return; const id = setInterval(() => setPulse(k => k + 1), 1400); return () => clearInterval(id); }, [busy, visible, p.reducedMotion]);
  const submit = (q: string) => { const v = q.trim(); if (!v || busy || p.offline) return; p.onAsk(v); setText(''); };
  const repos = groupSessions(p.sessions).length;
  const mascot = (size: number, pulsing = false) => <ResidentMascot size={size} theme={p.theme ?? 'dark'} paused={!visible} frozen={p.frozen} reducedMotion={p.reducedMotion} gestureKey={pulsing && busy ? pulse : undefined} gestureKind="pulse" />;
  return (
    <div ref={root} data-layer="chat" data-delay={p.docked ? undefined : enterDelay} inert={p.docked ? undefined : !visible} style={p.docked
      ? { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }
      : { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
      {!p.hideHeader && <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: CHAT_HEADER_H, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)' }}>
        {!p.docked && p.showBack !== false && <Button variant="ghost" size="icon" aria-label={t.chat.back} title={t.chat.back} data-initial-focus onClick={p.onBack}><Icon {...ICONS.chevronLeft} /></Button>}
        {mascot(28, true)}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
          <span data-brand style={{ fontSize: 14, lineHeight: '18px', fontWeight: 650 }}>{t.chat.title}<span style={{ color: 'var(--sidebar-primary)' }}>.</span></span>
          <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.subtitle ?? t.chat.subtitle(p.sessions.length, repos)}</span>
        </div>
        {/* A new conversation forgets the day's turns and Claude session; offered between questions, once there is something to forget. */}
        <Button variant="ghost" size="icon" aria-label={t.chat.reset} title={t.chat.reset} disabled={busy || !!p.offline || turns.length === 0} onClick={p.onReset}><Icon {...ICONS.plus} /></Button>
        {p.headerExtra}
        <Button variant="ghost" size="icon" aria-label={t.chat.close} title={t.chat.close} onClick={p.onClose}><Icon {...ICONS.close} /></Button>
      </div>}
      <div ref={thread} data-scroll className="ledge-scroll"
        onMouseOver={hover ? e => hover(agentOf(e.target)) : undefined}
        onMouseLeave={hover ? () => hover(null) : undefined}
        onFocus={hover ? e => { const id = agentOf(e.target); if (id) hover(id); } : undefined}
        onBlur={hover ? e => { if (!agentOf(e.relatedTarget)) hover(null); } : undefined} style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {p.pinned && <div data-chat-pinned style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--sidebar)', borderBottom: '1px solid var(--sidebar-border)' }}>{p.pinned}</div>}
        <div ref={p.contentRef} data-chat-content style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px 10px' }}>
          {turns.length === 0 && (
            <div data-chat-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, padding: '26px 4px 6px', color: 'var(--muted-foreground)', fontSize: 12.5, lineHeight: '18px' }}>
              {mascot(56)}
              <strong style={{ color: 'var(--sidebar-foreground)', fontSize: 15, lineHeight: '20px', marginTop: 8 }}>{t.chat.emptyTitle}</strong>
              <span style={{ maxWidth: 340 }}>{t.chat.emptyHint(p.sessions.length)}</span>
              {/* The starters live in the thread so the measured content includes them: the view grows to hold them instead of scrolling. */}
              <div data-chips style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch', marginTop: 24, textAlign: 'left' }}>
                <span style={{ fontSize: 11, lineHeight: '14px', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>{t.chat.starters}</span>
                {t.chat.chips.map(c => (
                  <button key={c} type="button" className="ledge-recent" disabled={busy || !!p.offline} onClick={() => submit(c)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, height: 38, padding: '0 12px', border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', color: 'var(--sidebar-foreground)', fontSize: 13, lineHeight: '18px', textAlign: 'left', cursor: 'pointer', transition: transition([['background-color', 'hover']]) }}>
                    <span style={{ flexGrow: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c}</span>
                    <span style={{ display: 'flex', color: 'var(--muted-foreground)' }}><Icon size={14} {...ICONS.chevronRight} /></span>
                  </button>
                ))}
              </div>
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
                    {(() => {
                      // While it streams, a proposal block (closed or not) is held back: the card shows it once the turn is done.
                      const text = turn.answer || (turn.answeredAt === undefined && live?.qid === turn.qid ? hideProposal(live.text) : '');
                      return text && <Answer text={text} sessions={p.sessions.filter(s => !turn.machineId || s.machineId === turn.machineId)} onOpen={p.onOpenSession} onDocument={p.onDocument ? ref => p.onDocument!(ref, turn.qid) : undefined} />;
                    })()}
                    {!!turn.choices?.length && turn === turns.at(-1) && <><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{turn.choices.map(c => <Button key={c.id} variant="outline" size="sm" disabled={busy || !!p.offline} onClick={() => submit(t.machines.choose(c.label))} style={{ height: 30, padding: '0 10px', fontSize: 12 }}>{c.label}</Button>)}</div><small style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{t.machines.clarification}</small></>}
                    {turn.machineName && (turn.proposal || turn.relay || turn.closes || (turn.projectProposal && p.onProject)) && <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{t.machines.destination} : <strong style={{ color: 'var(--sidebar-foreground)' }}>{turn.machineId === 'local' ? t.machines.local : turn.machineName}</strong>{p.turnAvailable?.(turn.qid) === false && ` · ${t.machines.offline}`}</div>}
                    {turn.answeredAt !== undefined && turn.closes ? (
                      <CloseGroupCard closes={turn.closes} sessions={p.sessions} busy={p.closingQid === turn.qid} busyRows={p.closingQid === turn.qid ? p.closingRows ?? [] : []}
                        disabled={!!p.offline || p.turnAvailable?.(turn.qid) === false || (!!p.closingQid && p.closingQid !== turn.qid) || !!p.launchingQid || !!p.relayingQid}
                        onClose={rows => p.onCloseSessions?.(turn.qid, rows)} onOpenSession={p.onOpenSession} />
                    ) : turn.answeredAt !== undefined && turn.relay ? (
                      <RelayCard relay={turn.relay} session={p.sessions.find(s => s.id === turn.relay!.id)} busy={p.relayingQid === turn.qid}
                        disabled={!!p.offline || p.turnAvailable?.(turn.qid) === false || (!!p.relayingQid && p.relayingQid !== turn.qid) || !!p.launchingQid || !!p.closingQid} theme={p.theme ?? 'dark'} reducedMotion={p.reducedMotion}
                        onSend={() => p.onRelay?.(turn.qid)} onCancel={() => p.onRelayCancel?.(turn.qid)} onOpenSession={p.onOpenSession} />
                    ) : turn.answeredAt !== undefined && (turn.proposals?.length ?? 0) > 1 ? (
                      <LaunchGroupCard proposals={turn.proposals!} sessions={p.sessions} busy={p.launchingQid === turn.qid} busyRows={p.launchingQid === turn.qid ? p.launchingRows ?? [] : []}
                        disabled={!!p.offline || p.turnAvailable?.(turn.qid) === false || (!!p.launchingQid && p.launchingQid !== turn.qid) || !!p.relayingQid || !!p.closingQid}
                        model={turn.proposals!.some(x => x.launchedId === undefined) ? p.renderModel?.(turn.qid, turn.proposals![0]!.tool, p.launchingQid === turn.qid) : undefined}
                        onLaunch={rows => p.onLaunchProposal?.(turn.qid, rows)} onOpenSession={p.onOpenSession} onTerminal={id => p.onTerminal?.(id)} />
                    ) : turn.answeredAt !== undefined && turn.proposal && (
                      <LaunchCard proposal={turn.proposal} session={p.sessions.find(s => s.id === turn.proposal!.launchedId)} busy={p.launchingQid === turn.qid}
                        disabled={!!p.offline || p.turnAvailable?.(turn.qid) === false || (!!p.launchingQid && p.launchingQid !== turn.qid) || !!p.relayingQid || !!p.closingQid}
                        model={turn.proposal.launchedId === undefined ? p.renderModel?.(turn.qid, turn.proposal.tool, p.launchingQid === turn.qid) : undefined}
                        onLaunch={() => p.onLaunchProposal?.(turn.qid)} onOpenSession={p.onOpenSession} onTerminal={id => p.onTerminal?.(id)} />
                    )}
                    {turn.answeredAt !== undefined && turn.team && p.onLaunchTeam && t.chat.team && (
                      <TeamCard team={turn.team} busy={p.teamBusy === turn.qid} disabled={!!p.offline || p.turnAvailable?.(turn.qid) === false || (!!p.teamBusy && p.teamBusy !== turn.qid)}
                        onLaunch={() => p.onLaunchTeam!(turn.qid)} onSave={p.onSaveTeam && (() => p.onSaveTeam!(turn.qid))} onOpenTable={p.onOpenTeam} at={p.clock} />
                    )}
                    {turn.answeredAt !== undefined && turn.tasks && p.onGiveTask && t.chat.task && (
                      <TaskCard tasks={turn.tasks} busyRow={p.taskBusy?.qid === turn.qid ? p.taskBusy.row : null} waitingTeam={!!turn.team && !turn.team.teamId}
                        disabled={!!p.offline || p.turnAvailable?.(turn.qid) === false || (!!p.taskBusy && p.taskBusy.qid !== turn.qid)} onGive={row => p.onGiveTask!(turn.qid, row)} />
                    )}
                    {turn.answeredAt !== undefined && turn.actions && p.onAct && t.chat.action && (
                      <ActionCard rows={turn.actions.map((a, i) => (p.actingQid === turn.qid && p.actingRows?.includes(i) && !a.state ? { ...actionRowOf(a), state: 'running' as const } : actionRowOf(a)))}
                        ignoredAt={turn.ignoredAt} narrow={!p.docked} disabled={!!p.offline || p.turnAvailable?.(turn.qid) === false || !!p.actingQid}
                        onApply={(rows, o) => p.onAct!(turn.qid, rows, o.confirmed)} onDeny={row => p.onDenyAction?.(turn.qid, row)}
                        onIgnore={() => p.onIgnoreCards?.(turn.qid, false)} onReview={() => p.onIgnoreCards?.(turn.qid, true)}
                        onOpen={row => { const a = turn.actions![row]; if (a?.session) p.onOpenSession(a.session); else if (a?.team) p.onOpenTeam?.(a.team); }} />
                    )}
                    {turn.answeredAt !== undefined && turn.projectProposal && p.onProject && (
                      <ProjectCard proposal={turn.projectProposal} target={turn.projectProposal.addTo === undefined ? undefined : p.projectNamed?.(turn.projectProposal.addTo)} onReview={() => p.onProject!(turn.qid)} />
                    )}
                    {turn.answeredAt !== undefined && (
                      <div data-sources style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', paddingTop: 6, borderTop: '1px solid var(--sidebar-border)', fontSize: 11, lineHeight: '16px', color: 'var(--muted-foreground)' }}>
                        <span style={{ fontWeight: 500 }}>{t.chat.sources}</span>
                        {turn.steps.length === 0 ? <span>{t.chat.sourcesNone}</span> : [...new Set(turn.steps.map(s => sourceLabel(s, t)))].map(l => <span key={l}>{l}</span>)}
                        <span>{t.chat.ago(relativeTime(turn.answeredAt, p.now ?? Date.now(), t.time))}</span>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
        {p.above}
        {p.offline && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{p.offline}</span>}
        <div style={{ display: 'flex', alignItems: p.multiline ? 'flex-end' : 'center', gap: 8 }}>
          {p.multiline ? (
            <textarea ref={setField} data-chat-input className="ledge-field" aria-label={t.chat.ask} placeholder={t.chat.askPlaceholder} value={text} disabled={busy || !!p.offline} rows={Math.min(6, Math.max(2, text.split('\n').length))}
              onChange={e => setText(e.target.value)} onKeyDown={e => {
                if (p.onFieldKey?.(e)) return;
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(text); } else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); }
              }}
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '8px 10px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 13, lineHeight: '19px', resize: 'none', fontFamily: 'inherit' }} />
          ) : (
          <input ref={setField} data-chat-input type="text" className="ledge-field" aria-label={t.chat.ask} placeholder={t.chat.askPlaceholder} value={text} disabled={busy || !!p.offline}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (p.onFieldKey?.(e)) return; if (e.key === 'Enter') { e.preventDefault(); submit(text); } else if (e.key === 'Escape') { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }}
            style={{ flex: 1, minWidth: 0, height: 34, boxSizing: 'border-box', padding: '0 10px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 13 }} />
          )}
          <Button variant="primary" size="icon" aria-label={t.chat.send} title={t.chat.send} disabled={busy || !!p.offline || !text.trim()} onClick={() => submit(text)} style={{ width: 34, height: 34 }}><Icon {...ICONS.send} /></Button>
        </div>
        {p.footnote}
      </div>
    </div>
  );
}
