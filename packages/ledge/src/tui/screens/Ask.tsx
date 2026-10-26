import { randomUUID } from 'node:crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { daemonStore } from '@ledge/fleet';
import { LEDGE_GIVER, proposalRows, type ChatTurn } from '@ledge/protocol';
import { useEditing, useScreenKeys, useTui } from '../context.js';
import { askHistory, chatView, openCards, type Card } from '../model/chat.js';
import { cardPlan, moveRow, selectedRow, type Room } from '../model/actionCard.js';
import { wrapSegs } from '../model/cells.js';
import { anchorLine } from '../model/thread.js';
import { TOOL_NAME } from '../model/labels.js';
import { listed } from '../model/overview.js';
import { clock, oneLine } from '../model/time.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { Button } from '../ui/SessionCard.js';
import { Lines } from '../ui/Lines.js';
import { useThrottled } from '../ui/throttle.js';
import { Field } from '../ui/Field.js';
import { TitledBox } from '../ui/TitledBox.js';
import { ActionBox, appliable, deniable } from '../ui/ActionBox.js';

/** A card's send is done when its turn changes, an error comes without a session id, or after this long. */
const CARD_MS = 20_000;
/** The focus on the conversation, read with the thread's keys; -1 is the question field, 0… a card. */
const CONVO = -2;

export function Ask() {
  const { client, d, machines, t, g, toast, go, kept, small, tone, select } = useTui();
  const { columns, rows: height } = useWindowSize();
  // Kept by the TUI: ctrl+c and another screen leave it as it is.
  const [draft, setDraftState] = useState(() => kept.drafts.get('ask') ?? '');
  const setDraft = (x: string) => { setDraftState(x); if (x) kept.drafts.set('ask', x); else kept.drafts.delete('ask'); };
  const [browsing, setBrowsing] = useState(false);
  // ctrl+n asks first: « Garder » by default.
  const [confirm, setConfirm] = useState(false);
  // -1: the question field; CONVO: the conversation; otherwise the index of the focused card.
  const [focus, setFocus] = useState(-1);
  // The line at the top of the conversation once scrolled, as a turn and a line in it, so that an answer written below, a
  // resize or a new card keep it in place; null follows the bottom.
  const [anchor, setAnchor] = useState<{ key: string; offset: number } | null>(null);
  const [view, setView] = useState(10);
  // A generic card's send (`rid`) is under way until the daemon answers it (chat.acted), whatever its rows did meanwhile.
  const [busy, setBusy] = useState<{ qid: string; turn: ChatTurn | undefined; errorSeq: number; at: number; rid?: string } | null>(null);
  // The action cards (#94): the row chosen in each, the rows a red box asks to confirm, the card ctrl+r opened again.
  const [rowOf, setRowOf] = useState<Record<string, number>>({});
  const [confirming, setConfirming] = useState<{ qid: string; rows: number[] } | null>(null);
  const [review, setReview] = useState<string | null>(null);
  useEditing(focus === -1 && !confirm);

  const cards = useMemo(() => openCards(d.chat), [d.chat]);
  // What a card has on screen (#94): all but the frame's two lines, the field's three and the conversation's last one, shared by
  // the cards drawn. A request taller than that is cut: never accepted unread.
  const room: Room = {
    lines: Math.floor((height - 6) / Math.max(1, Math.min(2, cards.length))),
    height: (text, indent) => text.split('\n').reduce((n, l) => n + Math.max(1, wrapSegs([{ text: l, color: C.fg }], Math.max(10, columns - 8 - indent)).length), 0)
  };
  const planOf = (turn: ChatTurn) => cardPlan(turn.actions ?? [], room);
  useEffect(() => { if (focus >= cards.length) setFocus(cards.length ? cards.length - 1 : -1); }, [cards.length, focus]);
  // Opened again with ctrl+r: its card has the focus once it is back.
  useEffect(() => {
    if (!review) return;
    const i = cards.findIndex(c => c.qid === review);
    if (i >= 0) { setFocus(i); setReview(null); }
  }, [cards, review]);
  // A confirmation of a card that went (applied or ignored elsewhere) goes with it.
  useEffect(() => { if (confirming && !cards.some(c => c.kind === 'action' && c.qid === confirming.qid)) setConfirming(null); }, [confirming, cards]);
  // So does one whose rows the screen no longer shows whole (made smaller, a request cut).
  useEffect(() => {
    const turn = confirming && d.chat.find(x => x.qid === confirming.qid);
    if (turn && !confirming.rows.every(i => appliable(planOf(turn).shown[i]!))) setConfirming(null);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  /** The latest card set aside, the one ctrl+r opens again. */
  const ignored = [...d.chat].filter(x => x.ignoredAt).sort((a, b) => b.ignoredAt!.localeCompare(a.ignoredAt!))[0];
  // A card in flight is free again once its turn moved, a refusal came, or nothing happened for a while.
  useEffect(() => {
    if (!busy?.rid) return;
    return client.onMessage(m => { if (m.type === 'chat.acted' && m.rid === busy.rid) setBusy(null); });
  }, [busy?.rid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!busy) return;
    const turn = d.chat.find(x => x.qid === busy.qid);
    if ((turn !== busy.turn && !busy.rid) || (d.errors.at(-1)?.seq ?? 0) > busy.errorSeq) { setBusy(null); return; }
    const timer = setTimeout(() => setBusy(null), Math.max(0, busy.at + CARD_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [busy, d.chat, d.errors]);

  const local = machines.find(m => m.id === 'local');
  const asking = d.chat.find(x => !x.answeredAt && !x.error);
  /** false when refused (Ledge offline): the field keeps the text. */
  const ask = (text: string, { fromHistory }: { fromHistory: boolean }): boolean => {
    if (!text.trim()) return true;
    if (!local?.ready) { toast({ text: t.ask.offline, tone: 'info' }); return false; }
    const qid = `q-${randomUUID()}`;
    const asked = { question: text.trim(), askedAt: new Date().toISOString() };
    daemonStore.beginTurn({ qid, ...asked, steps: [] });
    client.send({ type: 'chat.ask', qid, text: asked.question });
    kept.asked.push(asked);
    // An entry of the history asked again leaves the draft as it was.
    if (!fromHistory) setDraft('');
    return true;
  };
  const act = (card: Card) => {
    if (busy || card.kind === 'action') return;
    const turn = d.chat.find(x => x.qid === card.qid);
    if (!turn) return;
    if (card.kind === 'task') {
      // A task to `@role` waits for the team proposed with it.
      const row = card.rows.find(r => { const c = turn.tasks![r]!; return !c.to.startsWith('@') || c.team || turn.team?.teamId; });
      if (row === undefined) { toast({ text: t.ask.waitTeam, tone: 'info' }); return; }
      setBusy({ qid: card.qid, turn, errorSeq: d.errors.at(-1)?.seq ?? 0, at: Date.now() });
      client.send({ type: 'task.cmd', rid: randomUUID(), by: LEDGE_GIVER, op: 'give', qid: card.qid, row });
      return;
    }
    setBusy({ qid: card.qid, turn, errorSeq: d.errors.at(-1)?.seq ?? 0, at: Date.now() });
    if (card.kind === 'team') client.send({ type: 'team.launch', rid: randomUUID(), qid: card.qid });
    else if (card.kind === 'launch') {
      const first = proposalRows(turn)[card.rows[0]!]!;
      client.send({ type: 'session.launch', tool: first.tool, cwd: first.cwd, ...(first.prompt ? { prompt: first.prompt } : {}), qid: card.qid, rows: card.rows });
    } else if (card.kind === 'relay') client.send({ type: turn.relay?.status === 'queued' ? 'session.relay.cancel' : 'session.relay', qid: card.qid });
    else client.send({ type: 'session.close', qid: card.qid, rows: card.rows });
  };

  /** A generic card's rows through chat.act: applied, confirmed, or their requests denied (« Refuser »). */
  const send = (qid: string, rows: number[], o: { confirmed?: true; deny?: true } = {}) => {
    const turn = d.chat.find(x => x.qid === qid);
    const rid = randomUUID();
    setBusy({ qid, turn, errorSeq: d.errors.at(-1)?.seq ?? 0, at: Date.now(), rid });
    client.send({ type: 'chat.act', rid, qid, rows, ...o });
  };
  /** The keys of a focused generic card (docs/mockups/ledge-action-card.html, view TUI): ↑ ↓ the row, ↵ applies it, a all
   *  of them, n denies a request, o opens the session, esc sets the card aside; an irreversible one is asked in the box, and
   *  only y confirms it. */
  const actionKey = (qid: string, input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean }): boolean => {
    const turn = d.chat.find(x => x.qid === qid);
    if (!turn?.actions) return false;
    const p = planOf(turn);
    const sel = selectedRow(p, rowOf[qid]);
    const ask = (rows: number[]) => { if (rows.some(i => p.rows[i]!.risk === 'destructive')) setConfirming({ qid, rows }); else send(qid, rows); };
    if (confirming?.qid === qid) {
      if (input === 'y') { const rows = confirming.rows; setConfirming(null); if (rows.every(i => appliable(p.shown[i]!))) send(qid, rows, { confirmed: true }); }
      else if (key.escape) setConfirming(null);
      // ↵ never confirms: a double press dissolves nothing.
      return true;
    }
    const r = p.rows[sel]!, s = p.shown[sel]!;
    if (input === 'o') {
      const id = turn.actions[sel]?.session;
      if ((s === 'stale' || s === 'cut') && id) { select(id); go('session'); }
      return true;
    }
    // A send under way, or a row still running: nothing else goes until the daemon has answered.
    if (busy?.qid === qid || p.shown.includes('running')) return true;
    if (key.upArrow || input === 'k') { setRowOf(m => ({ ...m, [qid]: moveRow(p, sel, -1) })); return true; }
    if (key.downArrow || input === 'j') { setRowOf(m => ({ ...m, [qid]: moveRow(p, sel, 1) })); return true; }
    if (key.return) { if (appliable(s)) ask([sel]); return true; }
    if (input === 'a' && p.rows.length > 1) { if (p.all.rows.length) ask(p.all.rows); return true; }
    if (input === 'n') { if (deniable(r, s)) send(qid, [sel], { deny: true }); return true; }
    if (key.escape) {
      // Nothing left to do from the card (a request changed): esc goes back, as on a settled card.
      if (p.open.length || p.shown.some(x => x === 'cut')) client.send({ type: 'chat.ignore', qid }); else setFocus(-1);
      return true;
    }
    return false;
  };

  const sessions = listed(d.sessions).length;
  const width = Math.max(20, columns - 6);
  // The streamed answer comes a few words at a time: drawn at most each 100 ms.
  const live = useThrottled(d.chatLive, 100);
  const chat = useMemo(() => chatView(d.chat, live, { t, g, width }), [d.chat, live, t, g, width, tone]);
  const { lines } = chat;
  const maxUp = Math.max(0, lines.length - view);
  const at = anchor ? anchorLine(chat, anchor) : -1;
  const up = at < 0 ? 0 : Math.min(maxUp, Math.max(0, lines.length - view - at));
  const scroll = (to: number) => {
    const u = Math.min(maxUp, Math.max(0, to));
    if (u === 0) { setAnchor(null); return; }
    const top = lines.length - view - u, key = chat.keys[top]!;
    setAnchor({ key, offset: top - chat.keys.indexOf(key) });
  };

  // ctrl+c stops the answer being written; ctrl+n starts a new conversation (once confirmed, when there is one); tab goes
  // round, from the field to the cards, the conversation and back; PgUp PgDn scroll the conversation, from the field too.
  const latest = useRef({ asking, cards, focus, confirm, turns: d.chat.length, scroll, up, view, ignored });
  latest.current = { asking, cards, focus, confirm, turns: d.chat.length, scroll, up, view, ignored };
  useInput((input, key) => {
    // Too small, nothing is drawn: esc is the app's.
    if (small) return;
    const l = latest.current;
    if (l.confirm) return;
    if (key.ctrl && input === 'n') { if (l.turns === 0) client.send({ type: 'chat.reset' }); else setConfirm(true); return; }
    // ctrl+r opens the latest card set aside again, wherever the focus is; again, the one before.
    if (key.ctrl && input === 'r') { if (l.ignored) { client.send({ type: 'chat.ignore', qid: l.ignored.qid, undo: true }); setReview(l.ignored.qid); } return; }
    if (key.pageUp) { l.scroll(l.up + l.view - 1); return; }
    if (key.pageDown) { l.scroll(l.up - l.view + 1); return; }
    if (key.tab) { const n = l.cards.length; setFocus(f => (f === CONVO ? -1 : f + 1 < n ? f + 1 : CONVO)); }
  });
  useScreenKeys((input, key) => {
    if (key.ctrl && input === 'c') {
      if (latest.current.asking) { client.send({ type: 'chat.cancel', qid: latest.current.asking.qid }); return true; }
      return false;
    }
    // The confirmation has the keys: y clears, n or esc keeps; nothing else goes through.
    if (confirm) {
      if (input === 'y') { client.send({ type: 'chat.reset' }); setConfirm(false); }
      else if (input === 'n' || key.escape) setConfirm(false);
      return true;
    }
    if (focus === CONVO) {
      if (input === 'k' || key.upArrow) { scroll(up + 1); return true; }
      if (input === 'j' || key.downArrow) { scroll(up - 1); return true; }
      if (input === 'G' || key.end) { setAnchor(null); return true; }
      if (key.escape) { setFocus(-1); return true; }
      return false;
    }
    if (focus < 0) return false;
    if (cards[focus]!.kind === 'action') return actionKey(cards[focus]!.qid, input, key);
    if (key.return) { act(cards[focus]!); return true; }
    // s saves a proposed ad hoc team as a template (« Enregistrer »).
    if (input === 's' && cards[focus]!.kind === 'team') {
      const team = d.chat.find(x => x.qid === cards[focus]!.qid)?.team;
      if (team && !team.template && !team.savedPath) client.send({ type: 'team.save', rid: randomUUID(), qid: cards[focus]!.qid, name: team.name, seats: team.seats.map(x => ({ role: x.role, tool: x.tool, ...(x.model ? { model: x.model } : {}), ...(x.effort ? { effort: x.effort } : {}) })) });
      return true;
    }
    if (key.escape) { setFocus(-1); return true; }
    return false;
  });

  // The keys follow the focus: s only on a team's card, ctrl+c only while Ledge answers.
  const stop = asking ? [['ctrl+c', t.keys.stopAnswer] as const] : [];
  const card = cards[focus];
  const review$ = ignored ? [['ctrl+r', t.keys.review] as const] : [];
  /** A focused generic card's keys, as its state allows. */
  const actionKeys = (qid: string): Array<readonly [string, string]> => {
    const turn = d.chat.find(x => x.qid === qid);
    if (!turn?.actions) return [];
    if (confirming?.qid === qid) return [['y', t.keys.apply], ['esc', t.keys.cancel]];
    const p = planOf(turn);
    const sel = selectedRow(p, rowOf[qid]);
    const r = p.rows[sel]!, s = p.shown[sel]!, many = p.rows.length > 1;
    const next = ['tab', focus + 1 < cards.length ? t.keys.nextCard : t.keys.conversation] as const;
    if (s === 'cut') return [['n', t.keys.deny], ['o', t.keys.openSession(r.target ?? '')], ['esc', t.keys.ignore], next, ['ctrl+n', t.keys.newChat]];
    if (!p.open.length) return [next, ['ctrl+n', t.keys.newChat], ['esc', t.keys.back]];
    return [['↵', many ? t.keys.applyRow : t.keys.apply], ...(many ? [['a', t.keys.applyAll] as const, ['↑ ↓', t.keys.line] as const] : []),
      ...(deniable(r, s) ? [['n', t.keys.deny] as const] : []), ['esc', t.keys.ignore], next, ['ctrl+n', t.keys.newChat]];
  };
  // What was asked: the conversation's questions, not only this run's.
  const history = askHistory(d.chat, kept.asked);
  const keys: Array<readonly [string, string]> = confirm ? [['n esc', t.keys.keep], ['y', t.keys.wipe]]
    : focus === -1 && browsing ? [['↵', t.keys.resend], ['↑ ↓', t.keys.history], ['esc', t.keys.backToDraft]]
    // ctrl+r near the front while a card is set aside: the bar drops what does not fit, from its end.
    : focus === -1 ? [['↵', t.keys.sendOnly], ...review$, ['alt+↵', t.keys.newLine], ['esc', t.keys.back], ['PgUp PgDn', t.keys.scroll], ['↑ ↓', t.keys.history], ['tab', cards.length ? t.keys.nextCard : t.keys.conversation], ['ctrl+n', t.keys.newChat], ...stop]
    : focus === CONVO ? [['j k', t.keys.line], ['PgUp PgDn', t.keys.page], ['G', t.keys.end], ...stop, ['tab', t.keys.question], ['esc', t.keys.question]]
    : card?.kind === 'action' ? [...actionKeys(card.qid), ...stop, ...review$]
    : [['↵', t.keys.send], ['tab', focus + 1 < cards.length ? t.keys.nextCard : t.keys.conversation], ...(card?.kind === 'team' ? [['s', t.keys.save] as const] : []), ['ctrl+n', t.keys.newChat], ...stop, ['esc', t.keys.back]];
  // Scrolled: how much is above and below, or that the answer goes on below; at the bottom, what is above.
  const foot = up > 0 ? (asking && live?.qid === asking.qid ? t.ask.answering : t.session.scrolled(lines.length - view - up, up))
    : lines.length > view ? (focus === CONVO ? t.session.above(lines.length - view) : t.ask.above(lines.length - view)) : undefined;
  const reading = focus === CONVO;
  return (
    <Frame crumb={`${t.tabs.ask}`} keys={keys} kept={draft !== ''}>
      <TitledBox title={t.ask.operator(sessions, Math.max(1, machines.length))} flexGrow={1} color={reading ? C.coral : C.line} titleColor={reading ? C.coral : C.dim}
        foot={foot} footColor={reading || up > 0 ? C.coral : C.faint}>
        {lines.length === 0 ? <Text color={C.faint}>{t.ask.empty}</Text>
          : <Lines lines={lines} up={up} onHeight={setView} />}
      </TitledBox>
      {cards.slice(0, 2).map((c, i) => {
        const turn = d.chat.find(x => x.qid === c.qid)!;
        if (c.kind !== 'action') return <CardBox key={`${c.kind}:${c.qid}`} card={c} turn={turn} focused={i === focus} busy={busy?.qid === c.qid} />;
        const p = planOf(turn);
        const sel = selectedRow(p, rowOf[c.qid]);
        return <ActionBox key={`action:${c.qid}`} turn={turn} plan={p} focused={i === focus} busy={busy?.qid === c.qid} sel={sel} confirming={confirming?.qid === c.qid ? confirming.rows : null} />;
      })}
      {confirm
        ? <TitledBox title={t.ask.resetTitle} color={C.red} titleColor={C.red} flexShrink={0}>
          <Text color={C.fg}>{t.ask.resetBody(d.chat.length, d.chat[0] ? clock(d.chat[0].askedAt) : '')}{draft.trim() ? ` ${t.ask.draftStays}` : ''}</Text>
          <Box marginTop={1} columnGap={2}><Button label={t.ask.keep} k="n · esc" primary /><Button label={t.ask.wipe} k="y" /></Box>
        </TitledBox>
        : <Field title={t.ask.question} value={draft} onChange={setDraft} onSubmit={ask} onEscape={() => { if (!draft) go('overview'); }} onBrowse={setBrowsing}
          history={history} active={focus === -1} placeholder={t.ask.placeholder} />}
    </Frame>
  );
}

function CardBox({ card, turn, focused, busy }: { card: Exclude<Card, { kind: 'action' }>; turn: ChatTurn; focused: boolean; busy: boolean }) {
  const { t, g } = useTui();
  const color = focused ? C.coral : C.line;
  if (card.kind === 'team') {
    const team = turn.team!;
    const auto = team.seats.filter(x => x.autonomy === 'auto').map(x => `@${x.role}`);
    return (
      <TitledBox title={t.ask.teamCard(team.name)} flexShrink={0} color={color} titleColor={C.coral}>
        <Text wrap="truncate"><Text color={C.dim}>{t.ask.folder.padEnd(13)}</Text><Text color={C.faint}>{team.cwd}</Text></Text>
        <Text wrap="truncate"><Text color={C.dim}>{t.ask.table.padEnd(13)}</Text>{g.team} {t.ask.newTable(team.projectName ?? team.project)}</Text>
        {team.seats.map(x => (
          <Text key={x.role} wrap="truncate"><Text color={C.dim}>{''.padEnd(13)}</Text><Text color={C.violet}>@{x.role}</Text> {x.label} <Text color={C.faint}>{[TOOL_NAME[x.tool], x.model, x.effort].filter(Boolean).join(' · ')}</Text> <Text color={x.autonomy === 'auto' ? C.yellow : C.faint}>{t.ask.autonomy[x.autonomy ?? 'ask']}</Text></Text>
        ))}
        {auto.length ? <Text color={C.yellow} wrap="truncate">{t.ask.autoWarning(auto.join(', '))}</Text> : null}
        {team.error ? <Text color={C.red} wrap="truncate">{team.error}</Text> : null}
        <Box columnGap={2}><Button label={busy ? `${g.live} ${t.ask.launchTeam}` : t.ask.launchTeam} k="↵" primary={focused} />{!team.template ? (team.savedPath ? <Text color={C.faint}>{t.ask.saved}</Text> : <Button label={t.ask.save} k="s" />) : null}<Text color={C.faint}>{t.ask.nothingWithoutYou}</Text></Box>
      </TitledBox>
    );
  }
  if (card.kind === 'task') {
    const tasks = turn.tasks!;
    const waits = !!turn.team && !turn.team.teamId;
    return (
      <TitledBox title={t.ask.taskCard} flexShrink={0} color={color} titleColor={C.violet}>
        {card.rows.map(r => { const c = tasks[r]!; return (
          <Text key={r} wrap="truncate"><Text color={C.fg}>{c.title}</Text> <Text color={C.faint}>{c.toName ?? c.to}</Text>{c.error ? <Text color={C.red}>  {c.error}</Text> : null}</Text>
        ); })}
        <Box columnGap={2}><Button label={busy ? `${g.live} ${t.ask.give}` : t.ask.give} k="↵" primary={focused && !waits} />{waits ? <Text color={C.faint}>{t.ask.waitTeam}</Text> : null}</Box>
      </TitledBox>
    );
  }
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
