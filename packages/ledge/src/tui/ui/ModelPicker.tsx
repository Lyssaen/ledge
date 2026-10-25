import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useModels } from '@ledge/fleet/models';
import type { Tool } from '@ledge/protocol';
import { useEditing, useTui } from '../context.js';
import { C } from '../theme.js';

export interface Pick { model: string | null; effort: string | null }

/** The models the agent offers on the machine (`models.list`), the agent's default first: ↑ ↓ a model, ← → its effort,
 *  ↵ takes it, esc leaves. It has the keyboard while open. */
export function ModelPicker({ machine, tool, current, onPick, onCancel }: { machine: string; tool: Tool; current: Pick; onPick(p: Pick): void; onCancel(): void }) {
  const { client, t, g } = useTui();
  useEditing(true);
  const models = useModels(client, machine, tool);
  const rows = [{ id: null as string | null, label: t.launch.defaultModel, efforts: [] as string[], defaultEffort: undefined as string | undefined }, ...models.models.map(m => ({ id: m.id as string | null, label: m.label, efforts: m.efforts ?? [], defaultEffort: m.defaultEffort }))];
  const [at, setAt] = useState(() => Math.max(0, rows.findIndex(r => r.id === current.model)));
  const [effort, setEffort] = useState<string | null>(current.effort);
  const row = rows[Math.min(at, rows.length - 1)]!;
  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (key.upArrow || input === 'k') { setAt(i => (i - 1 + rows.length) % rows.length); setEffort(null); return; }
    if (key.downArrow || input === 'j') { setAt(i => (i + 1) % rows.length); setEffort(null); return; }
    if ((key.leftArrow || key.rightArrow) && row.efforts.length) {
      const cur = Math.max(0, row.efforts.indexOf(effort ?? row.defaultEffort ?? row.efforts[0]!));
      setEffort(row.efforts[(cur + (key.rightArrow ? 1 : -1) + row.efforts.length) % row.efforts.length]!);
      return;
    }
    if (key.return) onPick({ model: row.id, effort: row.efforts.length ? (effort ?? null) : null });
  });
  if (models.status !== 'ready') return <Text color={C.faint}>{t.launch.loading}</Text>;
  return (
    <Box flexDirection="column">
      {models.error ? <Text color={C.yellow}>{models.error}</Text> : null}
      {rows.map((r, i) => (
        <Text key={r.id ?? '-'} wrap="truncate" backgroundColor={i === at ? C.sel : undefined}>
          <Text color={i === at ? C.coral : C.faint}>{i === at ? g.cursor : ' '} </Text><Text color={C.fg}>{r.label}</Text>
          {i === at && r.efforts.length ? <Text color={C.dim}>   {r.efforts.map(e => e === (effort ?? r.defaultEffort) ? `${g.prev} ${e} ${g.next}` : e).join('  ')}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
