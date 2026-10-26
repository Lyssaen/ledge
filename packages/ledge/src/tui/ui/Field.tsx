import { useReducer, useRef } from 'react';
import { Box, usePaste, useInput, useWindowSize } from 'ink';
import { useTui } from '../context.js';
import { back, del, end, fieldLines, home, insert, killWord, layout, left, lineAt, newlines, right, rowOf, scrollTop, vertical, wordLeft, wordRight, type Field as State } from '../model/field.js';
import { C } from '../theme.js';
import { LineText } from './Lines.js';
import { TitledBox } from './TitledBox.js';

/** How many rows the field shows before it scrolls: 6, 8 in a tall and wide terminal, 3 in a short one. */
export const fieldRows = (columns: number, rows: number): number => (rows < 24 ? 3 : columns >= 120 && rows >= 32 ? 8 : 6);

/** Going through what was sent: the entries, then the draft, last; `i` the one shown. Each keeps its edits until the field
 *  is sent or left. The caller's value stays the draft meanwhile: an entry shown or edited is not a draft. */
type Browse = { items: string[]; i: number };
const inHistory = (b: Browse | null): b is Browse => b !== null && b.i < b.items.length - 1;

/** A multi-line field in its box, the cursor in inverse.
 *  ↵ sends; alt+↵ (shift+↵ where the terminal tells it, ctrl+j otherwise) adds a line; a paste keeps its lines.
 *  ← → by grapheme, ctrl or alt ← → by word, home end (ctrl+a ctrl+e) on the line, ↑ ↓ from row to row, suppr, ctrl+w the
 *  word before, ctrl+u all. ↑ on the first row goes back through `history` (oldest first), ↓ comes down to the draft, as it
 *  was. The caller owns the draft; `active` false leaves the keys to the screen. */
export function Field({ value, onChange, onSubmit, onEscape, onBrowse, history = [], active, placeholder, title, color = C.coral, titleColor }: {
  value: string; onChange(v: string): void; onSubmit(v: string): void; onEscape?(): void; onBrowse?(on: boolean): void;
  history?: readonly string[]; active: boolean; placeholder?: string; title: string; color?: string; titleColor?: string;
}) {
  const { t, g } = useTui();
  const { columns, rows: height } = useWindowSize();
  // Held in a ref, changed at once: keys read together (ssh, a busy machine) each start from the one before, not from the
  // last render. A value changed from outside (sent, given back) puts the cursor at its end and leaves the history.
  const st = useRef<{ f: State; browse: Browse | null; pasted: number }>({ f: { text: value, cursor: value.length }, browse: null, pasted: 0 });
  const told = useRef(value);
  if (value !== told.current) { told.current = value; st.current = { f: { text: value, cursor: value.length }, browse: null, pasted: 0 }; }
  const [, render] = useReducer((n: number) => n + 1, 0);
  const top = useRef(0);
  const width = Math.max(10, columns - 4);
  const max = fieldRows(columns, height);

  const set = (f: State, o: { paste?: number } = {}) => {
    const cur = st.current, changed = f.text !== cur.f.text;
    let browse = cur.browse;
    if (browse && changed) { const items = [...browse.items]; items[browse.i] = f.text; browse = { ...browse, items }; }
    st.current = { f, browse, pasted: o.paste ?? 0 };
    render();
    // Only the draft goes to the caller: an entry of the history, edited, stays the field's.
    if (changed && !inHistory(browse)) { told.current = f.text; onChange(f.text); }
  };
  const show = (b: Browse | null, i?: number) => {
    const next = b && i !== undefined ? { ...b, i } : b;
    const text = next ? next.items[next.i]! : st.current.f.text;
    st.current = { f: { text, cursor: text.length }, browse: next, pasted: 0 };
    render();
    onBrowse?.(inHistory(next));
  };

  useInput((input, key) => {
    const { f, browse } = st.current;
    if (key.return && !key.meta && !key.shift) { if (browse) show(null); onSubmit(f.text); return; }
    // ctrl+j comes as a linefeed, or as ctrl and j where the terminal tells keys apart.
    if (key.return || input === '\n' || (key.ctrl && input === 'j')) { set(insert(f, '\n')); return; }
    if (key.escape) {
      // Out of the history, back to the draft; else out of the field.
      if (inHistory(browse)) { show(browse, browse.items.length - 1); show(null); return; }
      if (browse) show(null);
      onEscape?.(); return;
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
      // Up the rows of what is shown first, an entry of several lines too; then to the entry before.
      const up = vertical(f, width - 2, -1);
      if (up) { set(up); return; }
      const b = browse ?? (history.length ? { items: [...history, f.text], i: history.length } : null);
      if (b && b.i > 0) show(b, b.i - 1);
      return;
    }
    if (key.downArrow) {
      const down = vertical(f, width - 2, 1);
      if (down) { set(down); return; }
      if (inHistory(browse)) show(browse, browse.i + 1);
      return;
    }
    if (key.ctrl || key.meta || key.tab || key.pageUp || key.pageDown) return;
    // Without bracketed paste, a paste comes as one input, its lines ended by \r.
    if (input) { const add = newlines(input); set(insert(f, add), { paste: add.includes('\n') ? add.split('\n').length : 0 }); }
  }, { isActive: active });
  usePaste(text => { const add = newlines(text); set(insert(st.current.f, add), { paste: add.includes('\n') ? add.split('\n').length : 0 }); }, { isActive: active });

  const { f, browse, pasted } = st.current;
  const prefix = { text: `${g.cursor} `, color: C.coral };
  const lines = fieldLines(f.text, active ? f.cursor : null, width, { prefix, color: C.fg, ...(placeholder ? { placeholder: { text: f.text ? '' : ` ${placeholder}`, color: C.faint } } : {}) });
  const row = rowOf(layout(f.text, width - 2), f.cursor);
  top.current = scrollTop(top.current, row, lines.length, max);
  const shown = lines.slice(top.current, top.current + max);
  const below = lines.length - top.current - shown.length;
  const where = lineAt(f);
  const foot = inHistory(browse) ? t.field.history(browse.i + 1, browse.items.length - 1)
    : [top.current > 0 ? t.field.above(top.current) : '', below > 0 ? t.field.below(below) : '',
      pasted > 1 ? t.field.pasted(pasted) : active && where.lines > 1 ? t.field.line(where.line, where.lines) : ''].filter(Boolean).join(' · ');
  return (
    <TitledBox title={title} color={active ? color : C.line} titleColor={titleColor ?? (active ? color : C.dim)} foot={foot || undefined} flexShrink={0}>
      {shown.map((l, i) => <Box key={i} flexShrink={0}><LineText line={l} /></Box>)}
    </TitledBox>
  );
}
