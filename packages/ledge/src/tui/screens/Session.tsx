import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { isPending, splitId } from '@ledge/fleet';
import { offers, type Pending, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { useEditing, useScreenKeys, useTui } from '../context.js';
import { machineLabel, modelLabel, paneName, TOOL_NAME } from '../model/labels.js';
import { pad, row, type Line } from '../model/cells.js';
import { threadView } from '../model/thread.js';
import { ago, oneLine } from '../model/time.js';
import { C, STATE_COLOR } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { ModelPicker } from '../ui/ModelPicker.js';
import { Button } from '../ui/SessionCard.js';
import { choices } from '../model/pending.js';
import { LineText, Lines } from '../ui/Lines.js';
import { useNow } from '../ui/now.js';
import { Tail } from '../ui/Tail.js';
import { Field } from '../ui/Field.js';
import { TitledBox } from '../ui/TitledBox.js';

type Mode = 'read' | 'reply' | 'note' | 'model';

export function SessionScreen() {
  const tui = useTui();
  const { selected: s, t } = tui;
  if (!s) return <Frame crumb="" keys={[['esc', t.keys.back]]}><Text color={C.faint}>{t.session.noSession}</Text></Frame>;
  return <SessionView key={s.id} s={s} />;
}

function SessionView({ s }: { s: Session }) {
  const { client, d, t, g, actions, attach, toast, machines, kept } = useTui();
  const { columns } = useWindowSize();
  const [mode, setMode] = useState<Mode>('read');
  // The draft outlives the field, the screen and ctrl+c: it is kept by the TUI, by session.
  const [draft, setDraftState] = useState(() => kept.drafts.get(s.id) ?? '');
  const setDraft = (x: string) => { setDraftState(x); if (x) kept.drafts.set(s.id, x); else kept.drafts.delete(s.id); };
  const [browsing, setBrowsing] = useState(false);
  const [diffs, setDiffs] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [terminal, setTerminal] = useState(false);
  // The line at the top of the box once scrolled, as an item and a line in it, so that a resize, a fold or new lines below
  // keep it in place; null follows the bottom of the thread.
  const [anchor, setAnchor] = useState<{ key: string; offset: number } | null>(null);
  useEditing(mode === 'reply' || mode === 'note');

  // The thread is asked once per opening (and again after a reconnect drops it); its items then arrive one by one.
  const items = d.threads.get(s.id);
  useEffect(() => { if (!items && !s.offline) client.send({ type: 'session.thread', id: s.id }); }, [items === undefined, s.id, d.snapshotSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const width = Math.max(20, columns - 6);
  // The clock is not in here: a running action's spinner and time tick on their own (ui/Lines.tsx).
  const { lines, keys: lineKeys } = useMemo(() => items ? threadView(items, { t, g, width, diffs, unfolded }) : { lines: [] as Line[], keys: [] as string[] }, [items, t, g, width, diffs, unfolded]);
  const p = s.pending;
  const [view, setView] = useState(10);
  const maxUp = Math.max(0, lines.length - view);
  const at = anchor ? lineKeys.indexOf(anchor.key) : -1;
  const up = at < 0 ? 0 : Math.min(maxUp, Math.max(0, lines.length - view - (at + anchor!.offset)));
  const scroll = (to: number) => {
    const u = Math.min(maxUp, Math.max(0, to));
    if (u === 0) { setAnchor(null); return; }
    const top = lines.length - view - u, key = lineKeys[top]!;
    setAnchor({ key, offset: top - lineKeys.indexOf(key) });
  };

  const machine = splitId(s.id)?.machine ?? 'local';
  const canSwitch = machines.find(m => m.id === machine)?.daemon?.modelSwitch === true;

  const send = (text: string) => {
    if (!text.trim()) { setMode('read'); return; }
    const back = (x: string) => { setDraft(x); };
    if (mode === 'note') actions.denyWithNote(s, text.trim(), back);
    else if (!actions.reply(s, text, back)) return;
    kept.sent.set(s.id, [...(kept.sent.get(s.id) ?? []), text]);
    setDraft(''); setMode('read');
  };
  // Out of the field, the draft stays (and says so).
  const leave = () => { setMode('read'); setBrowsing(false); if (draft.trim()) toast({ text: t.toast.draftKept, tone: 'quiet' }); };

  useScreenKeys((input, key) => {
    if (mode === 'model') return true;
    if (mode !== 'read') {
      // ctrl+c leaves the field (keeping the draft) instead of quitting.
      if (key.ctrl && input === 'c') { leave(); return true; }
      return false;
    }
    if (key.pageUp) { scroll(up + view - 1); return true; }
    if (key.pageDown) { scroll(up - view + 1); return true; }
    if (input === 'k' || key.upArrow) { scroll(up + 1); return true; }
    if (input === 'j' || key.downArrow) { scroll(up - 1); return true; }
    if (input === 'G' || key.end) { setAnchor(null); return true; }
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

  const title = `${s.name} · ${oneLine(s.topic ?? s.title)} · ${TOOL_NAME[s.tool]} · ${modelLabel(s, t.session.defaultModel)}`;
  const showsThread = mode !== 'model' && !terminal && !!items && lines.length > 0;
  const above = lines.length - view - up;
  const foot = up > 0 ? t.session.scrolled(above, up) : lines.length > view ? t.session.above(lines.length - view) : undefined;
  const keys: Array<readonly [string, string]> = mode === 'model' ? [['↑ ↓', t.keys.choose], ['← →', t.launch.effort], ['↵', t.keys.choose], ['esc', t.keys.cancel]]
    : mode !== 'read' && browsing ? [['↵', t.keys.resend], ['↑ ↓', t.keys.history], ['esc', t.keys.backToDraft]]
    : mode !== 'read' ? [['↵', t.keys.sendOnly], ['alt+↵', t.keys.newLine], ['esc', t.keys.keepAndLeave], ['↑ ↓', t.keys.lineHistory], ['ctrl ← →', t.keys.word], ['ctrl+u', t.keys.clear]]
    : [['esc', t.keys.back], ...(p ? [['y n A', t.keys.answer] as const] : []), ['r', t.keys.write], ['j k', t.keys.scroll], [t.keys.space, t.keys.unfold], ['d', t.keys.diffs], ['t', t.keys.terminal], ['a', t.keys.attach], ['m', t.keys.model], ['i', t.keys.interrupt]];
  return (
    <Frame crumb={`${s.repo ?? s.project}${s.branch ? ` › ${g.branch} ${s.branch}` : ''} › ${s.name} · ${machineLabel(s)}`} crumbShort={s.name} keys={keys} kept={draft !== ''}>
      <TitledBox title={terminal ? t.overview.terminal(paneName(s)) : title} flexGrow={1} minHeight={5} foot={showsThread ? foot : undefined}>
        {mode === 'model'
          ? <ModelPicker machine={machine} tool={s.tool} current={{ model: s.model ?? null, effort: s.effort ?? null }} onCancel={() => setMode('read')}
            onPick={pick => { client.send({ type: 'session.model', id: s.id, model: pick.model, effort: pick.effort }); toast({ text: t.toast.model(s.name, pick.model ?? t.session.defaultModel), tone: 'ok' }); setMode('read'); }} />
          : terminal ? <Tail lines={d.previews.get(s.id) ?? []} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
          : !items ? <Text color={C.faint}>{t.session.loading}</Text>
          : lines.length === 0 ? <Text color={C.faint}>{t.session.empty}</Text>
          : <Lines lines={lines} up={up} onHeight={setView} />}
      </TitledBox>
      {p ? <PendingBox s={s} p={p} width={Math.max(20, columns - 4)} /> : null}
      {mode === 'reply' || mode === 'note'
        ? <Field title={mode === 'note' ? t.session.noteTitle(s.name) : t.session.replyTitle(s.name)} value={draft} onChange={setDraft} onSubmit={send} onEscape={leave}
          onBrowse={setBrowsing} history={kept.sent.get(s.id) ?? []} active placeholder={mode === 'note' ? t.session.noteFor(s.name) : t.session.replyTo(s.name)} />
        // Read: the draft kept, its first line dimmed; or what r does.
        : <TitledBox title={draft ? t.session.writeDraft : t.keys.write} foot={draft ? t.session.draftLines(draft.split('\n').length) : undefined} flexShrink={0}>
          <Text wrap="truncate"><Text color={C.coral}>{g.cursor} </Text>{draft ? <Text color={C.dim}>{draft.split('\n')[0]}</Text> : <Text color={C.faint}>{t.session.replyTo(s.name)}</Text>}</Text>
        </TitledBox>}
    </Frame>
  );
}

/** What the session waits for: the request, folded at the box's width under an indent, at most four lines; how to answer. */
function PendingBox({ s, p, width }: { s: Session; p: Pending; width: number }) {
  const { t } = useTui();
  // The only part of the screen with the clock: « depuis 2 min ».
  const now = useNow();
  const state = botState(s);
  const more = { text: ' …', color: C.faint };
  const lines: Line[] = p.kind === 'question'
    ? row([], [{ text: oneLine(p.text), color: C.fg }], null, width, { max: 4, more })
    : [[{ text: `${t.session.wants(s.name)}${p.tool ? ' ' : ''}`, color: C.fg }, ...(p.tool ? [{ text: `(${p.tool})`, color: C.faint }] : []), { text: t.session.colon, color: C.fg }],
      ...row([pad(2)], [{ text: oneLine(p.text), color: C.fg, bold: true }], null, width, { max: 4, more })];
  return (
    <TitledBox title={t.session.since(t.state[state], ago(s.lastActivityAt, now, t.time))} color={isPending(s) ? C.red : C.line} titleColor={STATE_COLOR[state]} flexShrink={0}>
      {lines.map((l, i) => <LineText key={i} line={l} />)}
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
  );
}
