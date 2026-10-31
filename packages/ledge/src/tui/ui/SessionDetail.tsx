import { Box, Text } from 'ink';
import { isPending } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useTui } from '../context.js';
import { exchanges } from '../model/overview.js';
import { clock, oneLine } from '../model/time.js';
import { C } from '../theme.js';
import { OmpBox } from './OmpBox.js';
import { SessionCard } from './SessionCard.js';
import { TerminalBox } from './TerminalBox.js';
import { TitledBox } from './TitledBox.js';

/** The home's right side for a session: its card with its request, its terminal, the latest exchanges between sessions. */
export function SessionDetail({ s }: { s: Session | null }) {
  const { d, t, g } = useTui();
  return (
    <Box flexDirection="column" flexGrow={1}>
      {s ? (
        <>
          <TitledBox title={`${s.name} · ${oneLine(s.topic ?? s.title)}`} color={isPending(s) ? C.red : C.line} titleColor={isPending(s) ? C.red : C.dim}>
            <SessionCard s={s} note />
          </TitledBox>
          {s.tool === 'omp' ? <OmpBox key={s.id} s={s} /> : <TerminalBox s={s} />}
        </>
      ) : <TitledBox title={t.tabs.session} flexGrow={1}><Text color={C.faint}>{t.session.noSession}</Text></TitledBox>}
      <TitledBox title={t.overview.exchanges} height={5}>
        {(() => {
          const list = exchanges(d.sessions, 3);
          return list.length === 0 ? <Text color={C.faint}>{t.overview.noExchange}</Text> : list.map((x, i) => (
            <Text key={i} wrap="truncate"><Text color={C.faint}>{clock(x.at)}</Text> <Text color={C.fg}>{x.from}</Text> <Text color={C.violet}>{g.arrow}</Text> <Text color={C.fg}>{x.to}</Text>  <Text color={C.dim}>{oneLine(x.summary)}</Text></Text>
          ));
        })()}
      </TitledBox>
    </Box>
  );
}
