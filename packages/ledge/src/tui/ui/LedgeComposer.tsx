import { useEffect, useState, type MutableRefObject } from 'react';
import { Box, Text } from 'ink';
import { useTui, type KeyHandler } from '../context.js';
import { seatStateLabel } from '../model/left.js';
import { completeMention, mentionAt, mentionCandidates, mostActiveRig } from '../model/mention.js';
import { C } from '../theme.js';
import { Field } from './Field.js';
import { TitledBox } from './TitledBox.js';

/** The `@` list shows this many seats at most (its box, five lines). */
const LIST_ROWS = 3;
/** From this many columns for the field, its whole foot. */
const FULL_FOOT = 80;

export interface LedgeComposerProps {
  draft: string;
  setDraft(text: string): void;
  /** The field has the keyboard. */
  active: boolean;
  /** Going through what was sent (the field shows an entry, not the draft): no `@` list. */
  browsing: boolean;
  onBrowse(on: boolean): void;
  history: readonly string[];
  title: string;
  /** Sends what the field holds (↵); false when refused, the field keeping it. */
  onSubmit(text: string, o: { fromHistory: boolean }): boolean;
  /** Sends a suggestion as it reads, the draft left as it is. */
  onSay(text: string): void;
  onEscape(): void;
  /** The cells inside the field's box. */
  width: number;
  /** Its keys, asked first by Ledge's conversation: alt+1…4 the suggestions; with the `@` list open, ↑ ↓ choose and tab completes. */
  keys: MutableRefObject<KeyHandler | null>;
  /** Whether the `@` list is open, for the key bar. */
  onList(open: boolean): void;
}

/**
 * The field to write to Ledge (the mockup's `composer()`): its suggestions above (alt+1…4; « Lance un rig… » opens the launch), the
 * `@` list of the rigs' seats above it while an `@…` word is under the cursor, then the field. ↵ sends the text as it is: the daemon
 * decides whether it goes to a seat (lot 4); the TUI does not read the `@`.
 */
export function LedgeComposer({ draft, setDraft, active, browsing, onBrowse, history, title, onSubmit, onSay, onEscape, width, keys, onList }: LedgeComposerProps) {
  const { t, go, rigs, escalations, d } = useTui();
  // Where the cursor is in what the field shows (the draft, or an entry of the history).
  const [pos, setPos] = useState<{ text: string; cursor: number }>({ text: draft, cursor: draft.length });
  // The `@` word whose list esc closed: it stays closed until another `@` word is under the cursor.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [sel, setSel] = useState(0);

  const cursor = pos.text === draft ? Math.min(pos.cursor, draft.length) : draft.length;
  const at = active && !browsing ? mentionAt(draft, cursor) : null;
  const found = at ? mentionCandidates(at.query, rigs) : [];
  const open = !!at && found.length > 0 && dismissed !== at.start;
  const chosen = Math.min(sel, Math.max(0, found.length - 1));
  useEffect(() => { setSel(0); }, [at?.start, at?.query]);
  useEffect(() => { if (!at && dismissed !== null) setDismissed(null); }, [at, dismissed]);
  useEffect(() => { onList(open); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { onList(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const busiest = mostActiveRig(rigs);
  const suggestions: Array<{ label: string; run(): void }> = [
    { label: t.compose.launchRig, run: () => go('launch', { launch: 'rig' }) },
    ...(busiest ? [{ label: t.compose.whereIs(busiest.name), run: () => onSay(t.compose.whereIs(busiest.name)) }] : []),
    { label: t.compose.decided, run: () => onSay(t.compose.decided) },
    { label: t.compose.needsMe, run: () => onSay(t.compose.needsMe) }
  ];

  const handler: KeyHandler = (input, key) => {
    if (key.meta && /^[1-9]$/.test(input)) { suggestions[Number(input) - 1]?.run(); return true; }
    if (!open || !at) return false;
    if (key.upArrow) { setSel(Math.max(0, chosen - 1)); return true; }
    if (key.downArrow) { setSel(Math.min(found.length - 1, chosen + 1)); return true; }
    if (key.tab) { setDraft(completeMention(draft, at, found[chosen]!.address)); return true; }
    return false;
  };
  keys.current = handler;
  useEffect(() => () => { if (keys.current === handler) keys.current = null; }); // eslint-disable-line react-hooks/exhaustive-deps

  // The rows of the list around the one chosen.
  const first = Math.max(0, Math.min(chosen - LIST_ROWS + 1, found.length - LIST_ROWS));
  const shown = found.slice(Math.max(0, first), Math.max(0, first) + LIST_ROWS);
  const pad = Math.max(8, ...shown.map(m => m.address.length + 2));
  return (
    <Box flexDirection="column" flexShrink={0}>
      {open ? (
        <Box marginLeft={2} width={Math.min(width, 58)} flexShrink={0}>
          <TitledBox title={t.compose.mentionTitle} color={C.violet} titleColor={C.violet} flexGrow={1}>
            {shown.map(m => {
              const on = m === found[chosen];
              const session = m.seat.sessionId ? d.byId.get(m.seat.sessionId) : undefined;
              const detail = [m.detail, ...(session?.topic ? [session.topic] : []), seatStateLabel(m.seat, escalations, t.seat).label].join(' · ');
              return (
                <Text key={m.address + m.rig} wrap="truncate" {...(on ? { backgroundColor: C.sel } : {})}>
                  <Text color={C.violet} bold {...(on ? { backgroundColor: C.sel } : {})}>{m.address.padEnd(pad)}</Text>
                  <Text color={C.dim} {...(on ? { backgroundColor: C.sel } : {})}>{detail}</Text>
                </Text>
              );
            })}
          </TitledBox>
        </Box>
      ) : null}
      <Box marginLeft={1} flexShrink={0}>
        <Text wrap="truncate">
          {suggestions.map(s => <Text key={s.label}><Text color={C.dim} backgroundColor={C.key}> {s.label} </Text>  </Text>)}
          <Text color={C.faint}>{t.compose.alt(suggestions.length)}</Text>
        </Text>
      </Box>
      <Field title={title} value={draft} onChange={setDraft} onSubmit={onSubmit} onBrowse={onBrowse} history={history} active={active}
        onCursor={f => setPos({ text: f.text, cursor: f.cursor })} arrows={!open}
        onEscape={() => { if (open && at) setDismissed(at.start); else onEscape(); }}
        placeholder={t.compose.placeholder} foot={width + 4 >= FULL_FOOT ? t.compose.foot : t.compose.footShort} width={width} />
    </Box>
  );
}
