import { randomUUID } from 'node:crypto';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Box, Text, useInput } from 'ink';
import { answerEscalation, daemonStore, sayToLedge, type DaemonState } from '@ledge/fleet';
import { proposalRows, type ChatTurn, type Escalation, type LedgeThreadItem } from '@ledge/protocol';
import { localDay, pinnedEscalation, threadRows, type ThreadRow } from '@ledge/ui/chat/ledge/threadModel';
import { LEDGE_FOCUS, useEditing, useScreenSize, useTui, type KeyHandler } from '../context.js';
import { revisitDecision, useRigExchanges } from '../brain.js';
import { ChipsLine, type Chip, useChips, useOpenImage, usePaste } from '../images.js';
import { useCards } from '../model/cards.js';
import { askHistory, chatView, type Card } from '../model/chat.js';
import { selectedRow } from '../model/actionCard.js';
import { actionable, answerable, convLines, decisionKeys, interleave, type AnswerView } from '../model/ledgeConv.js';
import { anchorLine } from '../model/thread.js';
import { TOOL_NAME } from '../model/labels.js';
import { clock, oneLine } from '../model/time.js';
import { C, projectColor } from '../theme.js';
import { Button } from './SessionCard.js';
import { Lines } from './Lines.js';
import { useThrottled } from './throttle.js';
import { LedgeComposer } from './LedgeComposer.js';
import { TitledBox } from './TitledBox.js';
import { ActionBox } from './ActionBox.js';

const { left: LEFT, convo: CONVO, field: FIELD } = LEDGE_FOCUS;
type Keys = Array<readonly [string, string]>;
const IDLE: AnswerView = { state: 'idle' };

/** The latest attempt to answer escalation `id` (what `useAnswerState` reads, for any id). */
function answerOf(answering: DaemonState['answering'], id: string): AnswerView {
  let a: { result?: { ok: boolean; code?: string; reason?: string } } | undefined;
  for (const x of answering.values()) if (x.id === id) a = x;
  if (!a) return IDLE;
  if (!a.result) return { state: 'sending' };
  return a.result.ok ? { state: 'done' } : { state: 'refused', ...(a.result.code ? { code: a.result.code } : {}), ...(a.result.reason ? { reason: a.result.reason } : {}) };
}

export interface LedgeConversationProps {
  /** The columns it has (the home's right, or the whole screen when narrow). */
  width: number;
  /** The escalation chosen in « À toi »: its keys answer it, and it is drawn even when the thread does not name it. */
  escalation?: Escalation;
  /** Its keys, asked first by the home's: true when taken. */
  keys: MutableRefObject<KeyHandler | null>;
  /** The key bar for where the keyboard is; in the left column, only the keys the conversation adds there. */
  onBar(keys: Keys): void;
  /** The box's title in pieces (Ledge's tabs); « Ledge · Conversation » without. */
  heads?: { text: string; color: string; bold?: boolean }[];
  /** ← → with the field empty, from the field or the conversation: the next tab (1) or the one before (-1). */
  onTab?(dir: 1 | -1): void;
}

/**
 * Ledge's conversation in the home (the mockup's « Ledge en tête »): its thread, the decisions in its messages, what it settled,
 * the exchanges between agents, and the chat turns no item names; the action cards of its answers below, then the field. The keys
 * follow `ledgeFocus`: in the left column 1-9 e u z act on the conversation; tab goes round the field, the cards and the
 * conversation, where j k move between the decisions, what Ledge settled and the exchange groups.
 */
export function LedgeConversation({ width, escalation, keys: keysRef, onBar, heads, onTab }: LedgeConversationProps) {
  const { client, d, machines, t, g, toast, go, kept, small, tone, select, lang, rigs, escalations, projects, brain, ledgeFocus: focus, setLedgeFocus: setFocus } = useTui();
  const { rows: height } = useScreenSize();
  // Kept by the TUI: ctrl+c and another screen leave it as it is.
  const [draft, setDraftState] = useState(() => kept.drafts.get('ledge') ?? '');
  const setDraft = (x: string) => { setDraftState(x); if (x) kept.drafts.set('ledge', x); else kept.drafts.delete('ledge'); };
  // « En parler » (e): the escalation the next message is about.
  const [about, setAbout] = useState<Escalation | null>(null);
  const [browsing, setBrowsing] = useState(false);
  // The field's keys (suggestions, the `@` list), asked before the conversation's; whether its `@` list is open.
  const composer = useRef<KeyHandler | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // ctrl+n asks first: « Garder » by default.
  const [confirm, setConfirm] = useState(false);
  // The thread item j k have chosen; the exchange groups z flipped; the options picked in a decision of several questions.
  const [item, setItem] = useState<string | undefined>(undefined);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [picks, setPicks] = useState<ReadonlyMap<string, Record<string, string>>>(new Map());
  // The line at the top of the conversation once scrolled, as an element and a line in it, so that an answer written below, a
  // resize or a new card keep it in place; null follows the bottom.
  const [anchor, setAnchor] = useState<{ key: string; offset: number } | null>(null);
  const [view, setView] = useState(10);
  // Images travel inline with the question: no store on a machine before Ledge routes it.
  const chips = useChips(null);
  const paste = usePaste(chips);
  const openImage = useOpenImage();
  useEditing(focus === FIELD && !confirm);
  const cards = useCards({ client, d, t, go, select, focus, setFocus, height, width });
  // What the last question carried: given back if the daemon refuses it, as a session reply does.
  const sentAsk = useRef<{ qid: string; taken: Chip[]; text: string } | null>(null);
  useEffect(() => {
    const s = sentAsk.current;
    const turn = s && d.chat.find(x => x.qid === s.qid);
    if (!s || !turn) return;
    if (turn.error) { sentAsk.current = null; chips.putBack(s.taken); setDraft(kept.drafts.get('ledge') || s.text); }
    else if (turn.answeredAt) sentAsk.current = null;
  }, [d.chat]); // eslint-disable-line react-hooks/exhaustive-deps

  // The thread's rows: this daemon's escalations by id, the decisions Ledge's brain sent, the exchanges of the rigs it names.
  const items = d.ledgeThread;
  const escById = useMemo(() => new Map(escalations.filter(e => e.machine === 'local').map(e => [e.id, e])), [escalations]);
  const decisions = useMemo(() => (brain.decisions ? new Map(brain.decisions.map(x => [x.id, x])) : undefined), [brain.decisions]);
  const named = useMemo(() => {
    const seen = new Map<string, { machine: string; rigId: string }>();
    for (const i of items) if (i.kind === 'exchanges') seen.set(`${i.machine}/${i.rigId}`, { machine: i.machine, rigId: i.rigId });
    return [...seen.values()];
  }, [items]);
  const exchanges = useRigExchanges(client, named);
  const today = localDay(new Date().toISOString());
  const rows = useMemo(() => {
    const r = threadRows(items, { escalations: escById, exchanges: (m, id) => exchanges.get(`${m}/${id}`), chat: d.chat, ...(decisions ? { decisions } : {}), today, days: t.conv.days });
    // An escalation of « À toi » the thread does not name (another machine's): drawn last, as the thread would.
    if (escalation && !r.some(x => x.kind === 'escalation' && x.escalation?.id === escalation.id)) {
      const it: Extract<LedgeThreadItem, { kind: 'escalation' }> = { kind: 'escalation', id: `esc:${escalation.id}`, at: escalation.createdAt, escalationId: escalation.id };
      r.push({ kind: 'escalation', item: it, escalation });
    }
    return r;
  }, [items, escById, exchanges, d.chat, decisions, today, t, escalation]);
  const steps = useMemo(() => actionable(rows), [rows]);
  // j k's choice is the conversation's: back in the left column, none.
  useEffect(() => { if (focus === LEFT) setItem(undefined); }, [focus]);
  // j k's choice gone from the thread: none.
  useEffect(() => { if (item && !steps.some(r => r.kind !== 'day' && r.item.id === item)) setItem(undefined); }, [steps, item]);

  // What the keys act on: the item j k chose when it is one, else the escalation of « À toi », else the pinned one, else the latest.
  const chosen = (kind: ThreadRow['kind']) => steps.find(r => r.kind === kind && r.kind !== 'day' && r.item.id === item);
  const shownEsc = steps.flatMap(r => (r.kind === 'escalation' && r.escalation ? [r.escalation] : []));
  const target = (() => {
    const c = chosen('escalation');
    if (c?.kind === 'escalation') return c.escalation;
    return escalation ?? pinnedEscalation(shownEsc);
  })();
  const decided = (() => { const c = chosen('decided'); return c?.kind === 'decided' ? c : [...steps].reverse().find((r): r is Extract<ThreadRow, { kind: 'decided' }> => r.kind === 'decided'); })();
  const group = (() => { const c = chosen('exchanges'); return c?.kind === 'exchanges' ? c : [...steps].reverse().find((r): r is Extract<ThreadRow, { kind: 'exchanges' }> => r.kind === 'exchanges'); })();
  const answer = (id: string) => answerOf(d.answering, id);

  const local = machines.find(m => m.id === 'local');
  const asking = d.chat.find(x => !x.answeredAt && !x.error);
  /** false when refused (Ledge offline): the field keeps the text. */
  const ask = (text: string, { fromHistory }: { fromHistory: boolean }): boolean => {
    const images = fromHistory ? [] : chips.uploads();
    if (!text.trim() && images.length === 0) return true;
    if (!local?.ready) { toast({ text: t.ask.offline, tone: 'info' }); return false; }
    // About an escalation (« En parler »): to Ledge's thread, which knows what it is about.
    if (about && !images.length) {
      sayToLedge(client, text.trim(), about.id);
      setAbout(null);
      if (!fromHistory) setDraft('');
      return true;
    }
    const asked = { question: text.trim(), askedAt: new Date().toISOString() };
    kept.asked.push(asked);
    if (images.length) {
      // Images travel with a chat question: `ledge.say` carries text only.
      const qid = `q-${randomUUID()}`;
      daemonStore.beginTurn({ qid, ...asked, steps: [] });
      client.send({ type: 'chat.ask', qid, text: asked.question, images });
      sentAsk.current = { qid, taken: chips.clear(), text: asked.question };
    } else {
      // To Ledge's thread: the daemon sends `@seat …` to the seat, or tells why not, in the thread; the rest Ledge answers there,
      // its chat turn (and the cards it carries) under the user item's qid.
      sayToLedge(client, asked.question);
    }
    // An entry of the history asked again leaves the draft as it was.
    if (!fromHistory) setDraft('');
    return true;
  };

  /** A suggestion (alt+2…4): to Ledge as it reads, about nothing, the draft and its images left as they are. */
  const say = (text: string) => {
    if (!local?.ready) { toast({ text: t.ask.offline, tone: 'info' }); return; }
    kept.asked.push({ question: text, askedAt: new Date().toISOString() });
    sayToLedge(client, text);
  };

  /** 1-9 on the escalation the keys act on: its option, sent once; an escalation answered (here or elsewhere) takes the key and
   *  does nothing (review focus 3). A key it has no option for is not its own. */
  const decide = (input: string): boolean => {
    const e = target;
    if (!e) return false;
    const live = answerable(e, answer(e.id));
    if (e.intent === 'update') { if (input !== '1') return false; if (live) answerEscalation(client, e.id, {}); return true; }
    const k = decisionKeys(e).find(x => x.key === input);
    if (!k) return false;
    if (!live) return true;
    const next = { ...(picks.get(e.id) ?? {}), [k.questionId]: k.optionId };
    if (e.questions.every(q => next[q.id] !== undefined)) { answerEscalation(client, e.id, next); setPicks(m => { const x = new Map(m); x.delete(e.id); return x; }); }
    else setPicks(m => new Map(m).set(e.id, next));
    return true;
  };
  /** u: Ledge's decision questioned again (ruling R5); the daemon refuses it until Ledge's brain is there, in a toast. */
  const revisit = (id: string) => revisitDecision(client, id, { refused: m => toast({ text: t.conv.revisitRefused(m), tone: 'info' }), offline: () => toast({ text: t.ask.offline, tone: 'info' }) });
  const flip = (id: string) => setFlipped(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  const convW = Math.max(20, width - 4);
  // The streamed answer comes a few words at a time: drawn at most each 100 ms.
  const live = useThrottled(d.chatLive, 100);
  const rigOf = (machine: string, rigId: string) => {
    const r = rigs.find(x => x.machine === machine && x.id === rigId);
    return r ? { name: r.name, color: projectColor(projects?.projects.find(p => p.id === r.projectId)?.color) } : undefined;
  };
  const conv = useMemo(() => {
    const thread = convLines(rows, { t, g, width: convW, open: flipped, ...(focus === CONVO && item ? { focused: item } : {}), ...(target ? { target: target.id } : {}), answer, rig: rigOf, live, picks, lang });
    const at = new Map(rows.flatMap(r => (r.kind === 'day' ? [] : [[r.item.id, r.item.at] as const])));
    // The chat turns no item of the thread names: asked here or from the docked chat.
    const named = new Set(items.flatMap(i => ((i.kind === 'ledge' || i.kind === 'user') && i.qid ? [i.qid, `local:${i.qid}`] : [])));
    const loose = d.chat.filter(x => !named.has(x.qid));
    const chat = chatView(loose, live, { t, g, width: Math.max(20, width - 6) });
    const asked = new Map(loose.map(x => [x.qid, x.askedAt]));
    return { ...interleave([{ ...thread, at: k => at.get(k) }, { ...chat, at: k => asked.get(k) }]), turns: new Map<string, string>() };
  }, [rows, flipped, focus, item, target?.id, d.answering, live, picks, lang, d.chat, items, t, g, convW, width, tone, rigs, projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const { lines } = conv;
  const maxUp = Math.max(0, lines.length - view);
  const at = anchor ? anchorLine(conv, anchor) : -1;
  const up = at < 0 ? 0 : Math.min(maxUp, Math.max(0, lines.length - view - at));
  const scroll = (to: number) => {
    const u = Math.min(maxUp, Math.max(0, to));
    if (u === 0) { setAnchor(null); return; }
    const top = lines.length - view - u, key = conv.keys[top]!;
    setAnchor({ key, offset: top - conv.keys.indexOf(key) });
  };
  /** j k in the conversation: the next element to act on, brought into view. */
  const step = (dir: 1 | -1) => {
    const ids = steps.flatMap(r => (r.kind === 'day' ? [] : [r.item.id]));
    const i = item ? ids.indexOf(item) : -1;
    const next = ids[i < 0 ? ids.length - 1 : Math.min(ids.length - 1, Math.max(0, i + dir))]!;
    setItem(next);
    const first = conv.keys.indexOf(next), top = lines.length - view - up;
    if (first >= 0 && (first < top || first >= top + view)) scroll(lines.length - view - first);
  };
  // The images of the conversation, oldest first: alt+o opens the newest.
  const turnImages = useMemo(() => d.chat.flatMap(x => (x.attachments ?? []).map(ref => ({ ref, route: { machine: x.machineId } }))), [d.chat]);

  // ctrl+c stops the answer being written; ctrl+n starts a new conversation (once confirmed, when there is one); tab goes
  // round, from the field to the cards, the conversation and back; PgUp PgDn scroll the conversation, from the field and the left
  // column too; alt+v pastes an image in the field, alt+o opens the conversation's newest.
  const latest = useRef({ asking, cards: cards.cards, focus, confirm, turns: d.chat.length, scroll, up, view, reopen: cards.reopen, draft, turnImages, onTab, browsing });
  latest.current = { asking, cards: cards.cards, focus, confirm, turns: d.chat.length, scroll, up, view, reopen: cards.reopen, draft, turnImages, onTab, browsing };
  useInput((input, key) => {
    // Too small, nothing is drawn: esc is the app's.
    if (small) return;
    const l = latest.current;
    if (l.confirm) return;
    // The field's own keys first: alt+1…4 from anywhere in the conversation; ↑ ↓ tab while its `@` list is open.
    if (composer.current?.(input, key)) return;
    if (key.pageUp) { l.scroll(l.up + l.view - 1); return; }
    if (key.pageDown) { l.scroll(l.up - l.view + 1); return; }
    // The left column has the keyboard: the rest is the home's.
    if (l.focus === LEFT) return;
    if (key.ctrl && input === 'n') { if (l.turns === 0) client.send({ type: 'chat.reset' }); else setConfirm(true); return; }
    // ctrl+r opens the latest card set aside again, wherever the focus is; again, the one before.
    if (key.ctrl && input === 'r') { l.reopen(); return; }
    if (key.meta && input === 'v' && l.focus === FIELD) { paste(); return; }
    if ((key.backspace || key.delete) && l.focus === FIELD && l.draft === '') { chips.removeLast(); return; }
    // ← → in the field move its cursor; empty, they go to the next tab (the field's keys are the only ones while it has the keyboard).
    // The draft as the field left it for this very key (several keys read together come before a render).
    if ((key.leftArrow || key.rightArrow) && l.focus === FIELD && !kept.drafts.get('ledge') && !l.browsing && l.onTab) { l.onTab(key.rightArrow ? 1 : -1); return; }
    if (key.meta && input === 'o' && l.turnImages.length) { openImage(l.turnImages); return; }
    if (key.tab) { const n = l.cards.length; setFocus(f => (f === CONVO ? FIELD : f + 1 < n ? f + 1 : CONVO)); }
  });
  const handler: KeyHandler = (input, key) => {
    if (key.ctrl && input === 'c') {
      if (focus !== LEFT && asking) { client.send({ type: 'chat.cancel', qid: asking.qid }); return true; }
      return false;
    }
    // The confirmation has the keys: y clears, n or esc keeps; nothing else goes through.
    if (confirm) {
      if (input === 'y') { client.send({ type: 'chat.reset' }); setConfirm(false); }
      else if (input === 'n' || key.escape) setConfirm(false);
      return true;
    }
    // alt+1…4 are the suggestions' (the field's keys took them): never a decision's option.
    if (key.meta && /^[1-9]$/.test(input)) return true;
    if (focus === LEFT || focus === CONVO) {
      if (/^[1-9]$/.test(input)) return decide(input);
      if (input === 'e' && target) { setAbout(target); setFocus(FIELD); return true; }
      if (input === 'u' && decided?.decision) { revisit(decided.decision.id); return true; }
      if ((input === 'z' || (focus === CONVO && key.return)) && group) { flip(group.item.id); return true; }
    }
    if (focus === LEFT) return false;
    if (focus === CONVO) {
      if (input === 'k' || key.upArrow) { if (steps.length) step(-1); else scroll(up + 1); return true; }
      if (input === 'j' || key.downArrow) { if (steps.length) step(1); else scroll(up - 1); return true; }
      if (input === 'G' || key.end) { setAnchor(null); return true; }
      if ((key.leftArrow || key.rightArrow) && onTab && draft === '') { onTab(key.rightArrow ? 1 : -1); return true; }
      if (key.escape) { setFocus(FIELD); return true; }
      return false;
    }
    const card = cards.cards[focus];
    if (focus < 0 || !card) return false;
    if (card.kind === 'action') return cards.actionKey(card.qid, input, key);
    if (key.return) { cards.act(card); return true; }
    if (key.escape) { setFocus(FIELD); return true; }
    return false;
  };
  keysRef.current = handler;
  useEffect(() => () => { if (keysRef.current === handler) keysRef.current = null; }); // eslint-disable-line react-hooks/exhaustive-deps

  // The keys follow the focus: ctrl+c only while Ledge answers.
  const stop = asking ? [['ctrl+c', t.keys.stopAnswer] as const] : [];
  const card = cards.cards[focus];
  const review$ = cards.ignored ? [['ctrl+r', t.keys.review] as const] : [];
  const acts: Keys = [...(target && answerable(target, answer(target.id)) ? [[decisionKeys(target).map(k => k.key).slice(0, 2).join(' ') + ' e', t.keys.decide] as const] : target ? [['e', t.keys.talk] as const] : []),
    ...(decided?.decision ? [['u', t.keys.revisit] as const] : []), ...(group ? [['z', t.keys.fold] as const] : [])];
  // What was asked: the conversation's questions, not only this run's.
  const history = askHistory(d.chat, kept.asked);
  const tabs$ = onTab && draft === '' ? [['← →', t.keys.tabs] as const] : [];
  const bar: Keys = focus === LEFT ? acts
    : confirm ? [['n esc', t.keys.keep], ['y', t.keys.wipe]]
    : focus === FIELD && listOpen ? [['↑ ↓', t.keys.choose], ['tab', t.keys.complete], ['↵', t.keys.sendOnly], ['esc', t.keys.keepAndLeave]]
    : focus === FIELD && browsing ? [['↵', t.keys.resend], ['↑ ↓', t.keys.history], ['esc', t.keys.backToDraft]]
    // ctrl+r near the front while a card is set aside: the bar drops what does not fit, from its end.
    : focus === FIELD ? [['↵', t.keys.sendOnly], ...review$, ['alt+↵', t.keys.newLine], ['esc', t.keys.back], ['PgUp PgDn', t.keys.scroll], ['↑ ↓', t.keys.history], ['tab', cards.cards.length ? t.keys.nextCard : t.keys.conversation], ['alt+v', t.keys.image], ...(turnImages.length ? [['alt+o', t.keys.openImage] as const] : []), ['ctrl+n', t.keys.newChat], ...stop, ...tabs$]
    : focus === CONVO ? [['j k', steps.length ? t.keys.navigate : t.keys.line], ...acts, ['PgUp PgDn', t.keys.page], ['G', t.keys.end], ...stop, ['tab', t.keys.question], ['esc', t.keys.question], ...tabs$]
    : card?.kind === 'action' ? [...cards.actionKeys(card.qid), ...stop, ...review$]
    : [['↵', t.keys.send], ['tab', focus + 1 < cards.cards.length ? t.keys.nextCard : t.keys.conversation], ['ctrl+n', t.keys.newChat], ...stop, ['esc', t.keys.back]];
  const barKey = bar.map(k => k.join(' ')).join('|');
  useEffect(() => { onBar(bar); }, [barKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scrolled: how much is above and below, or that the answer goes on below; at the bottom, what is above.
  const foot = up > 0 ? (asking && live?.qid === asking.qid ? t.ask.answering : t.session.scrolled(lines.length - view - up, up))
    : lines.length > view ? (focus === CONVO ? t.session.above(lines.length - view) : t.ask.above(lines.length - view)) : undefined;
  const reading = focus === CONVO;
  return (
    <Box flexDirection="column" flexGrow={1} width={width}>
      <TitledBox title={t.home.conversation} {...(heads ? { heads } : {})} flexGrow={1} color={reading ? C.coral : C.line} titleColor={reading ? C.coral : C.fg} titleBold
        foot={foot} footColor={reading || up > 0 ? C.coral : C.faint}>
        {lines.length === 0 ? <Text color={C.faint}>{t.ask.empty}</Text>
          : <Lines lines={lines} up={up} onHeight={setView} />}
      </TitledBox>
      {cards.cards.map((c, i) => {
        const turn = d.chat.find(x => x.qid === c.qid)!;
        if (c.kind !== 'action') return <CardBox key={`${c.kind}:${c.qid}`} card={c} turn={turn} focused={i === focus} busy={cards.busy?.qid === c.qid} />;
        const p = cards.planOf(turn);
        const sel = selectedRow(p, cards.rowOf[c.qid]);
        return <ActionBox key={`action:${c.qid}`} turn={turn} plan={p} focused={i === focus} busy={cards.busy?.qid === c.qid} sel={sel} confirming={cards.confirming?.qid === c.qid ? cards.confirming.rows : null} width={width} />;
      })}
      {confirm
        ? <TitledBox title={t.ask.resetTitle} color={C.red} titleColor={C.red} flexShrink={0}>
          <Text color={C.fg}>{t.ask.resetBody(d.chat.length, d.chat[0] ? clock(d.chat[0].askedAt) : '')}{draft.trim() ? ` ${t.ask.draftStays}` : ''}</Text>
          <Box marginTop={1} columnGap={2}><Button label={t.ask.keep} k="n · esc" primary /><Button label={t.ask.wipe} k="y" /></Box>
        </TitledBox>
        : <><ChipsLine chips={chips.items} /><LedgeComposer title={about ? t.conv.about(oneLine(about.summary || about.questions[0]?.question || about.id)) : t.compose.title} draft={draft} setDraft={setDraft} onSubmit={ask}
          onSay={say} onEscape={() => { if (!draft) { setAbout(null); setFocus(LEFT); } }} browsing={browsing} onBrowse={setBrowsing} history={history}
          active={focus === FIELD} width={width - 4} keys={composer} onList={setListOpen} /></>}
    </Box>
  );
}

function CardBox({ card, turn, focused, busy }: { card: Exclude<Card, { kind: 'action' }>; turn: ChatTurn; focused: boolean; busy: boolean }) {
  const { t, g } = useTui();
  const color = focused ? C.coral : C.line;
  if (card.kind === 'launch') {
    const rows = proposalRows(turn);
    return (
      <TitledBox title={t.ask.launchCard} flexShrink={0} color={color} titleColor={C.coral}>
        {card.rows.map(r => { const p = rows[r]!; return (
          <Box key={r} flexDirection="column">
            <Text wrap="truncate"><Text color={C.dim}>{t.ask.folder.padEnd(13)}</Text><Text color={C.fg}>{p.project}</Text> <Text color={C.faint}>{p.cwd}</Text></Text>
            <Text wrap="truncate"><Text color={C.dim}>{t.ask.agent.padEnd(13)}</Text>{TOOL_NAME[p.tool]}</Text>
            {p.prompt ? <Text wrap="truncate"><Text color={C.dim}>{t.ask.instruction.padEnd(13)}</Text>{oneLine(p.prompt)}</Text> : null}
            {p.error ? <Text color={C.red} wrap="truncate">{p.error}</Text> : null}
          </Box>
        ); })}
        <Box columnGap={2}><Button label={busy ? `${g.live} ${t.ask.launch}` : t.ask.launch} k="↵" primary={focused} /><Button label={t.ask.ignore} k="esc" /><Text color={C.faint}>{t.ask.nothingWithoutYou}</Text></Box>
      </TitledBox>
    );
  }
  if (card.kind === 'relay') {
    const r = turn.relay!;
    return (
      <TitledBox title={t.ask.relayCard(r.name)} flexShrink={0} color={color} titleColor={C.violet}>
        <Text wrap="truncate" color={C.fg}>{oneLine(r.text)}</Text>
        {r.error ? <Text color={C.red} wrap="truncate">{r.error}</Text> : null}
        <Box columnGap={2}><Button label={r.status === 'queued' ? t.ask.cancelRelay : t.ask.relay} k="↵" primary={focused} />{r.status === 'queued' ? <Text color={C.faint}>{t.ask.queued}</Text> : null}</Box>
      </TitledBox>
    );
  }
  const closes = turn.closes ?? [];
  return (
    <TitledBox title={t.ask.closeCard} flexShrink={0} color={color} titleColor={C.red}>
      {card.rows.map(r => <Text key={r} wrap="truncate"><Text color={C.fg}>{closes[r]!.name}</Text> <Text color={C.faint}>{TOOL_NAME[closes[r]!.tool]}</Text>{closes[r]!.error ? <Text color={C.red}>  {closes[r]!.error}</Text> : null}</Text>)}
      <Box columnGap={2}><Button label={t.ask.close} k="↵" primary={focused} /></Box>
    </TitledBox>
  );
}
