import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { isPending, putImage, sayToLedge, splitId, useColorPreview } from '@ledge/fleet';
import { offers, type Pending, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { useEditing, useScreenKeys, useScreenSize, useTui } from '../context.js';
import { ChipsLine, useChips, useOpenImage, usePaste } from '../images.js';
import { machineLabel, modelLabel, paneName, TOOL_NAME } from '../model/labels.js';
import { cells, pad, row, type Line } from '../model/cells.js';
import { anchorLine, threadImages, threadView } from '../model/thread.js';
import { ago, oneLine } from '../model/time.js';
import { C, STATE_COLOR } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { ModelPicker } from '../ui/ModelPicker.js';
import { Button } from '../ui/SessionCard.js';
import { choices } from '../model/pending.js';
import { LineText, Lines } from '../ui/Lines.js';
import { useNow } from '../ui/now.js';
import { Tail } from '../ui/Tail.js';
import { Field, fieldRows } from '../ui/Field.js';
import { layout } from '../model/field.js';
import type { Messages } from '../i18n/lang.js';
import { OmpBox } from '../ui/OmpBox.js';
import { TitledBox } from '../ui/TitledBox.js';

type Mode = 'read' | 'reply' | 'note' | 'model';

export function SessionScreen() {
  const tui = useTui();
  const { selected: s, t } = tui;
  if (!s) return <Frame crumb="" keys={[['esc', t.keys.back]]}><Text color={C.faint}>{t.session.noSession}</Text></Frame>;
  return <SessionView key={s.id} s={s} />;
}

function SessionView({ s }: { s: Session }) {
  const { client, d, t, g, actions, attach, toast, machines, kept, lastToast, tone, rigs, setFocus, go } = useTui();
  const { columns, rows } = useScreenSize();
  const [mode, setMode] = useState<Mode>('read');
  // The draft outlives the field, the screen and ctrl+c: it is kept by the TUI, by session.
  const [draft, setDraftState] = useState(() => kept.drafts.get(s.id) ?? '');
  const setDraft = (x: string) => { setDraftState(x); if (x) kept.drafts.set(s.id, x); else kept.drafts.delete(s.id); };
  const [browsing, setBrowsing] = useState(false);
  const [diffs, setDiffs] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const [terminal, setTerminal] = useState(false);
  const colored = useColorPreview(client, terminal && s.tool !== 'omp' ? s.id : null);
  // The line at the top of the box once scrolled, as an item and a line in it, so that a resize, a fold or new lines below
  // keep it in place; null follows the bottom of the thread.
  const [anchor, setAnchor] = useState<{ key: string; offset: number } | null>(null);
  useEditing(mode === 'reply' || mode === 'note');

  // The thread is asked once per opening (and again after a reconnect drops it); its items then arrive one by one.
  const items = d.threads.get(s.id);
  useEffect(() => { if (!items && !s.offline) client.send({ type: 'session.thread', id: s.id }); }, [items === undefined, s.id, d.snapshotSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  const width = Math.max(20, columns - 6);
  // The clock is not in here: a running action's spinner and time tick on their own (ui/Lines.tsx).
  const thread = useMemo(() => items ? threadView(items, { t, g, width, diffs, unfolded }) : { lines: [] as Line[], keys: [] as string[], turns: new Map<string, string>() }, [items, t, g, width, diffs, unfolded, tone]);
  const { lines, keys: lineKeys } = thread;
  const p = s.pending;
  const [view, setView] = useState(10);
  const maxUp = Math.max(0, lines.length - view);
  // The anchored item folded away (space), its turn's line stays at the top.
  const at = anchor ? anchorLine(thread, anchor) : -1;
  const up = at < 0 ? 0 : Math.min(maxUp, Math.max(0, lines.length - view - at));
  const scroll = (to: number) => {
    const u = Math.min(maxUp, Math.max(0, to));
    if (u === 0) { setAnchor(null); return; }
    const top = lines.length - view - u, key = lineKeys[top]!;
    setAnchor({ key, offset: top - lineKeys.indexOf(key) });
  };

  const images = useMemo(() => (items ? threadImages(items, unfolded) : []).map(ref => ({ ref, route: { id: s.id } })), [items, unfolded, s.id]);
  const chips = useChips(image => putImage(client, image, { id: s.id }));
  const paste = usePaste(chips);
  const openImage = useOpenImage();

  const machine = splitId(s.id)?.machine ?? 'local';
  // A rig seat: written to through Ledge (`@seat@rig`, always the long form), its lifecycle left to OpenRig.
  const seat = s.rig ? (() => {
    const r = s.rig!, mine = rigs.find(x => x.machine === r.machine && x.id === r.rigId);
    const address = mine?.seats.find(x => x.ref === r.seat)?.address ?? `@${r.member}`;
    return { rigId: r.rigId, rigName: r.rigName, machine: r.machine, address, long: `${address}@${mine?.name ?? r.rigName}`, remote: r.machine !== 'local', label: `${g.rig} ${r.rigName}` };
  })() : null;
  const canSwitch = machines.find(m => m.id === machine)?.daemon?.modelSwitch === true;

  /** false when refused at once: the field keeps the text. */
  const send = (text: string, { fromHistory }: { fromHistory: boolean }): boolean => {
    const withImages = mode === 'reply' && !seat && !fromHistory && chips.items.length > 0;
    if (!text.trim() && !withImages) { setMode('read'); return true; }
    // An image still uploading or refused holds the send; a dialog question takes words only, the image waits.
    if (withImages && !chips.ready) return false;
    if (withImages && p?.kind === 'question') { toast({ text: t.images.dialog, tone: 'info' }); return false; }
    // Refused later, the text comes back as the draft, unless a draft was typed since: it stays, the text is one ↑ away.
    const taken = withImages ? chips.clear() : [];
    const back = (x: string) => { if (!kept.drafts.get(s.id)) setDraft(x); if (taken.length) chips.putBack(taken); };
    const how = taken.length ? { attachments: taken.flatMap(c => (c.id ? [c.id] : [])) } : undefined;
    if (seat && mode === 'reply') {
      sayToLedge(client, `${seat.long} ${text.trim()}`);
      kept.sent.set(s.id, [...(kept.sent.get(s.id) ?? []), text]);
      if (!fromHistory) setDraft('');
      setMode('read');
      return true;
    }
    if (!(mode === 'note' ? actions.denyWithNote(s, text.trim(), back) : actions.reply(s, text, back, how))) { if (taken.length) chips.putBack(taken); return false; }
    if (text.trim()) kept.sent.set(s.id, [...(kept.sent.get(s.id) ?? []), text]);
    // An entry of the history sent again leaves the draft as it was.
    if (!fromHistory) setDraft('');
    setMode('read');
    return true;
  };
  // Out of the field, the draft stays (and says so).
  const leave = () => { setMode('read'); setBrowsing(false); if (draft.trim()) toast({ text: t.toast.draftKept, tone: 'quiet' }); };

  // Alt+V pastes the clipboard picture; backspace on an empty field takes the last chip back. (The field ignores these keys.)
  useInput((input, key) => {
    if (key.meta && input === 'v') paste();
    else if ((key.backspace || key.delete) && draft === '') chips.removeLast();
  }, { isActive: mode === 'reply' && !seat });

  useScreenKeys((input, key) => {
    if (mode === 'model') return true;
    if (mode !== 'read') {
      // ctrl+c leaves the field (keeping the draft) instead of quitting.
      if (key.ctrl && input === 'c') { leave(); return true; }
      // Too small, the field is not drawn (the app sends esc here only then): esc leaves it.
      if (key.escape) { leave(); return true; }
      return false;
    }
    if (key.leftArrow && seat) { setFocus({ kind: 'rig', machine: seat.machine, rigId: seat.rigId }); go('home'); return true; }
    // The OMP pane (t) scrolls itself.
    if (terminal && s.tool === 'omp') return false;
    if (key.pageUp) { scroll(up + view - 1); return true; }
    if (key.pageDown) { scroll(up - view + 1); return true; }
    if (input === 'k' || key.upArrow) { scroll(up + 1); return true; }
    if (input === 'j' || key.downArrow) { scroll(up - 1); return true; }
    if (input === 'G' || key.end) { setAnchor(null); return true; }
    if (input === ' ') { setUnfolded(u => !u); return true; }
    if (input === 'd') { setDiffs(x => !x); return true; }
    if (input === 't') { setTerminal(x => !x); return true; }
    if (input === 'o' && images.length) { openImage(images); return true; }
    if (input === 'a') { attach(s); return true; }
    if (input === 'i') { actions.interrupt(s); return true; }
    // A rig seat's model is OpenRig's (the daemon refuses session.model with rig_managed): no m.
    if (input === 'm' && !s.rig) {
      if (!canSwitch) toast({ text: t.toast.modelSwitch, tone: 'info' }); else setMode('model');
      return true;
    }
    if (input === 'r' || key.return) {
      // The local daemon only resolves its own seats: a remote rig's seat is written to from its own machine.
      if (seat?.remote && !(p && p.kind !== 'question' && input === 'r' && offers(s.tool, p.kind, 'note'))) { if (!(p && p.kind !== 'question')) toast({ text: t.session.seatRemote, tone: 'info' }); return true; }
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

  const title = `${seat ? `${s.name} · ${seat.address} · ${seat.label}` : `${s.name} · ${oneLine(s.topic ?? s.title)}`} · ${TOOL_NAME[s.tool]} · ${modelLabel(s, t.session.defaultModel)}`;
  const showsThread = mode !== 'model' && !terminal && !!items && lines.length > 0;
  const above = lines.length - view - up;
  const foot = up > 0 ? t.session.scrolled(above, up) : lines.length > view ? t.session.above(lines.length - view) : undefined;
  const keys: Array<readonly [string, string]> = mode === 'model' ? [['↑ ↓', t.keys.choose], ['← →', t.launch.effort], ['↵', t.keys.choose], ['esc', t.keys.cancel]]
    : mode !== 'read' && browsing ? [['↵', t.keys.resend], ['↑ ↓', t.keys.history], ['esc', t.keys.backToDraft]]
    : mode !== 'read' ? [['↵', t.keys.sendOnly], ...(mode === 'reply' && !seat ? [['alt+v', t.keys.image] as const] : []), ['alt+↵', t.keys.newLine], ['esc', t.keys.keepAndLeave], ['↑ ↓', t.keys.lineHistory], ['ctrl ← →', t.keys.word], ['ctrl+u', t.keys.clear]]
    : [['esc', t.keys.back], ...(seat ? [['←', seat.label] as const] : []), ...(p ? [['y n A', t.keys.answer] as const] : []), ['r', t.keys.write], ['j k', t.keys.scroll], [t.keys.space, t.keys.unfold], ['d', t.keys.diffs], ['t', t.keys.terminal], ['a', t.keys.attach], ...(s.rig ? [] : [['m', t.keys.model] as const]), ['i', t.keys.interrupt], ...(images.length ? [['o', t.keys.openImage] as const] : [])];
  // The rows, in this order: the request (its keys left out while writing), the field, the thread with what is left, drawn
  // only with room for a line. The request is cut only when even that does not fit.
  const editing = mode === 'reply' || mode === 'note';
  const body = rows - 2 - (lastToast ? 1 : 0);
  const inner = Math.max(20, columns - 4);
  // The field as high as its text, up to its most (its prefix and the cursor's cell kept, as it lays itself out); the images
  // pasted take a line above it.
  const below = (editing ? Math.min(fieldRows(columns, rows), layout(draft, Math.max(10, columns - 4) - 2).length) + 2 : 3) + (chips.items.length ? 1 : 0);
  let request = p ? ask(s, p, t, inner, 4, !editing) : null;
  const over = request ? askRows(request, inner) + below - body : 0;
  if (p && request && over > 0) request = ask(s, p, t, inner, Math.max(1, 4 - over), !editing);
  const room = body - below - (request ? askRows(request, inner) : 0);
  const drawsThread = mode === 'model' || room >= 3;
  return (
    <Frame crumb={seat ? `${t.home.rigs} › ${seat.label} › ${seat.address} › ${s.name} · ${machineLabel(s)}` : `${s.repo ?? s.project}${s.branch ? ` › ${g.branch} ${s.branch}` : ''} › ${s.name} · ${machineLabel(s)}`} crumbShort={s.name} keys={keys} kept={draft !== ''}>
      {drawsThread && terminal && s.tool === 'omp' && mode !== 'model' ? <OmpBox key={s.id} s={s} /> : drawsThread ? <TitledBox title={terminal ? `${t.overview.terminal(paneName(s))}${colored ? ` ${t.overview.inColor}` : ''}` : title} flexGrow={1} minHeight={3} foot={showsThread ? foot : undefined}>
        {mode === 'model'
          ? <ModelPicker machine={machine} tool={s.tool} current={{ model: s.model ?? null, effort: s.effort ?? null }} onCancel={() => setMode('read')}
            onPick={pick => { client.send({ type: 'session.model', id: s.id, model: pick.model, effort: pick.effort }); toast({ text: t.toast.model(s.name, pick.model ?? t.session.defaultModel), tone: 'ok' }); setMode('read'); }} />
          : terminal ? <Tail lines={colored ?? d.previews.get(s.id) ?? []} ansi={colored !== undefined} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
          : !items ? <Text color={C.faint}>{t.session.loading}</Text>
          : lines.length === 0 ? <Text color={C.faint}>{t.session.empty}</Text>
          : <Lines lines={lines} up={up} onHeight={setView} />}
      </TitledBox> : null}
      {p && request ? <PendingBox s={s} a={request} /> : null}
      <ChipsLine chips={chips.items} />
      {mode === 'reply' || mode === 'note'
        ? <Field title={mode === 'note' ? t.session.noteTitle(s.name) : seat ? t.session.seatTitle(s.name, seat.address, seat.rigName) : t.session.replyTitle(s.name)} value={draft} onChange={setDraft} onSubmit={send} onEscape={leave}
          onBrowse={setBrowsing} history={kept.sent.get(s.id) ?? []} active placeholder={mode === 'note' ? t.session.noteFor(s.name) : seat ? t.session.seatPlaceholder(s.name) : t.session.replyTo(s.name)} foot={seat && mode === 'reply' ? t.session.seatFoot : undefined} />
        // Read: the draft kept, its first line dimmed; or what r does.
        : <TitledBox title={draft ? t.session.writeDraft : seat && !seat.remote ? t.session.seatTitle(s.name, seat.address, seat.rigName) : t.keys.write} foot={draft ? t.session.draftLines(draft.split('\n').length) : seat && !seat.remote ? t.session.seatFoot : undefined} flexShrink={0}>
          <Text wrap="truncate"><Text color={C.coral}>{g.cursor} </Text>{draft ? <Text color={C.dim}>{draft.split('\n')[0]}</Text> : <Text color={C.faint}>{seat ? (seat.remote ? t.session.seatRemote : t.session.seatPlaceholder(s.name)) : t.session.replyTo(s.name)}</Text>}</Text>
        </TitledBox>}
    </Frame>
  );
}

export type Ask = { lines: Line[]; buttons: Array<{ label: string; k: string; primary?: boolean }> };

/** The request folded at `width` under an indent, at most `max` lines, and the keys that answer it (none while a field is
 *  open: the field has the keyboard). */
function ask(s: Session, p: Pending, t: Messages, width: number, max: number, buttons: boolean): Ask {
  const more = { text: ' …', color: C.faint };
  const lines: Line[] = p.kind === 'question'
    ? row([], [{ text: oneLine(p.text), color: C.fg }], null, width, { max, more })
    : [[{ text: `${t.session.wants(s.name)}${p.tool ? ' ' : ''}`, color: C.fg }, ...(p.tool ? [{ text: `(${p.tool})`, color: C.faint }] : []), { text: t.session.colon, color: C.fg }],
      ...row([pad(2)], [{ text: oneLine(p.text), color: C.fg, bold: true }], null, width, { max, more })];
  const all = !buttons ? [] : p.kind === 'question'
    ? choices(p).slice(0, 9).map((c, i) => ({ label: `${c.n} · ${c.label}`, k: String(c.n), primary: i === 0 }))
    : [{ label: t.overview.allow, k: 'y', primary: true }, { label: t.overview.deny, k: 'n' },
      ...(offers(s.tool, p.kind, 'always') ? [{ label: t.overview.always, k: 'A' }] : []),
      ...(offers(s.tool, p.kind, 'note') ? [{ label: t.overview.denyWithNote, k: 'r' }] : [])];
  return { lines, buttons: all };
}

/** The rows the request's box takes: its borders, its lines, then a blank row and its keys, wrapped as Ink wraps them. */
export function askRows(a: Ask, width: number): number {
  let rows = 0, used = Infinity;
  for (const b of a.buttons) {
    const w = cells(b.label) + cells(b.k) + 3;
    // A key wider than the box wraps on as many rows.
    if (used + 2 + w > width) { rows += Math.max(1, Math.ceil(w / width)); used = Math.min(w, width); } else used += 2 + w;
  }
  return 2 + a.lines.length + (rows ? 1 + rows : 0);
}

/** What the session waits for: the request and how to answer. */
function PendingBox({ s, a }: { s: Session; a: Ask }) {
  const { t } = useTui();
  // The only part of the screen with the clock: « depuis 2 min ».
  const now = useNow();
  const state = botState(s);
  return (
    <TitledBox title={t.session.since(t.state[state], ago(s.lastActivityAt, now, t.time))} color={isPending(s) ? C.red : C.line} titleColor={STATE_COLOR[state]} flexShrink={0}>
      {a.lines.map((l, i) => <LineText key={i} line={l} />)}
      {a.buttons.length ? (
        <Box marginTop={1} columnGap={2} flexWrap="wrap">
          {a.buttons.map(b => <Button key={b.k} label={b.label} k={b.k} primary={b.primary} />)}
        </Box>
      ) : null}
    </TitledBox>
  );
}
