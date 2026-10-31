import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useBoxMetrics, useInput, type DOMElement } from 'ink';
import type { Session } from '@ledge/protocol';
import { useTui } from '../context.js';
import { ompPaneLines } from '../model/ompPane.js';
import { C } from '../theme.js';
import { Lines } from './Lines.js';
import { TitledBox } from './TitledBox.js';

/** An OMP session's right pane: its thread drawn as a terminal, anchored at the bottom (PgUp goes up). Ledge drives OMP over
 *  RPC: there is no pane to follow, so no colour preview is asked for. */
export function OmpBox({ s }: { s: Session }) {
  const { client, d, t, g, tone } = useTui();
  const items = d.threads.get(s.id);
  // The thread is asked once per opening (and again after a reconnect drops it); its items then arrive one by one.
  useEffect(() => { if (!items && !s.offline) client.send({ type: 'session.thread', id: s.id }); }, [items === undefined, s.id, d.snapshotSeq]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<DOMElement>(null);
  const { width: w } = useBoxMetrics(ref);
  // The box's border and padding take 4 cells.
  const width = Math.max(20, (w || 84) - 4);
  const working = s.state === 'working';
  // The clock is not in here: a running action's time ticks on its own (ui/Lines.tsx).
  const lines = useMemo(() => ompPaneLines(items ?? [], { t, g, width, now: Date.now(), name: s.name, working }), [items, t, g, width, s.name, working, tone]);
  const [up, setUp] = useState(0);
  const [view, setView] = useState(10);
  const top = Math.max(0, lines.length - view);
  useInput((_, key) => {
    if (key.pageUp) setUp(u => Math.min(top, u + view - 1));
    else if (key.pageDown) setUp(u => Math.max(0, u - view + 1));
  });
  return (
    <Box ref={ref} flexDirection="column" flexGrow={1}>
      <TitledBox title="" heads={[{ text: g.omp, color: C.omp, raw: true }, { text: ` ${t.omp.title}`, color: C.omp }]} color={C.line} foot={t.omp.foot} flexGrow={1}>
        {lines.length === 0 ? <Text color={C.faint}>{t.omp.empty}</Text> : <Lines lines={lines} up={Math.min(up, top)} onHeight={setView} />}
      </TitledBox>
    </Box>
  );
}
