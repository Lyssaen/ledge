import { Text, useInput } from 'ink';
import { C } from '../theme.js';

/** A one-line field: printable keys and paste append, backspace deletes, ctrl+u clears, ↵ submits, esc leaves. The caller
 *  owns the value; `active` false leaves the keys to the screen. Too long, it shows its end: put it in a Box, not inside
 *  another Text (the outer Text's wrap would win). */
export function TextInput({ value, onChange, onSubmit, onEscape, placeholder, active, mask }: {
  value: string; onChange(v: string): void; onSubmit?(v: string): void; onEscape?(): void; placeholder?: string; active: boolean; mask?: boolean;
}) {
  useInput((input, key) => {
    if (key.return) { onSubmit?.(value); return; }
    if (key.escape) { onEscape?.(); return; }
    if (key.backspace || key.delete) { onChange([...value].slice(0, -1).join('')); return; }
    if (key.ctrl && input === 'u') { onChange(''); return; }
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown) return;
    if (input) onChange(value + input.replace(/\r\n?/g, '\n'));
  }, { isActive: active });
  const shown = mask ? '•'.repeat(value.length) : value.replace(/\n/g, '⏎');
  if (!shown && !active) return <Text color={C.faint} wrap="truncate">{placeholder ?? ''}</Text>;
  return (
    <Text wrap="truncate-start">
      {shown ? <Text color={C.fg}>{shown}</Text> : null}
      {active ? <Text inverse> </Text> : null}
      {!shown && placeholder ? <Text color={C.faint}> {placeholder}</Text> : null}
    </Text>
  );
}
