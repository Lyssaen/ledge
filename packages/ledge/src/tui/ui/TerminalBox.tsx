import { useColorPreview } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useTui } from '../context.js';
import { paneName } from '../model/labels.js';
import { C } from '../theme.js';
import { Tail } from './Tail.js';
import { TitledBox } from './TitledBox.js';

/** The terminal pane of a session: its real colours when the daemon sends them, the plain preview otherwise. */
export function TerminalBox({ s }: { s: Session }) {
  const { client, d, t } = useTui();
  const colored = useColorPreview(client, s.id);
  return (
    <TitledBox title={`${t.overview.terminal(paneName(s))}${colored ? ` ${t.overview.inColor}` : ''}`} flexGrow={1}>
      <Tail lines={colored ?? d.previews.get(s.id) ?? []} ansi={colored !== undefined} color={C.dim} empty={t.overview.noPreview} emptyColor={C.faint} />
    </TitledBox>
  );
}
