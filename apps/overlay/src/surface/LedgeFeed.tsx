import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { answerEscalation, sayToLedge, useAnswerState, useEscalations, useLedgeThread, useRigs, type DaemonClient } from '@ledge/fleet';
import { qualify } from '@ledge/fleet/machines';
import { hideProposal, type Escalation, type Exchange, type LedgeDecision, type Session } from '@ledge/protocol';
import { ChatAnswer, TurnCards, type TurnCardsProps } from '@ledge/ui/chat/ChatView';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import { LedgeThreadCopyProvider } from '@ledge/ui/chat/ledge/copy';
import { EscalationCard } from '@ledge/ui/chat/ledge/EscalationCard';
import { feedLines, hhmm, localDay, pinnedEscalation, seatName, threadRows, type FeedLine } from '@ledge/ui/chat/ledge/threadModel';
import { MarkdownLinks } from '@ledge/ui/documents/links';
import type { DocumentReference } from '@ledge/ui/documents/references';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { useDaemon } from '../daemon/store';
import { chatCopy, ledgeThreadCopy, useI18n } from '../i18n/lang';
import { openUrl } from '../tauri/bridge';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { transition } from '../motion';
import { CHAT_HEADER_H } from './ChatView';

/** Where « Seulement Ledge » is remembered (`'1'` on). */
export const ONLY_LEDGE_KEY = 'ledge.feed.onlyLedge';
const readOnlyLedge = () => { try { return localStorage.getItem(ONLY_LEDGE_KEY) === '1'; } catch { return false; } };
const writeOnlyLedge = (on: boolean) => { try { localStorage.setItem(ONLY_LEDGE_KEY, on ? '1' : '0'); } catch { /* storage refused: the filter holds for this view */ } };
const noSubscribe = () => () => {};
/** The feed's least height (pinned decision, filter and lines together), enough for the island's menu to open over it. */
const FEED_MIN_H = 180;

export interface LedgeFeedProps {
  client: DaemonClient; onClose(): void; onSettings(): void;
  visible?: boolean; enterDelay?: number;
  /** Null when Ledge may be written to; otherwise why not (offline). */
  offline?: string | null;
  sessions?: Session[];
  /** Controls in the header before close; the island puts its menu here (settings then go through it). */
  headerExtra?: ReactNode;
  /** The measured content (pinned decision, filter, lines): the notch sizes itself to it (`useMeasuredHeight`). */
  contentRef?: Ref<HTMLDivElement>;
  inputRef?: Ref<HTMLInputElement>;
  /** The cards under a Ledge bubble (launch, relay, close, action), as the old chat drew them under its answers. */
  cards?: Omit<TurnCardsProps, 'turn'>;
  onOpenSession?(id: string): void;
  /** A document link in an answer (`[x](./README.md)`). */
  onDocument?(ref: DocumentReference): void;
  theme?: 'dark' | 'light'; frozen?: boolean; reducedMotion?: boolean;
  /** What Ledge settled, by id: a `decided` item is a line « Ledge → seat · décision » once its decision is known (the store comes with lot 7). */
  decisions?: ReadonlyMap<string, LedgeDecision>;
}

/** The exchanges of the rigs the thread names: asked once per rig, then read from the fleet at each of its changes. */
function useNamedExchanges(client: DaemonClient, named: readonly { machine: string; id: string }[]): (machine: string, rigId: string) => Exchange[] | null {
  const fleet = client.fleet;
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (!fleet) return;
    for (const r of named) { const k = `${r.machine}/${r.id}`; if (!asked.current.has(k) && fleet.requestExchanges(r.machine, r.id)) asked.current.add(k); }
  }, [fleet, named]);
  const [, bump] = useState(0);
  useEffect(() => (fleet?.subscribe ?? noSubscribe)(() => bump(n => n + 1)), [fleet]);
  return (machine, rigId) => fleet?.exchanges(machine, rigId) ?? null;
}

/** The pinned decision: its card answers through the daemon (`escalation.answer`) and follows the latest attempt. */
function Pinned({ client, escalation, onTalk }: { client: DaemonClient; escalation: Escalation; onTalk(e: Escalation): void }) {
  const answer = useAnswerState(escalation.id);
  return <EscalationCard compact escalation={escalation} answer={answer} onAnswer={answers => { answerEscalation(client, escalation.id, answers); }} onTalk={() => onTalk(escalation)} />;
}

const tones: Record<'user' | 'ledge' | 'plain', CSSProperties> = {
  plain: {},
  user: { background: 'var(--secondary)' },
  ledge: { background: 'color-mix(in srgb, var(--primary) 22%, transparent)' }
};
const strong: CSSProperties = { fontWeight: 600, color: 'var(--sidebar-foreground)' };
const muted: CSSProperties = { color: 'var(--muted-foreground)' };
const red: CSSProperties = { fontWeight: 600, color: 'var(--sidebar-primary)' };

/** A line of the feed: the time in mono, who → whom (and what), then the text. */
function Line({ at, tone, head, children }: { at: string; tone: 'user' | 'ledge' | 'plain'; head: ReactNode; children: ReactNode }) {
  return (
    <div data-feed-line data-tone={tone} style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 10, padding: '8px 10px', borderRadius: 'var(--radius-md)', ...tones[tone] }}>
      <span data-feed-time className="mono" style={{ ...muted, fontSize: 12, lineHeight: '19px' }}>{hhmm(at)}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, lineHeight: '19px', overflowWrap: 'anywhere' }}>{head}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: '19px', overflowWrap: 'anywhere', minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}

/**
 * The open notch (spec §8.5, `nn-open.png`): the header (Ledge, what it orchestrates, the menu, close), the waiting decision
 * pinned on top with its buttons, « Seulement Ledge », then one mixed feed (exchanges between agents, what Ledge settled, the user's
 * messages and Ledge's answers with their cards), and the composer, always there, that writes to Ledge (`ledge.say`).
 */
export function LedgeFeed(p: LedgeFeedProps) {
  const { client, visible = true, enterDelay = 120, offline = null, sessions = [] } = p;
  const { t } = useI18n();
  const chatC = useMemo(() => chatCopy(t), [t]);
  const threadC = useMemo(() => ledgeThreadCopy(t), [t]);
  const { chat, chatLive } = useDaemon();
  const { items } = useLedgeThread(client);
  const rigs = useRigs(client);
  const escalations = useEscalations(client);

  // The rows, resolved as Desktop's Ledge screen does; a client without a fleet (the demo) keeps the daemon's own qids.
  const local = useMemo(() => escalations.filter(e => e.machine === 'local'), [escalations]);
  const escById = useMemo(() => new Map(local.map(e => [e.id, e])), [local]);
  const named = useMemo(() => {
    const seen = new Map<string, { machine: string; id: string }>();
    for (const i of items) if (i.kind === 'exchanges') seen.set(`${i.machine}/${i.rigId}`, { machine: i.machine, id: i.rigId });
    return [...seen.values()];
  }, [items]);
  const exchanges = useNamedExchanges(client, named);
  const today = localDay(new Date().toISOString());
  const [onlyLedge, setOnlyLedge] = useState(readOnlyLedge);
  const rows = threadRows(items, { escalations: escById, exchanges, chat, today, days: threadC.days, ...(p.decisions ? { decisions: p.decisions } : {}) });
  const lines = feedLines(rows, { onlyLedge, rigName: (m, id) => rigs.find(r => r.machine === m && r.id === id)?.name ?? id }).map((l): FeedLine => {
    if (l.kind !== 'ledge' || l.turn || client.fleet) return l;
    const item = items.find(i => i.id === l.id);
    const qid = item?.kind === 'ledge' ? item.qid : undefined;
    const turn = qid ? chat.find(x => x.qid === qid) : undefined;
    return turn ? { ...l, turn } : l;
  });
  // Ledge still reading: its pending bubble, with the streamed text once it comes.
  const pending = items.filter(i => i.kind === 'ledge' && i.pending && !i.text);
  const liveText = (qid: string | undefined) => (qid && chatLive && (chatLive.qid === qid || chatLive.qid === qualify('local', qid)) ? hideProposal(chatLive.text) : '');
  const pinned = pinnedEscalation(local);
  const ownRigs = rigs.filter(r => !r.kernel);
  const agents = ownRigs.reduce((n, r) => n + r.seats.length, 0);
  const repos = new Set(sessions.map(s => s.repoPath ?? s.cwd)).size;

  // The composer: « En parler » prefills it and the next send carries the escalation (`about`).
  const [draft, setDraft] = useState('');
  const [about, setAbout] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  const setField = (el: HTMLInputElement | null) => {
    field.current = el;
    const r = p.inputRef; if (typeof r === 'function') r(el); else if (r) (r as { current: HTMLInputElement | null }).current = el;
  };
  const edit = (text: string) => { setDraft(text); if (!text.trim()) setAbout(null); };
  const say = () => {
    const v = draft.trim();
    if (!v || offline) return;
    sayToLedge(client, v, about ?? undefined);
    setDraft(''); setAbout(null);
  };
  const talk = (e: Escalation) => {
    setDraft(t.feed.talkAbout(e.summary || e.questions[0]?.question || ''));
    setAbout(e.id);
    field.current?.focus();
  };
  const toggle = () => { const next = !onlyLedge; writeOnlyLedge(next); setOnlyLedge(next); };

  // The field takes the focus when the notch opens; the feed stays scrolled to its end.
  useEffect(() => { if (visible) field.current?.focus({ preventScroll: true }); }, [visible]);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = scroller.current; if (visible && el) el.scrollTop = el.scrollHeight; }, [items, chatLive?.text, onlyLedge, visible]);

  const mascot = (size: number) => <ResidentMascot size={size} theme={p.theme ?? 'dark'} paused={!visible} frozen={p.frozen} reducedMotion={p.reducedMotion} />;
  const open = (id: string) => p.onOpenSession?.(id);
  const line = (l: FeedLine) => {
    switch (l.kind) {
      case 'exchange':
        return <Line key={`x-${l.id}`} at={l.at} tone="plain" head={<><span style={strong}>{seatName(l.exchange.from)}</span> → <span style={strong}>{seatName(l.exchange.to)}</span><span style={muted}> · {l.rigName} · {threadC.exchanges.kind[l.exchange.kind]}</span></>}>{l.exchange.text}</Line>;
      case 'user':
        return <Line key={l.id} at={l.at} tone="user" head={<><span style={strong}>{t.feed.you}</span> → <span style={strong}>{l.to ?? t.feed.ledge}</span></>}>{l.text}</Line>;
      case 'decided':
        return <Line key={l.id} at={l.at} tone="ledge" head={<><span style={red}>{t.feed.ledge}</span> → <span style={strong}>{l.to}</span><span style={muted}> · {t.feed.decision}</span></>}>{l.text}</Line>;
      case 'ledge':
        return (
          <Line key={l.id} at={l.at} tone="ledge" head={<><span style={red}>{t.feed.ledge}</span> → <span style={strong}>{t.feed.toYou}</span></>}>
            <ChatAnswer text={l.text} sessions={sessions} onOpen={open} onDocument={p.onDocument} />
            {l.turn && p.cards && <TurnCards {...p.cards} turn={l.turn} />}
          </Line>
        );
    }
  };

  return (
    <ChatCopyProvider value={chatC}>
      <LedgeThreadCopyProvider value={threadC}>
        <MarkdownLinks.Provider value={openUrl}>
          <div data-layer="chat" data-feed data-delay={enterDelay} inert={!visible} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none', transition: transition([['opacity', visible ? 'fadeIn' : 'fadeOut', visible ? enterDelay : 0]]) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: CHAT_HEADER_H, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', borderBottom: '1px solid var(--sidebar-border)' }}>
              {mascot(28)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                <span data-brand style={{ fontSize: 14, lineHeight: '18px', fontWeight: 650 }}>{chatC.chat.title}<span style={{ color: 'var(--sidebar-primary)' }}>.</span></span>
                <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ownRigs.length > 0 ? t.feed.subtitle(ownRigs.length, agents) : chatC.chat.subtitle(sessions.length, repos)}</span>
              </div>
              {/* No « + » (final review ruling): chat.reset would clear the shared chat's cards while the feed stays. */}
              {p.headerExtra ?? <Button variant="ghost" size="icon" aria-label={t.feed.settings} title={t.feed.settings} onClick={p.onSettings}><Icon {...ICONS.gear} /></Button>}
              <Button variant="ghost" size="icon" aria-label={chatC.chat.close} title={chatC.chat.close} onClick={p.onClose}><Icon {...ICONS.close} /></Button>
            </div>
            <div ref={scroller} data-scroll className="ledge-scroll" role="log" aria-label={t.feed.thread} style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
              {/* A floor under the content so the island's menu, open over the feed, stays inside the notch. */}
              <div ref={p.contentRef} data-chat-content style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: FEED_MIN_H, boxSizing: 'border-box', padding: '10px 12px' }}>
                <div data-feed-top style={{ position: 'sticky', top: -10, zIndex: 2, display: 'flex', flexDirection: 'column', gap: 8, margin: '-10px -12px 0', padding: '10px 12px 6px', background: 'var(--sidebar)' }}>
                  {pinned && <div data-feed-pinned><Pinned client={client} escalation={pinned} onTalk={talk} /></div>}
                  <div style={{ display: 'flex' }}>
                    <button type="button" className="ledge-btn lt-btn" data-variant="outline" aria-pressed={onlyLedge} onClick={toggle}
                      style={{ fontSize: 12, lineHeight: '16px', padding: '3px 10px', ...(onlyLedge ? { borderColor: 'var(--sidebar-primary)', color: 'var(--sidebar-foreground)' } : { color: 'var(--muted-foreground)' }) }}>{t.feed.onlyLedge}</button>
                  </div>
                </div>
                {lines.length === 0 && pending.length === 0 && (
                  <div data-feed-empty style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6, padding: '18px 4px 6px', fontSize: 12.5, lineHeight: '18px', ...muted }}>
                    {mascot(48)}
                    <strong style={{ color: 'var(--sidebar-foreground)', fontSize: 14, lineHeight: '20px', marginTop: 6 }}>{t.feed.emptyTitle}</strong>
                    <span style={{ maxWidth: 340 }}>{t.feed.emptyHint}</span>
                  </div>
                )}
                {lines.map(line)}
                {pending.map(i => {
                  const text = liveText(i.kind === 'ledge' ? i.qid : undefined);
                  return (
                    <Line key={i.id} at={i.at} tone="ledge" head={<><span style={red}>{t.feed.ledge}</span> → <span style={strong}>{t.feed.toYou}</span></>}>
                      {text ? <ChatAnswer text={text} sessions={sessions} onOpen={open} onDocument={p.onDocument} /> : <span data-feed-thinking style={muted}>{chatC.chat.thinking}</span>}
                    </Line>
                  );
                })}
              </div>
            </div>
            <div data-chat-composer style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
              {offline && <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' }}>{offline}</span>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input ref={setField} data-chat-input type="text" className="ledge-field" aria-label={chatC.chat.ask} placeholder={t.feed.placeholder} value={draft} disabled={!!offline}
                  onChange={e => edit(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); say(); } else if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.blur(); } }}
                  style={{ flex: 1, minWidth: 0, height: 34, boxSizing: 'border-box', padding: '0 10px', background: 'var(--well)', color: 'inherit', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', fontSize: 13 }} />
                <Button variant="primary" size="icon" aria-label={chatC.chat.send} title={chatC.chat.send} disabled={!!offline || !draft.trim()} onClick={say} style={{ width: 34, height: 34 }}><Icon {...ICONS.send} /></Button>
              </div>
            </div>
          </div>
        </MarkdownLinks.Provider>
      </LedgeThreadCopyProvider>
    </ChatCopyProvider>
  );
}
