import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { daemonStore, useDaemon, type DaemonClient } from '@ledge/fleet';
import { contextShare, type ChatTurn, type Projects } from '@ledge/protocol';
import { ChatView } from '@ledge/ui/chat/ChatView';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import { useActionCards } from '@ledge/ui/chat/useActionCards';
import { useAttachments } from '../images/useAttachments';
import { TurnThumbs } from '../images/Thumbs';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { FleetView } from '../fleet/useFleet';
import type { Decisions } from '../fleet/decisions';
import { chatCopy, useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { cls } from '../shell/cls';
import { SessionBot } from '../shell/SessionBot';
import { attentionOf, quickDecide } from '../shell/sidebar/model';
import { useDefaultTool } from '../settings/tool';
import { HOME_TABS, type HomeTab, type NavAction } from '../nav/state';
import { nearLimit, type Relief } from '../session/useRelief';
import type { Wait } from '../list/time';
import { useAgentHighlight } from './useAgentHighlight';
import { useChatCards } from './useChatCards';
import { CardModelPick } from './CardModelPick';
import { useProjectReview } from './projectReview';

export interface LedgeHomeProps {
  client: DaemonClient; view: FleetView; relief: Relief; decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  tab: HomeTab; dispatch: (a: NavAction) => void;
  paused: boolean; focus: number;
  projects: Projects | null;
  onLaunched(id: string): void; onTerminal(id: string): void; notify(text: string): void; onProposal(pid: string): void;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });


/**
 * « Le point » (ledge home spec §2.2): built here from the daemon's state, never by the model, so it is instant and true.
 * What waits for the user, answerable in place, and the sessions near their context limit. « Résumer la journée » is an
 * ordinary question.
 */
export function LePoint({ view, relief, decisions, waits, dispatch, onAsk, busy }: {
  view: FleetView; relief: Relief; decisions: Decisions; waits: ReadonlyMap<string, Wait>; dispatch: (a: NavAction) => void;
  onAsk(text: string): void; busy: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const p = t.home.point;
  const attn = useMemo(() => attentionOf(view.sessions, waits), [view.sessions, waits]);
  // Near their context limit (context handover spec §3.2), as « À toi » lists them.
  const near = useMemo(() => nearLimit(view.sessions, relief.later, relief.near), [view.sessions, relief.later, relief.near]);
  return (
    <section className="le-point" aria-label={p.title}>
      <div className="lp-head">
        <strong>{p.title}</strong>
        <span className="st-fill" />
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAsk(p.summarizeQuestion)}>{p.summarize}</Button>
      </div>
      <div className="lp-cols">
        <div className="lp-col" aria-label={p.yours}>
          <h3>{p.yours} {attn.length + near.length > 0 && <b className="st-badge">{attn.length + near.length}</b>}</h3>
          {attn.length + near.length === 0 && <p className="lp-none">{p.nothingYours}</p>}
          {attn.map(item => (
            <div key={item.session.id} className="lp-row">
              <SessionBot session={item.session} size={16} paused />
              <span className="lp-text"><strong>{item.helper?.kind ?? item.session.name}</strong> {item.session.pending?.text ?? ''}</span>
              {item.kind === 'approval' && quickDecide(item.session) ? <>
                <button type="button" className="st-qa pri" onClick={() => decisions.decide(item.session, 'accept')}>{p.allow}</button>
                <button type="button" className="st-qa" onClick={() => decisions.decide(item.session, 'deny')}>{p.deny}</button>
              </> : <button type="button" className="st-qa" onClick={() => dispatch({ type: 'open', id: item.session.id, ...(item.helper ? { helper: item.helper.id } : {}), ...(item.kind === 'question' ? { focus: 'reply' as const } : {}) })}>{p.see}</button>}
            </div>
          ))}
          {near.map(s => {
            const failed = s.handover?.state === 'failed';
            const pct = Math.round((contextShare(s.context) ?? 0) * 100);
            return (
              <div key={`near:${s.id}`} className="lp-row lp-near" data-near={s.id}>
                <span className={cls('lp-mark', failed ? 'lp-refused' : 'lp-near-mark')} aria-hidden>{failed ? '!' : '◔'}</span>
                <span className="lp-text" title={failed ? s.handover?.reason : t.handover.nearHint}>{failed ? t.handover.failedShort(s.name) : t.handover.nearShort(s.name, pct)}</span>
                <button type="button" className="st-qa pri" title={t.handover.passTitle} onClick={() => { void relief.handover(s.id); }}>{failed ? t.handover.retry : t.handover.pass}</button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** « Historique »: the day's questions, which the daemon keeps; one opens the conversation on it. */
function HistoryTab({ chat, onOpen }: { chat: readonly ChatTurn[]; onOpen(qid: string): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="home-list" role="tabpanel" aria-label={t.home.tabs.history}>
      {chat.length === 0 && <p className="lp-none">{t.home.history.none}</p>}
      {chat.slice().reverse().map(turn => (
        <button key={turn.qid} type="button" className="lp-row" onClick={() => onOpen(turn.qid)} title={t.home.history.open}>
          <small>{clock(turn.askedAt)}</small>
          <span className="lp-text">{turn.question}</span>
        </button>
      ))}
    </div>
  );
}

/** The word being typed when it starts with `@` (a session): what the mention list completes. */
export function mentionAt(text: string): { sigil: '@'; query: string; start: number } | null {
  const m = /(^|\s)(@)([^\s@]*)$/.exec(text);
  return m ? { sigil: '@', query: m[3]!.toLowerCase(), start: m.index + m[1]!.length } : null;
}

/**
 * Ledge's home view (ledge home spec §2.2), where the app opens: the header, the tabs, « Le point » pinned over the
 * conversation, the cards (sessions, relays, closes, projects), and a richer composer: suggestions, several
 * lines, `@` a session, and the reminder that Ledge does nothing without a click.
 */
export function LedgeHome(p: LedgeHomeProps): JSX.Element {
  const { client, view, relief, tab, dispatch } = p;
  const { t } = useI18n();
  const copy = useMemo(() => chatCopy(t), [t]);
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { chat, chatLive } = useDaemon();
  const [tool] = useDefaultTool();
  const send = useCallback((m: Parameters<DaemonClient['send']>[0]) => client.send(m), [client]);
  const onMessage = useCallback((fn: Parameters<DaemonClient['onMessage']>[0]) => client.onMessage(fn), [client]);
  const offline = view.machines.find(m => m.id === 'local')?.ready ? null : copy.offline;
  const turnReady = useCallback((qid: string) => !!view.fleet.turnMachine(qid)?.ready, [view.fleet]);
  const turnMachine = useCallback((qid: string) => view.fleet.turnMachine(qid)?.id, [view.fleet]);
  const cards = useChatCards({ send, chat, lastLaunched: view.lastLaunched, errors: view.errors, sessions: view.sessions, turnReady, turnMachine, onLaunched: p.onLaunched });
  const actionCards = useActionCards({ send, chat, errors: view.errors, turnReady, onMessage });
  const project = useProjectReview({ chat, projects: p.projects, machines: view.machines, notify: p.notify, onProposal: p.onProposal });
  const [hovered, setHovered] = useState<string | null>(null);
  useAgentHighlight(hovered);
  const [draft, setDraft] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => { if (tab === 'conversation') inputRef.current?.focus({ preventScroll: true }); }, [p.focus, tab]);
  const busy = chat.some(x => x.answeredAt === undefined && x.error === undefined);

  // Images pasted or dropped on the field travel inline with the field's question only (not a suggestion's or « Résumer »).
  const images = useAttachments(client, { inline: true });
  const ask = (text: string, withImages = false) => {
    if (offline) return;
    const qid = `q-${crypto.randomUUID()}`;
    daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] });
    const uploads = withImages ? images.uploads() : [];
    send({ type: 'chat.ask', qid, text, ...(uploads.length ? { images: uploads } : {}), tool });
    if (withImages) images.clear();
    if (tab !== 'conversation') dispatch({ type: 'ledge', tab: 'conversation' });
  };
  const open = (id: string) => { setHovered(null); dispatch({ type: 'open', id }); };

  // `@` names a session: the list completes the word being typed, inserted as the name the context folder knows.
  const mention = mentionAt(draft);
  const choices = mention ? view.sessions.filter(s => s.name.toLowerCase().startsWith(mention.query)).slice(0, 6).map(s => ({ key: s.id, label: t.home.mentionSession(s.name), insert: `@${s.name}` })) : [];
  useEffect(() => setMentionIndex(0), [mention?.query, mention?.sigil]);
  const insert = (value: string) => { if (!mention) return; setDraft(`${draft.slice(0, mention.start)}${value} `); inputRef.current?.focus(); };
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (!choices.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(choices[mentionIndex]!.insert); return true; }
    return false;
  };
  const suggestions = t.home.suggestions;
  const above = (
    <>
      {choices.length > 0 && (
        <div className="home-mentions" role="listbox" aria-label={t.home.mentions}>
          {choices.map((c, i) => <button key={c.key} type="button" role="option" aria-selected={i === mentionIndex} className={cls(i === mentionIndex && 'sel')} onMouseDown={e => { e.preventDefault(); insert(c.insert); }}>{c.label}</button>)}
        </div>
      )}
      <div className="home-suggestions">
        {suggestions.map(s => (
          <button key={s} type="button" disabled={busy || !!offline}
            onClick={() => { if (s.endsWith('…')) { setDraft(s.slice(0, -1)); inputRef.current?.focus(); } else ask(s); }}>{s}</button>
        ))}
      </div>
    </>
  );
  const machines = view.machines.filter(m => m.ready).length;
  const header = (
    <div className="home-head">
      <ResidentMascot size={30} theme={theme} paused={p.paused} reducedMotion={p.paused || reduced} />
      <div className="home-title">
        <span data-brand className="home-brand">Ledge<span className="brand-dot">.</span></span>
        <span className="home-sub">{t.home.operator(view.sessions.length, machines)}</span>
      </div>
      <span className="st-fill" />
      <Button variant="ghost" size="icon" aria-label={t.chat.reset} title={t.chat.reset} disabled={busy || !!offline || chat.length === 0} onClick={() => send({ type: 'chat.reset' })}><Icon {...ICONS.plus} /></Button>
      <Button variant="ghost" size="icon" aria-label={t.home.toAtelier} title={t.home.toAtelier} onClick={() => dispatch({ type: 'escape' })}><Icon {...ICONS.close} /></Button>
    </div>
  );
  const counts: Record<HomeTab, string> = { conversation: t.home.tabs.conversation, history: t.home.tabs.history };
  return (
    <section className="ledge-home" aria-label={t.side.ledgeHome}>
      <div className="home-column">
        {header}
        <div className="home-tabs" role="tablist" aria-label={t.home.tabsLabel}>
          {HOME_TABS.map(x => <button key={x} type="button" role="tab" aria-selected={tab === x} className={cls(tab === x && 'on')} onClick={() => dispatch({ type: 'ledge', tab: x })}>{counts[x]}</button>)}
        </div>
        <div className="home-body">
          {tab === 'conversation' && (
            <ChatCopyProvider value={copy}>
              <ChatView docked visible hideHeader multiline turnImages={turn => <TurnThumbs client={client} turn={turn} />} turns={chat} live={chatLive} sessions={view.sessions} offline={offline}
                pinned={<LePoint view={view} relief={relief} decisions={p.decisions} waits={p.waits} dispatch={dispatch} onAsk={ask} busy={busy || !!offline} />}
                above={above} footnote={<small className="home-readonly">{t.home.readOnly}</small>}
                draft={draft} onDraft={setDraft} onFieldKey={onFieldKey}
                attach={{ items: images.items, onFiles: images.add, onRemove: images.remove, ready: images.ready, error: images.error }}
                onAsk={ask} onCancel={qid => send({ type: 'chat.cancel', qid })} onReset={() => send({ type: 'chat.reset' })} onClose={() => dispatch({ type: 'escape' })}
                onOpenSession={open} onTerminal={id => { setHovered(null); p.onTerminal(id); }} turnAvailable={turnReady}
                launchingQid={cards.launchingQid} launchingRows={cards.launchingRows} onLaunchProposal={cards.launch}
                closingQid={cards.closingQid} closingRows={cards.closingRows} onCloseSessions={cards.close}
                onAct={actionCards.act} actingQid={actionCards.actingQid} actingRows={actionCards.actingRows} onIgnoreCards={actionCards.ignore} onDenyAction={actionCards.deny}
                renderModel={(qid, agent, b) => <CardModelPick client={client} machine={turnMachine(qid)} tool={agent} pick={cards.pick(qid)} disabled={b} onPick={next => cards.setPick(qid, next)} />}
                relayingQid={cards.relayingQid} onRelay={cards.relay} onRelayCancel={cards.cancelRelay}
                onProject={project.review} projectNamed={project.projectNamed}
                clock={clock}
                onAgentHover={setHovered} inputRef={inputRef}
                theme={theme} frozen={offline !== null} reducedMotion={p.paused || reduced} />
            </ChatCopyProvider>
          )}
          {tab === 'history' && <HistoryTab chat={chat} onOpen={qid => {
            dispatch({ type: 'ledge', tab: 'conversation' });
            requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('[data-turn]')][chat.findIndex(x => x.qid === qid)]?.scrollIntoView({ block: 'start' }));
          }} />}
        </div>
      </div>
    </section>
  );
}
