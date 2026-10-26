import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { isPending, splitId } from '@ledge/fleet';
import { offers, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { useEditing, useScreenKeys, useTui } from '../context.js';
import { machineLabel, modelLabel, paneName, TOOL_NAME } from '../model/labels.js';
import { threadLines, type Line } from '../model/thread.js';
import { ago, oneLine } from '../model/time.js';
import { C, STATE_COLOR } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { ModelPicker } from '../ui/ModelPicker.js';
import { Button } from '../ui/SessionCard.js';
import { choices } from '../model/pending.js';
import { Lines } from '../ui/Lines.js';
import { Tail } from '../ui/Tail.js';
import { TextInput } from '../ui/TextInput.js';
import { TitledBox } from '../ui/TitledBox.js';

type Mode = 'read' | 'reply' | 'note' | 'model';

export function SessionScreen() {
  const tui = useTui();
  const { selected: s, t } = tui;
  if (!s) return <Frame crumb="" keys={[['esc', t.keys.back]]}><Text color={C.faint}>{t.session.noSession}</Text></Frame>;
  return <SessionView key={s.id} s={s} />;
}

function SessionView({ s }: { s: Session }) {
  const { client, d, t, g, now, actions, attach, toast, machines } = useTui();
  const { columns } = useWindowSize();
  const [mode, setMode] = useState<Mode>('read');
  const [draft, setDraft] = useState('');
  const [diffs, setDiffs] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [terminal, setTerminal] = useState(false);
  // Lines scrolled up from the bottom; 0 follows the thread.
  const [up, setUp] = useState(0);
  useEditing(mode === 'reply' || mode === 'note');

  // The thread is asked once per opening (and again after a reconnect drops it); its items then arrive one by one.
  const items = d.threads.get(s.id);
  useEffect(() => { if (!items && !s.offline) client.send({ type: 'session.thread', id: s.id }); }, [items === undefined, s.id, d.snapshotSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const width = Math.max(20, columns - 6);
  const lines: Line[] = useMemo(() => items ? threadLines(items, { t, g, now, width, diffs, unfolded }) : [], [items, t, g, now, width, diffs, unfolded]);
  const p = s.pending;
  const [view, setView] = useState(10);
  const maxUp = Math.max(0, lines.length - view);

  const machine = splitId(s.id)?.machine ?? 'local';
  const canSwitch = machines.find(m => m.id === machine)?.daemon?.modelSwitch === true;

  const send = (text: string) => {
    if (!text.trim()) { setMode('read'); return; }
    const back = (x: string) => { setDraft(x); };
    if (mode === 'note') actions.denyWithNote(s, text.trim(), back);
    else if (!actions.reply(s, text, back)) return;
    setDraft(''); setMode('read');
  };

  useScreenKeys((input, key) => {
    if (mode === 'model') return true;
    if (mode !== 'read') {
      // ctrl+c leaves the field (keeping the draft) instead of quitting.
      if (key.ctrl && input === 'c') { setMode('read'); return true; }
      return false;
    }
    if (key.pageUp) { setUp(u => Math.min(maxUp, u + view - 1)); return true; }
    if (key.pageDown) { setUp(u => Math.max(0, u - view + 1)); return true; }
    if (input === 'k' || key.upArrow) { setUp(u => Math.min(maxUp, u + 1)); return true; }
    if (input === 'j' || key.downArrow) { setUp(u => Math.max(0, u - 1)); return true; }
    if (input === 'G' || key.end) { setUp(0); return true; }
    if (input === ' ') { setUnfolded(u => !u); return true; }
    if (input === 'd') { setDiffs(x => !x); return true; }
    if (input === 't') { setTerminal(x => !x); return true; }
    if (input === 'a') { attach(s); return true; }
    if (input === 'i') { actions.interrupt(s); return true; }
    if (input === 'm') {
      if (!canSwitch) toast({ text: t.toast.modelSwitch, tone: 'info' }); else setMode('model');
      return true;
    }
    if (input === 'r' || key.return) {
      if (s.offline) { toast({ text: t.toast.offline(s.name), tone: 'info' }); return true; }
      if (s.source === 'hook_only') { toast({ text: t.toast.readOnly(s.name), tone: 'info' }); return true; }
      const note = p && p.kind !== 'question' && input === 'r';
      if (note && !offers(s.tool, p.kind, 'note')) { toast({ text: t.toast.noNote(s.name), tone: 'info' }); return true; }
      // Enter on a permission does nothing: y or n answers it, r explains a refusal.
      if (p && p.kind !== 'question' && !note) return true;
      setMode(note ? 'note' : 'reply');
      return true;
    }
    if (/^[1-9]$/.test(input) && p?.kind !== 'question') return false;
    if (input === 'y' || input === 'n' || input === 'A' || /^[1-9]$/.test(input)) return actions.key(s, input);
    return false;
  });

  const state = botState(s);
  const title = `${s.name} · ${oneLine(s.topic ?? s.title)} · ${TOOL_NAME[s.tool]} · ${modelLabel(s, t.session.defaultModel)}`;
  const keys: Array<readonly [string, string]> = mode === 'model' ? [['↑ ↓', t.keys.choose], ['← →', t.launch.effort], ['↵', t.keys.choose], ['esc', t.keys.cancel]]
    : mode !== 'read' ? [['↵', t.keys.send], ['esc', t.keys.back]]
    : [['esc', t.keys.back], ...(p ? [['y n A', t.keys.answer] as const] : []), ['r', t.keys.write], ['j k', t.keys.scroll], [t.keys.space, t.keys.unfold], ['d', t.keys.diffs], ['t', t.keys.terminal], ['a', t.keys.attach], ['m', t.keys.model], ['i', t.keys.interrupt]];
  return (
    <Frame crumb={`${s.repo ?? s.project}${s.branch ? ` › ${g.branch} ${s.branch}` : ''} › ${s.name} · ${machineLabel(s)}`} keys={keys}>
      <TitledBox title={terminal ? t.overview.terminal(paneName(s)) : title} flexGrow={1}>
        {mode === 'model'
          ? <ModelPicker machine={machine} tool={s.tool} current={{ model: s.model ?? null, effort: s.effort ?? null }} onCancel={() => setMode('read')}
            onPick={pick => { client.send({ type: 'session.model', id: s.id, model: pick.model, effort: pick.effort }); toast({ text: t.toast.model(s.name, pick.model ?? t.session.defaultModel), tone: 'ok' }); setMode('read'); }} />
          : terminal ? <Tail lines={d.previews.get(s.id) ?? []} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
          : !items ? <Text color={C.faint}>{t.session.loading}</Text>
          : lines.length === 0 ? <Text color={C.faint}>{t.session.empty}</Text>
          : <Lines lines={lines} up={up} onHeight={setView} />}
      </TitledBox>
      {p ? (
        <TitledBox title={t.session.since(t.state[state], ago(s.lastActivityAt, now, t.time))} color={isPending(s) ? C.red : C.line} titleColor={STATE_COLOR[state]}>
          <Text wrap="truncate"><Text color={C.fg}>{p.kind === 'question' ? oneLine(p.text) : `${t.session.wantsTo(s.name)} `}</Text>{p.kind !== 'question' ? <Text color={C.fg} bold>{oneLine(p.text)}</Text> : null}{p.tool ? <Text color={C.faint}>   {p.tool}</Text> : null}</Text>
          <Box marginTop={1} columnGap={2} flexWrap="wrap">
            {p.kind === 'question'
              ? choices(p).slice(0, 9).map((c, i) => <Button key={c.n} label={`${c.n} · ${c.label}`} k={String(c.n)} primary={i === 0} />)
              : <>
                <Button label={t.overview.allow} k="y" primary />
                <Button label={t.overview.deny} k="n" />
                {offers(s.tool, p.kind, 'always') ? <Button label={t.overview.always} k="A" /> : null}
                {offers(s.tool, p.kind, 'note') ? <Button label={t.overview.denyWithNote} k="r" /> : null}
              </>}
          </Box>
        </TitledBox>
      ) : null}
      <TitledBox title={mode === 'note' ? t.overview.denyWithNote : t.keys.write} color={mode === 'read' ? C.line : C.coral}>
        {/* The field is its own Text: inside another, the outer one's truncation would cut the end being typed. */}
        <Box><Text color={C.coral}>{g.cursor} </Text>
          <Box flexGrow={1} overflow="hidden">
            <TextInput value={draft} onChange={setDraft} onSubmit={send} onEscape={() => setMode('read')} active={mode === 'reply' || mode === 'note'}
              placeholder={mode === 'note' ? t.session.noteFor(s.name) : t.session.replyTo(s.name)} />
          </Box>
        </Box>
      </TitledBox>
    </Frame>
  );
}
