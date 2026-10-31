import { Box, Text } from 'ink';
import type { Projects, Rig, RigSeat } from '@ledge/protocol';
import { useTui } from '../context.js';
import { C, projectColor } from '../theme.js';
import { Button } from './SessionCard.js';
import { TitledBox } from './TitledBox.js';

/** What a rig's room asks before acting through OpenRig: `r` a one-line confirmation, `S` the stop box, `p` the filing box. */
export type RigDialog = { kind: 'restart'; seat: RigSeat } | { kind: 'stop'; seat: RigSeat | undefined; on: number } | { kind: 'adopt'; on: number };

/** A row of a dialog's choices: the radio, an optional glyph, the label, a faint note. */
function Choice({ on, label, note, glyph }: { on: boolean; label: string; note?: string; glyph?: { text: string; color: string } }) {
  const { g } = useTui();
  return (
    <Box backgroundColor={on ? C.sel : undefined} height={1}>
      <Text wrap="truncate">
        <Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>
        <Text color={on ? C.coral : C.dim}>{on ? g.radioOn : g.radioOff} </Text>
        {glyph ? <Text color={glyph.color}>{glyph.text} </Text> : null}
        <Text color={C.fg} bold={on}>{label}</Text>
        {note ? <Text color={C.faint}>  {note}</Text> : null}
      </Text>
    </Box>
  );
}

/** « Relancer build par OpenRig ? ↵ oui · esc non », in place of the room's buttons. */
export function RestartLine({ seat }: { seat: RigSeat }) {
  const { t } = useTui();
  return <Text wrap="truncate"><Text color={C.yellow}>{t.rigAct.restartAsk(seat.name)}</Text><Text color={C.dim}>  {t.rigAct.yes} · {t.rigAct.no}</Text></Text>;
}

/** « Arrêter factory ? »: a red double box, « Arrêter le rig » or « Seulement ce siège » (the chosen one), ↵ or esc. */
export function StopBox({ rig, seat, on }: { rig: Rig; seat: RigSeat | undefined; on: number }) {
  const { t } = useTui();
  const live = rig.seats.filter(s => s.state !== 'stopped').length;
  return (
    <TitledBox title={t.rigAct.stopTitle(rig.name)} color={C.red} titleColor={C.red} double flexShrink={0}>
      <Choice on={on === 0} label={t.rigAct.stopAll} />
      {seat ? <Choice on={on === 1} label={t.rigAct.stopSeat(seat.name)} /> : null}
      <Text color={C.faint} wrap="truncate">{t.rigAct.stopBody(live)}</Text>
      <Box columnGap={2}><Button label={on === 0 ? t.rigAct.stopAll : t.rigAct.stopSeat(seat?.name ?? '')} k="↵" danger /><Button label={t.rigAct.cancel} k="esc" /></Box>
    </TitledBox>
  );
}

/** « Ranger atlas dans un projet ? »: a coral double box with the choices of `adoptChoices`, what filing changes, ↵ or esc. */
export function AdoptBox({ rig, choices, on, projects }: { rig: Rig; choices: { projectId: string | null; label: string; note?: string }[]; on: number; projects: Projects | null }) {
  const { t, g } = useTui();
  const chosen = choices[on];
  return (
    <TitledBox title={t.rigAct.adoptTitle(rig.name)} color={C.coral} titleColor={C.coral} double flexShrink={0}>
      {choices.map((c, i) => {
        const project = c.projectId ? projects?.projects.find(p => p.id === c.projectId) : undefined;
        return <Choice key={c.projectId ?? '-'} on={i === on} label={c.label} {...(c.note ? { note: c.note } : {})}
          {...(project ? { glyph: { text: g.project, color: projectColor(project.color) } } : {})} />;
      })}
      <Text color={C.faint} wrap="truncate">{chosen?.projectId ? t.rigAct.adoptNote(rig.name, chosen.label) : t.rigAct.stayNote(rig.name)}</Text>
      <Box columnGap={2}><Button label={t.rigAct.adopt} k="↵" primary /><Button label={t.rigAct.cancel} k="esc" /></Box>
    </TitledBox>
  );
}
