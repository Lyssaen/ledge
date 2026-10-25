import { randomUUID } from 'node:crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize } from 'ink';
import { daemonStore } from '@ledge/fleet';
import { proposalRows, type ChatTurn } from '@ledge/protocol';
import { useEditing, useScreenKeys, useTui } from '../context.js';
import { chatLines, openCards, type Card } from '../model/chat.js';
import { TOOL_NAME } from '../model/labels.js';
import { listed } from '../model/overview.js';
import { oneLine } from '../model/time.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { Button } from '../ui/SessionCard.js';
import { Lines } from '../ui/Lines.js';
import { TextInput } from '../ui/TextInput.js';
import { TitledBox } from '../ui/TitledBox.js';

/** A card's send is done when its turn changes, an error comes without a session id, or after this long. */
const CARD_MS = 20_000;

export function Ask() {
  const { client, d, machines, t, g, toast, go } = useTui();
  const { columns } = useWindowSize();
  const [draft, setDraft] = useState('');
  // -1: the question field; otherwise the index of the focused card.
  const [focus, setFocus] = useState(-1);
  const [busy, setBusy] = useState<{ qid: string; turn: ChatTurn | undefined; errorSeq: number; at: number } | null>(null);
  useEditing(focus === -1);

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
    setDraft('');
  };
  const act = (card: Card) => {
    if (busy) return;
    const turn = d.chat.find(x => x.qid === card.qid);
    if (!turn) return;
    setBusy({ qid: card.qid, turn, errorSeq: d.errors.at(-1)?.seq ?? 0, at: Date.now() });
    if (card.kind === 'launch') {
      const first = proposalRows(turn)[card.rows[0]!]!;
      client.send({ type: 'session.launch', tool: first.tool, cwd: first.cwd, ...(first.prompt ? { prompt: first.prompt } : {}), qid: card.qid, rows: card.rows });
    } else if (card.kind === 'relay') client.send({ type: turn.relay?.status === 'queued' ? 'session.relay.cancel' : 'session.relay', qid: card.qid });
    else client.send({ type: 'session.close', qid: card.qid, rows: card.rows });
  };

  // ctrl+c stops the answer being written; ctrl+n starts a new conversation; tab goes from the field to the cards and back.
  const latest = useRef({ asking, cards, focus });
  latest.current = { asking, cards, focus };
  useInput((input, key) => {
    if (key.ctrl && input === 'n') { client.send({ type: 'chat.reset' }); return; }
    if (key.tab) { const n = latest.current.cards.length; setFocus(f => (n === 0 ? -1 : f + 1 >= n ? -1 : f + 1)); }
  });
  useScreenKeys((input, key) => {
    if (key.ctrl && input === 'c') {
      if (latest.current.asking) { client.send({ type: 'chat.cancel', qid: latest.current.asking.qid }); return true; }
      return false;
    }
    if (focus < 0) return false;
    if (key.return) { act(cards[focus]!); return true; }
    if (key.escape) { setFocus(-1); return true; }
    return false;
  });

  const sessions = listed(d.sessions).length;
  const width = Math.max(20, columns - 6);
  const lines = useMemo(() => chatLines(d.chat, d.chatLive, { t, g, width }), [d.chat, d.chatLive, t, g, width]);
  return (
    <Frame crumb={`${t.tabs.ask}`} keys={[['↵', t.keys.send], ['tab', t.keys.nextCard], ['ctrl+n', t.keys.newChat], ['ctrl+c', t.keys.stopAnswer], ['esc', t.keys.back]]}>
      <TitledBox title={t.ask.title(sessions, Math.max(1, machines.length))} flexGrow={1}>
        {lines.length === 0 ? <Text color={C.faint}>{t.ask.empty}</Text>
          : <Lines lines={lines} />}
      </TitledBox>
      {cards.slice(0, 2).map((c, i) => <CardBox key={`${c.kind}:${c.qid}`} card={c} turn={d.chat.find(x => x.qid === c.qid)!} focused={i === focus} busy={busy?.qid === c.qid} />)}
      <TitledBox title={t.ask.question} color={focus === -1 ? C.coral : C.line}>
        <Text wrap="truncate"><Text color={C.coral}>{g.cursor} </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={ask} onEscape={() => { if (!draft) go('overview'); }} active={focus === -1} />
        </Text>
      </TitledBox>
    </Frame>
  );
}

function CardBox({ card, turn, focused, busy }: { card: Card; turn: ChatTurn; focused: boolean; busy: boolean }) {
  const { t, g } = useTui();
  const color = focused ? C.coral : C.line;
  if (card.kind === 'launch') {
    const rows = proposalRows(turn);
    return (
      <TitledBox title={t.ask.launchCard} color={color} titleColor={C.coral}>
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
      <TitledBox title={t.ask.relayCard(r.name)} color={color} titleColor={C.violet}>
        <Text wrap="truncate" color={C.fg}>{oneLine(r.text)}</Text>
        {r.error ? <Text color={C.red} wrap="truncate">{r.error}</Text> : null}
        <Box columnGap={2}><Button label={r.status === 'queued' ? t.ask.cancelRelay : t.ask.relay} k="↵" primary={focused} />{r.status === 'queued' ? <Text color={C.faint}>{t.ask.queued}</Text> : null}</Box>
      </TitledBox>
    );
  }
  const closes = turn.closes ?? [];
  return (
    <TitledBox title={t.ask.closeCard} color={color} titleColor={C.red}>
      {card.rows.map(r => <Text key={r} wrap="truncate"><Text color={C.fg}>{closes[r]!.name}</Text> <Text color={C.faint}>{TOOL_NAME[closes[r]!.tool]}</Text>{closes[r]!.error ? <Text color={C.red}>  {closes[r]!.error}</Text> : null}</Text>)}
      <Box columnGap={2}><Button label={t.ask.close} k="↵" primary={focused} /></Box>
    </TitledBox>
  );
}
