import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { answerEscalation, revisitDecision, sayToLedge, setBrain, useAnswerState, useBrainStatus, useDaemon, useEscalations, useLedgeDecisionList, useLedgeDecisions, useLedgeRules, useLedgeThread, useOpenRig, useRigs, type DaemonClient } from '@ledge/fleet';
import { hideProposal, type ChatRigLaunch, type Escalation, type Projects } from '@ledge/protocol';
import { ChatAnswer, TurnCards } from '@ledge/ui/chat/ChatView';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import { useActionCards } from '@ledge/ui/chat/useActionCards';
import { LedgeThreadCopyProvider } from '@ledge/ui/chat/ledge/copy';
import { DecidedLine } from '@ledge/ui/chat/ledge/DecidedLine';
import { EscalationCard } from '@ledge/ui/chat/ledge/EscalationCard';
import { ExchangeGroup } from '@ledge/ui/chat/ledge/ExchangeGroup';
import { BrainStopped, isBrainStopped, LedgeBubble, UserBubble } from '@ledge/ui/chat/ledge/ThreadBubbles';
import { localDay, threadRows } from '@ledge/ui/chat/ledge/threadModel';
import { isStandalone, seatMentions } from '@ledge/ui/rigs/model';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { FleetView } from '../fleet/useFleet';
import type { Decisions } from '../fleet/decisions';
import { LedgeRail } from './LedgeRail';
import { BrainOffer } from './BrainOffer';
import { chatCopy, ledgeThreadCopy, useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { cls } from '../shell/cls';
import { rigLaunchModal, type NavAction } from '../nav/state';
import { visibleRigs } from '../rigs/RigsTab';
import { useRigExchanges } from '../rigs/useRigExchanges';
import { useChatCards } from './useChatCards';
import { CardModelPick } from './CardModelPick';
import { useProjectReview } from './projectReview';
import { decisionsToday } from './mandate/model';

export interface LedgeConversationProps {
  client: DaemonClient; view: FleetView; dispatch: (a: NavAction) => void;
  /** Bumped each time the screen is asked for (`/`): the field takes the focus. */
  focus?: number;
  /** The escalation whose card the thread scrolls to (`{type:'ledge', focus}`); spent through `onFocused`. */
  focusCard?: string; onFocused?(): void;
  /** `decisions`: the session permissions (Allow/Deny), not what Ledge settled (those come from the fleet store). */
  waits?: ReadonlyMap<string, { since: string }>; decisions?: Decisions;
  projects?: Projects | null; paused?: boolean;
  onLaunched?(id: string): void; onTerminal?(id: string): void; notify?(text: string): void; onProposal?(pid: string): void;
}

/** The word being typed when it starts with `@` (a seat, then a session): what the mention list completes. `#` is gone. */
export function mentionAt(text: string): { sigil: '@'; query: string; start: number } | null {
  const m = /(^|\s)(@)([^\s@]*)$/.exec(text);
  return m ? { sigil: '@', query: m[3]!.toLowerCase(), start: m.index + m[1]!.length } : null;
}

/** Stuck to the bottom while the user is within this many pixels of it. */
const STICK_PX = 48;
const MENTIONS_MAX = 8;
/** The rail sits beside the thread from this width of the conversation. */
const RAIL_MIN_PX = 1100;
const noop = () => {};

/** A decision in message: its card answers through the daemon (`escalation.answer`), its state follows the latest attempt. */
function EscalationRow({ client, escalation, onTalk }: { client: DaemonClient; escalation: Escalation; onTalk(e: Escalation): void }) {
  const answer = useAnswerState(escalation.id);
  return <EscalationCard key={escalation.id} escalation={escalation} answer={answer}
    onAnswer={answers => { answerEscalation(client, escalation.id, answers); }} onTalk={() => onTalk(escalation)} />;
}

/**
 * The Conversation tab of the Ledge screen (spec §8, `c-A.png`): Ledge's thread from top to bottom (the user on the right, Ledge on the
 * left with its mascot and, under a bubble, the cards of its turn; a decision in message; the exchanges between agents; what Ledge
 * settled), « Voir plus ancien » on top, kept scrolled to the bottom. Under it the composer: suggestions, `@` for a seat then a session,
 * and the footnote. Everything goes through `ledge.say` (never `chat.ask`); « En parler » prefills the field and the next send carries
 * the escalation (`about`). The rail beside the thread is an empty slot until task 10.
 */
export function LedgeConversation(p: LedgeConversationProps): JSX.Element {
  const { client, view, dispatch } = p;
  const { t } = useI18n();
  const chatC = useMemo(() => chatCopy(t), [t]);
  const threadC = useMemo(() => ledgeThreadCopy(t), [t]);
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { chat, chatLive } = useDaemon();
  const { items, hasOlder, loadOlder } = useLedgeThread(client);
  const allRigs = useRigs(client);
  const openrig = useOpenRig(client);
  const rigs = useMemo(() => visibleRigs(allRigs, openrig), [allRigs, openrig]);
  const escalations = useEscalations(client);
  const offline = view.machines.find(m => m.id === 'local')?.ready ? null : chatC.offline;

  // The thread's rows: escalations of this daemon by id, exchanges asked once per rig the thread names.
  const escById = useMemo(() => new Map(escalations.filter(e => e.machine === 'local').map(e => [e.id, e])), [escalations]);
  const named = useMemo(() => {
    const seen = new Map<string, { machine: string; id: string }>();
    for (const i of items) if (i.kind === 'exchanges') seen.set(`${i.machine}/${i.rigId}`, { machine: i.machine, id: i.rigId });
    return [...seen.values()];
  }, [items]);
  const exchanges = useRigExchanges(client, named);
  const today = localDay(new Date().toISOString());
  // What Ledge settled (lot 7): the thread's `decided` lines, their rule's day, and the rail's « Tranché aujourd'hui ».
  const ledgeDecisions = useLedgeDecisions();
  const decisionList = useLedgeDecisionList();
  const rules = useLedgeRules();
  const rulesById = useMemo(() => new Map(rules.map(r => [r.id, r])), [rules]);
  const settled = useMemo(() => decisionsToday(decisionList, today, 'ledge'), [decisionList, today]);
  // « Démarrer » under « Ledge est arrêté »: only while the brain is not running, and held after a click until brain.status changes.
  const brain = useBrainStatus();
  const running = brain?.enabled === true && (brain.state === 'on' || brain.state === 'starting');
  const [startedOn, setStartedOn] = useState<{ status: typeof brain } | null>(null);
  const starting = startedOn !== null && startedOn.status === brain;
  const startBrain = () => { setStartedOn({ status: brain }); setBrain(client, { enabled: true }); };
  const rows = useMemo(() => threadRows(items, { escalations: escById, exchanges: (m, id) => exchanges.get(`${m}/${id}`), chat, decisions: ledgeDecisions, today, days: threadC.days }),
    [items, escById, exchanges, chat, ledgeDecisions, today, threadC]);
  const lastGroup = rows.reduce((at, r, i) => (r.kind === 'exchanges' ? i : at), -1);

  // The turns' cards, as the docked chat draws them.
  const send = useCallback((m: Parameters<DaemonClient['send']>[0]) => client.send(m), [client]);
  const onMessage = useCallback((fn: Parameters<DaemonClient['onMessage']>[0]) => client.onMessage(fn), [client]);
  const turnReady = useCallback((qid: string) => !!view.fleet.turnMachine(qid)?.ready, [view.fleet]);
  const turnMachine = useCallback((qid: string) => view.fleet.turnMachine(qid)?.id, [view.fleet]);
  const cards = useChatCards({ send, chat, lastLaunched: view.lastLaunched, errors: view.errors, sessions: view.sessions, turnReady, turnMachine, onLaunched: p.onLaunched ?? noop });
  const actionCards = useActionCards({ send, chat, errors: view.errors, turnReady, onMessage });
  const project = useProjectReview({ chat, projects: p.projects ?? null, machines: view.machines, notify: p.notify ?? noop, onProposal: p.onProposal ?? noop });
  const open = (id: string) => dispatch({ type: 'open', id });
  // « Lancer ce rig » (the brain's card): the lot-5 launch window, prefilled; it prepares the plan again.
  const launchRig = useCallback((c: ChatRigLaunch) => dispatch({ type: 'modal', modal: rigLaunchModal(c) }), [dispatch]);
  const cardProps = {
    sessions: view.sessions, offline, docked: true, turnAvailable: turnReady, onOpenSession: open, onTerminal: p.onTerminal,
    renderModel: (qid: string, agent: Parameters<typeof CardModelPick>[0]['tool'], b: boolean) => <CardModelPick client={client} machine={turnMachine(qid)} tool={agent} pick={cards.pick(qid)} disabled={b} onPick={next => cards.setPick(qid, next)} />,
    launchingQid: cards.launchingQid, launchingRows: cards.launchingRows, onLaunchProposal: cards.launch,
    closingQid: cards.closingQid, closingRows: cards.closingRows, onCloseSessions: cards.close,
    relayingQid: cards.relayingQid, onRelay: cards.relay, onRelayCancel: cards.cancelRelay,
    onProject: project.review, projectNamed: project.projectNamed, onRigLaunch: launchRig,
    onAct: actionCards.act, actingQid: actionCards.actingQid, actingRows: actionCards.actingRows, onIgnoreCards: actionCards.ignore, onDenyAction: actionCards.deny,
    theme, reducedMotion: p.paused || reduced
  };

  // Kept at the bottom while the user is there; reading older messages leaves the scroll alone.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [rows, chatLive?.text]);

  // « Voir »: the thread scrolls to that escalation's card, once the card is drawn.
  const { focusCard, onFocused } = p;
  useEffect(() => {
    if (!focusCard) return;
    const card = scroller.current?.querySelector<HTMLElement>(`[data-escalation-card="${CSS.escape(focusCard)}"]`);
    if (!card) return;
    stick.current = false;
    card.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    onFocused?.();
  }, [focusCard, rows, reduced, onFocused]);

  // Wide: the rail beside the thread. Narrow: one collapsed line under the header. Unmeasurable (tests): wide.
  const conv = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const el = conv.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; setCompact(w > 0 && w < RAIL_MIN_PX); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The composer.
  const [draft, setDraft] = useState('');
  const [about, setAbout] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [p.focus]);
  const edit = (text: string) => { setDraft(text); if (!text.trim()) setAbout(null); };
  const say = (text: string, withAbout: boolean) => {
    const v = text.trim();
    if (!v || offline) return;
    sayToLedge(client, v, withAbout ? about ?? undefined : undefined);
    stick.current = true;
    if (withAbout) { setDraft(''); setAbout(null); }
  };
  const talk = (e: Escalation) => {
    setDraft(t.home.talkAbout(e.summary || e.questions[0]?.question || ''));
    setAbout(e.id);
    inputRef.current?.focus();
  };

  // `@`: the seats first (as the daemon resolves them), then the standalone sessions.
  const mention = mentionAt(draft);
  const choices = useMemo(() => {
    if (!mention) return [];
    const seats = seatMentions(rigs, mention.query);
    const sessions = view.sessions.filter(s => isStandalone(s, allRigs) && s.name.toLowerCase().startsWith(mention.query))
      .map(s => ({ key: s.id, label: t.home.mentionSession(s.name), insert: `@${s.name}` }));
    return [...seats, ...sessions].slice(0, MENTIONS_MAX);
  }, [mention?.query, rigs, allRigs, view.sessions, t]);
  useEffect(() => setMentionIndex(0), [mention?.query]);
  const insert = (value: string) => { if (!mention) return; setDraft(`${draft.slice(0, mention.start)}${value} `); inputRef.current?.focus(); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (choices.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(choices[mentionIndex]!.insert); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); say(draft, true); }
    else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); }
  };

  const firstRig = useMemo(() => rigs.filter(r => !r.kernel).map(r => r.name).sort((a, b) => a.localeCompare(b))[0], [rigs]);
  const s = t.home.suggest;
  const suggestions = [s.launch, firstRig ? s.whereIs(firstRig) : s.sessions, s.decided, s.needsMe];
  const mascot = <ResidentMascot size={24} theme={theme} paused={p.paused} reducedMotion={p.paused || reduced} />;

  return (
    <ChatCopyProvider value={chatC}>
      <LedgeThreadCopyProvider value={threadC}>
        <div ref={conv} className={cls('home-conv', compact && 'narrow')} role="tabpanel" aria-label={t.home.tabs.conversation}>
          <div className="home-conv-main">
            <div ref={scroller} className="home-thread ledge-scroll" role="log" aria-label={t.home.thread}
              onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX; }}>
              <BrainOffer client={client} view={view} />
              {hasOlder && <button type="button" className="home-older lt-link" onClick={loadOlder}>{t.home.older}</button>}
              {rows.map((row, i) => {
                switch (row.kind) {
                  case 'day': return <div key={`day-${row.day}`} className="home-day" role="separator"><span>{row.label}</span></div>;
                  case 'user': return <UserBubble key={row.item.id} at={row.item.at} text={row.item.text} {...(row.to ? { to: row.to } : {})} />;
                  case 'ledge': {
                    if (isBrainStopped(row.item.text)) {
                      return <LedgeBubble key={row.item.id} at={row.item.at} avatar={mascot}><BrainStopped onStartBrain={offline || running ? undefined : startBrain} starting={starting} /></LedgeBubble>;
                    }
                    const live = row.turn && chatLive?.qid === row.turn.qid ? hideProposal(chatLive.text) : '';
                    const text = row.item.text || live;
                    return (
                      <LedgeBubble key={row.item.id} at={row.item.at} avatar={mascot}>
                        {text ? <ChatAnswer text={text} sessions={view.sessions} onOpen={open} />
                          : row.item.pending ? <span className="home-thinking">{chatC.chat.thinking}</span> : null}
                        {row.turn && <div className="home-turn-cards"><TurnCards {...cardProps} turn={row.turn} /></div>}
                      </LedgeBubble>
                    );
                  }
                  case 'escalation':
                    return row.escalation ? (
                      <LedgeBubble key={row.item.id} at={row.item.at} avatar={mascot}>
                        <div data-escalation-card={row.escalation.id}><EscalationRow client={client} escalation={row.escalation} onTalk={talk} /></div>
                      </LedgeBubble>
                    ) : null;
                  case 'decided':
                    return row.decision ? (
                      <LedgeBubble key={row.item.id} at={row.item.at} avatar={mascot}>
                        <DecidedLine decision={row.decision} to={row.to ?? ''} rule={row.decision.rule ? rulesById.get(row.decision.rule) : undefined}
                          onRevisit={() => revisitDecision(client, row.decision!.id)} />
                      </LedgeBubble>
                    ) : null;
                  case 'exchanges': {
                    const name = allRigs.find(r => r.machine === row.item.machine && r.id === row.item.rigId)?.name ?? row.item.rigId;
                    return <ExchangeGroup key={row.item.id} rigName={name} exchanges={row.exchanges} missing={row.missing} from={row.item.from} to={row.item.to} defaultOpen={i === lastGroup} />;
                  }
                  case 'card':
                    return <LedgeBubble key={row.item.id} at={row.item.at} avatar={mascot}><ChatAnswer text={row.item.action.summary} sessions={view.sessions} onOpen={open} /></LedgeBubble>;
                }
              })}
            </div>
            <div className="home-composer">
              {choices.length > 0 && (
                <div className="home-mentions" role="listbox" aria-label={t.home.mentions}>
                  {choices.map((c, i) => <button key={c.key} type="button" role="option" aria-selected={i === mentionIndex} className={cls(i === mentionIndex && 'sel')} onMouseDown={e => { e.preventDefault(); insert(c.insert); }}>{c.label}</button>)}
                </div>
              )}
              <div className="home-suggestions">
                {suggestions.map(x => (
                  <button key={x} type="button" disabled={!!offline}
                    onClick={() => { if (x.endsWith('…')) { setDraft(`${x.slice(0, -1).trimEnd()} `); inputRef.current?.focus(); } else say(x, false); }}>{x}</button>
                ))}
              </div>
              {offline && <span className="home-offline">{offline}</span>}
              <div className="home-field">
                <textarea ref={inputRef} className="ledge-field" aria-label={chatC.chat.ask} placeholder={t.home.placeholder} value={draft} disabled={!!offline}
                  rows={Math.min(6, Math.max(2, draft.split('\n').length))} onChange={e => edit(e.target.value)} onKeyDown={onKey} />
                <Button variant="primary" size="icon" aria-label={chatC.chat.send} title={chatC.chat.send} disabled={!!offline || !draft.trim()} onClick={() => say(draft, true)}><Icon {...ICONS.send} /></Button>
              </div>
              <small className="home-footnote">{t.home.footer}</small>
            </div>
          </div>
          <LedgeRail client={client} view={view} dispatch={dispatch} waits={p.waits} decisions={p.decisions} paused={p.paused} compact={compact}
            settled={settled} onRevisit={d => revisitDecision(client, d.id)} />
        </div>
      </LedgeThreadCopyProvider>
    </ChatCopyProvider>
  );
}
