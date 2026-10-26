import { randomUUID } from 'node:crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { daemonStore } from '@ledge/fleet';
import { LEDGE_GIVER, proposalRows, type ChatTurn } from '@ledge/protocol';
import { useEditing, useScreenKeys, useTui } from '../context.js';
import { chatLines, openCards, type Card } from '../model/chat.js';
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

/** A card's send is done when its turn changes, an error comes without a session id, or after this long. */
const CARD_MS = 20_000;

export function Ask() {
  const { client, d, machines, t, g, toast, go, kept } = useTui();
  const { columns } = useWindowSize();
  // Kept by the TUI: ctrl+c and another screen leave it as it is.
  const [draft, setDraftState] = useState(() => kept.drafts.get('ask') ?? '');
  const setDraft = (x: string) => { setDraftState(x); if (x) kept.drafts.set('ask', x); else kept.drafts.delete('ask'); };
  const [browsing, setBrowsing] = useState(false);
  // ctrl+n asks first: « Garder » by default.
  const [confirm, setConfirm] = useState(false);
  // -1: the question field; otherwise the index of the focused card.
  const [focus, setFocus] = useState(-1);
  const [busy, setBusy] = useState<{ qid: string; turn: ChatTurn | undefined; errorSeq: number; at: number } | null>(null);
  useEditing(focus === -1 && !confirm);

  const cards = useMemo(() => openCards(d.chat), [d.chat]);
  useEffect(() => { if (focus >= cards.length) setFocus(cards.length ? cards.length - 1 : -1); }, [cards.length, focus]);
  // A card in flight is free again once its turn moved, a refusal came, or nothing happened for a while.
  useEffect(() => {
    if (!busy) return;
    const turn = d.chat.find(x => x.qid === busy.qid);
    if (turn !== busy.turn || (d.errors.at(-1)?.seq ?? 0) > busy.errorSeq) { setBusy(null); return; }
    const timer = setTimeout(() => setBusy(null), Math.max(0, busy.at + CARD_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [busy, d.chat, d.errors]);

  const local = machines.find(m => m.id === 'local');
  const asking = d.chat.find(x => !x.answeredAt && !x.error);
  const ask = (text: string) => {
    if (!text.trim()) return;
    if (!local?.ready) { toast({ text: t.ask.offline, tone: 'info' }); return; }
    const qid = `q-${randomUUID()}`;
    daemonStore.beginTurn({ qid, question: text.trim(), askedAt: new Date().toISOString(), steps: [] });
    client.send({ type: 'chat.ask', qid, text: text.trim() });
    kept.sent.set('ask', [...(kept.sent.get('ask') ?? []), text.trim()]);
    setDraft('');
  };
  const act = (card: Card) => {
    if (busy) return;
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

  // ctrl+c stops the answer being written; ctrl+n starts a new conversation (once confirmed, when there is one); tab goes
  // from the field to the cards and back.
  const latest = useRef({ asking, cards, focus, confirm, turns: d.chat.length });
  latest.current = { asking, cards, focus, confirm, turns: d.chat.length };
  useInput((input, key) => {
    if (latest.current.confirm) return;
    if (key.ctrl && input === 'n') { if (latest.current.turns === 0) client.send({ type: 'chat.reset' }); else setConfirm(true); return; }
    if (key.tab) { const n = latest.current.cards.length; setFocus(f => (n === 0 ? -1 : f + 1 >= n ? -1 : f + 1)); }
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
    if (focus < 0) return false;
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

  const sessions = listed(d.sessions).length;
  const width = Math.max(20, columns - 6);
  // The streamed answer comes a few words at a time: drawn at most each 100 ms.
  const live = useThrottled(d.chatLive, 100);
  const lines = useMemo(() => chatLines(d.chat, live, { t, g, width }), [d.chat, live, t, g, width]);
  const keys: Array<readonly [string, string]> = confirm ? [['n esc', t.keys.keep], ['y', t.keys.wipe]]
    : focus === -1 && browsing ? [['↵', t.keys.resend], ['↑ ↓', t.keys.history], ['esc', t.keys.backToDraft]]
    : focus === -1 ? [['↵', t.keys.sendOnly], ['alt+↵', t.keys.newLine], ['esc', t.keys.back], ['↑ ↓', t.keys.history], ['tab', t.keys.nextCard], ['ctrl+n', t.keys.newChat], ['ctrl+c', t.keys.stopAnswer]]
    : [['↵', t.keys.send], ['tab', t.keys.nextCard], ['s', t.keys.save], ['ctrl+n', t.keys.newChat], ['ctrl+c', t.keys.stopAnswer], ['esc', t.keys.back]];
  return (
    <Frame crumb={`${t.tabs.ask}`} keys={keys} kept={draft !== ''}>
      <TitledBox title={t.ask.operator(sessions, Math.max(1, machines.length))} flexGrow={1}>
        {lines.length === 0 ? <Text color={C.faint}>{t.ask.empty}</Text>
          : <Lines lines={lines} />}
      </TitledBox>
      {cards.slice(0, 2).map((c, i) => <CardBox key={`${c.kind}:${c.qid}`} card={c} turn={d.chat.find(x => x.qid === c.qid)!} focused={i === focus} busy={busy?.qid === c.qid} />)}
      {confirm
        ? <TitledBox title={t.ask.resetTitle} color={C.red} titleColor={C.red} flexShrink={0}>
          <Text color={C.fg}>{t.ask.resetBody(d.chat.length, d.chat[0] ? clock(d.chat[0].askedAt) : '')}{draft.trim() ? ` ${t.ask.draftStays}` : ''}</Text>
          <Box marginTop={1} columnGap={2}><Button label={t.ask.keep} k="n · esc" primary /><Button label={t.ask.wipe} k="y" /></Box>
        </TitledBox>
        : <Field title={t.ask.question} value={draft} onChange={setDraft} onSubmit={ask} onEscape={() => { if (!draft) go('overview'); }} onBrowse={setBrowsing}
          history={kept.sent.get('ask') ?? []} active={focus === -1} placeholder={t.ask.placeholder} />}
    </Frame>
  );
}

function CardBox({ card, turn, focused, busy }: { card: Card; turn: ChatTurn; focused: boolean; busy: boolean }) {
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
