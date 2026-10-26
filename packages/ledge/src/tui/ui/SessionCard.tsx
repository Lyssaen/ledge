import { Box, Text } from 'ink';
import { liveHelpers } from '@ledge/fleet';
import { contextNear, offers, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { useTui } from '../context.js';
import { machineLabel, modelLabel, TOOL_NAME } from '../model/labels.js';
import { choices } from '../model/pending.js';
import { oneLine } from '../model/time.js';
import { C, STATE_COLOR } from '../theme.js';

export function Button({ label, k, primary, off }: { label: string; k: string; primary?: boolean; off?: boolean }) {
  return (
    <Text>
      <Text color={off ? C.faint : primary ? C.fg : C.fg} backgroundColor={off ? undefined : primary ? '#3a201b' : '#2c2926'}> {label} </Text>
      <Text color={C.dim} backgroundColor={off ? undefined : primary ? '#3a201b' : '#2c2926'}>{k} </Text>
    </Text>
  );
}

/** What the session is (state, agent, model, machine, branch, helpers) and its request with the keys that answer it. */
export function SessionCard({ s, note }: { s: Session; note?: boolean }) {
  const { t, g } = useTui();
  const state = botState(s);
  const helpers = liveHelpers(s);
  const p = s.pending;
  const canAct = !s.offline && s.source !== 'hook_only';
  const verb = !p ? '' : p.kind === 'question' ? t.overview.asks : p.kind === 'plan' ? t.overview.plan : p.kind === 'diff' ? t.overview.diff : t.overview.wantsToRun;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={STATE_COLOR[state]}>{g[state]} {t.state[state]}</Text>
        <Text color={C.dim}>  {TOOL_NAME[s.tool]} · {modelLabel(s, t.session.defaultModel)}</Text>
        {/* Its context, before what is cut first on a narrow terminal (context handover spec §3.2). */}
        {s.context ? <Text color={contextNear(s.context) ? C.yellow : C.dim}> · {t.overview.context(Math.round((s.context.used / s.context.window) * 100))}</Text> : null}
        <Text color={C.dim}> · {machineLabel(s)}{s.branch ? ` · ${g.branch} ${s.branch}` : ''}</Text>
        {s.handover ? <Text color={s.handover.state === 'failed' ? C.red : C.dim}> · {s.handover.state === 'done' && s.handover.toName ? t.overview.relievedBy(s.handover.toName) : t.overview.relief[s.handover.state]}</Text> : null}
        {s.relieves ? <Text color={C.dim}> · {t.overview.relieves(s.relieves.name)}</Text> : null}
        {s.offline ? <Text color={C.yellow}>  {t.overview.offline}</Text> : s.source === 'hook_only' ? <Text color={C.faint}>  {t.overview.readOnly}</Text> : null}
      </Text>
      {helpers.length > 0 ? <Text color={C.violet} wrap="truncate">  {helpers.map(h => `${g.helper} ${h.kind} · ${oneLine(h.task)}`).join('   ')}</Text> : null}
      {p ? (
        <Box flexDirection="column" marginTop={1}>
          <Text wrap="truncate"><Text color={STATE_COLOR[state]}>{verb}</Text> <Text color={C.fg} bold>{oneLine(p.text)}</Text>{p.tool ? <Text color={C.faint}>  {p.tool}</Text> : null}</Text>
          <Box marginTop={1} columnGap={2} flexWrap="wrap">
            {p.kind === 'question'
              ? choices(p).slice(0, 9).map((c, i) => <Button key={c.n} label={`${c.n} · ${c.label}`} k={String(c.n)} primary={i === 0} off={!canAct} />)
              : <>
                <Button label={t.overview.allow} k="y" primary off={!canAct} />
                <Button label={t.overview.deny} k="n" off={!canAct} />
                {offers(s.tool, p.kind, 'always') ? <Button label={t.overview.always} k="A" off={!canAct} /> : null}
                {note && offers(s.tool, p.kind, 'note') ? <Button label={t.overview.denyWithNote} k="r" off={!canAct} /> : null}
              </>}
          </Box>
        </Box>
      ) : s.lastReply && state === 'idle' ? <Text color={C.dim} wrap="truncate">  {oneLine(s.lastReply.text)}</Text> : null}
    </Box>
  );
}
