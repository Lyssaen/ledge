import { useRef, useState } from 'react';
import { Box, usePaste, useInput, useWindowSize } from 'ink';
import { useTui } from '../context.js';
import { back, del, end, fieldLines, home, insert, killWord, layout, left, lineAt, newlines, right, rowOf, scrollTop, vertical, wordLeft, wordRight, type Field as State } from '../model/field.js';
import { C } from '../theme.js';
import { LineText } from './Lines.js';
import { TitledBox } from './TitledBox.js';

/** How many rows the field shows before it scrolls: 6, 8 in a tall and wide terminal, 3 in a short one. */
export const fieldRows = (columns: number, rows: number): number => (rows < 24 ? 3 : columns >= 120 && rows >= 32 ? 8 : 6);

/** Going through what was sent: the entries, then the draft, last; `i` the one shown. Each keeps its edits until the field
 *  is sent or left. */
type Browse = { items: string[]; i: number };

/** A multi-line field in its box, the cursor in inverse.
 *  ↵ sends; alt+↵ (shift+↵ where the terminal tells it, ctrl+j otherwise) adds a line; a paste keeps its lines.
 *  ← → by grapheme, ctrl or alt ← → by word, home end (ctrl+a ctrl+e) on the line, ↑ ↓ from row to row, suppr, ctrl+w the
 *  word before, ctrl+u all. ↑ on the first row goes back through `history` (oldest first), ↓ comes down to the draft, as it
 *  was. The caller owns the value; `active` false leaves the keys to the screen. */
export function Field({ value, onChange, onSubmit, onEscape, onBrowse, history = [], active, placeholder, title, color = C.coral, titleColor }: {
  value: string; onChange(v: string): void; onSubmit(v: string): void; onEscape?(): void; onBrowse?(on: boolean): void;
  history?: readonly string[]; active: boolean; placeholder?: string; title: string; color?: string; titleColor?: string;
}) {
  const { t, g } = useTui();
  const { columns, rows: height } = useWindowSize();
  // The cursor goes with the value it was set for: a value changed from outside (sent, given back) puts it at the end.
  const [at, setAt] = useState<State>({ text: value, cursor: value.length });
  const f: State = at.text === value ? at : { text: value, cursor: value.length };
  const [browse, setBrowseState] = useState<Browse | null>(null);
  const [pasted, setPasted] = useState(0);
  const top = useRef(0);
  const width = Math.max(10, columns - 4);
  const max = fieldRows(columns, height);

  const setBrowse = (b: Browse | null) => { setBrowseState(b); onBrowse?.(b !== null && b.i < b.items.length - 1); };
  const set = (next: State, o: { paste?: number } = {}) => {
    setAt(next);
    setPasted(o.paste ?? 0);
    if (next.text === f.text) return;
    if (browse) { const items = [...browse.items]; items[browse.i] = next.text; setBrowseState({ ...browse, items }); }
    onChange(next.text);
  };
  const show = (b: Browse) => { setBrowse(b); const text = b.items[b.i]!; setAt({ text, cursor: text.length }); setPasted(0); onChange(text); };
  const leaveBrowse = () => { if (browse) setBrowse(null); };

  useInput((input, key) => {
    if (key.return && !key.meta && !key.shift) { leaveBrowse(); onSubmit(f.text); return; }
    // ctrl+j comes as a linefeed, or as ctrl and j where the terminal tells keys apart.
    if (key.return || input === '\n' || (key.ctrl && input === 'j')) { set(insert(f, '\n')); return; }
    if (key.escape) {
      // Out of the history, back to the draft; else out of the field.
      if (browse && browse.i < browse.items.length - 1) { show({ items: browse.items, i: browse.items.length - 1 }); setBrowse(null); return; }
      leaveBrowse(); onEscape?.(); return;
    }
    if (key.backspace) { set(key.meta ? killWord(f) : back(f)); return; }
    if (key.delete) { set(del(f)); return; }
    if (key.ctrl && input === 'u') { set({ text: '', cursor: 0 }); return; }
    if (key.ctrl && input === 'w') { set(killWord(f)); return; }
    if ((key.ctrl && input === 'a') || key.home) { set(home(f)); return; }
    if ((key.ctrl && input === 'e') || key.end) { set(end(f)); return; }
    if (key.leftArrow || (key.meta && input === 'b')) { set(key.ctrl || key.meta ? wordLeft(f) : left(f)); return; }
    if (key.rightArrow || (key.meta && input === 'f')) { set(key.ctrl || key.meta ? wordRight(f) : right(f)); return; }
    if (key.upArrow) {
      const up = browse ? null : vertical(f, width - 2, -1);
      if (up) { set(up); return; }
      const b = browse ?? (history.length ? { items: [...history, f.text], i: history.length } : null);
      if (b && b.i > 0) show({ items: b.items, i: b.i - 1 });
      return;
    }
    if (key.downArrow) {
      const down = vertical(f, width - 2, 1);
      if (down) { set(down); return; }
      if (browse && browse.i < browse.items.length - 1) show({ items: browse.items, i: browse.i + 1 });
      return;
    }
    if (key.ctrl || key.meta || key.tab || key.pageUp || key.pageDown) return;
    // Without bracketed paste, a paste comes as one input, its lines ended by \r.
    if (input) { const add = newlines(input); set(insert(f, add), { paste: add.includes('\n') ? add.split('\n').length : 0 }); }
  }, { isActive: active });
  usePaste(text => { const add = newlines(text); set(insert(f, add), { paste: add.includes('\n') ? add.split('\n').length : 0 }); }, { isActive: active });

  const prefix = { text: `${g.cursor} `, color: C.coral };
  const lines = fieldLines(f.text, active ? f.cursor : null, width, { prefix, color: C.fg, ...(placeholder ? { placeholder: { text: f.text ? '' : ` ${placeholder}`, color: C.faint } } : {}) });
  const row = rowOf(layout(f.text, width - 2), f.cursor);
  top.current = scrollTop(top.current, row, lines.length, max);
  const shown = lines.slice(top.current, top.current + max);
  const below = lines.length - top.current - shown.length;
  const where = lineAt(f);
  const foot = browse && browse.i < browse.items.length - 1 ? t.field.history(browse.i + 1, browse.items.length - 1)
    : [top.current > 0 ? t.field.above(top.current) : '', below > 0 ? t.field.below(below) : '',
      pasted > 1 ? t.field.pasted(pasted) : active && where.lines > 1 ? t.field.line(where.line, where.lines) : ''].filter(Boolean).join(' · ');
  return (
    <TitledBox title={title} color={active ? color : C.line} titleColor={titleColor ?? (active ? color : C.dim)} foot={foot || undefined} flexShrink={0}>
      {shown.map((l, i) => <Box key={i} flexShrink={0}><LineText line={l} /></Box>)}
    </TitledBox>
  );
}
