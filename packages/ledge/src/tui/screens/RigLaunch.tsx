import { randomUUID } from 'node:crypto';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { useRigSpecs } from '@ledge/fleet';
import { launchability, missingOf, primaryAction, providers, recommendSpec, rigFormDefaults, slugOfGoal, whereOf, withGoal, type RigForm } from '@ledge/ui/launch/rigModel';
import { runtimeLabel } from '@ledge/ui/rigs/model';
import { pickName, RIG_NAME, type RigPlan, type RigSpecInfo } from '@ledge/protocol';
import { LEDGE_FOCUS, useEditing, useScreenKeys, useTui } from '../context.js';
import { seatStateLabel } from '../model/left.js';
import { refusalText, rigCall } from '../model/rigActions.js';
import { launchedRig, RIG_LAUNCH_MS, RIG_PREPARE_MS, rigLaunchCall, startingLines, trustSeat, type RigLaunchAnswer, type RigLaunchStep } from '../model/rigLaunch.js';
import { C, projectColor } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { Button } from '../ui/SessionCard.js';
import { TextInput } from '../ui/TextInput.js';
import { TitledBox } from '../ui/TitledBox.js';

type Field = 'goal' | 'spec' | 'where' | 'repo' | 'branch' | 'copy' | 'machine' | 'name';
const TEXT: ReadonlySet<Field> = new Set(['goal', 'branch', 'name']);
const fieldsOf = (f: RigForm): Field[] => (f.place.kind === 'project' ? ['goal', 'spec', 'where', 'repo', 'branch', 'copy', 'machine'] : ['goal', 'spec', 'where', 'machine', 'name']);
const cycle = <T,>(list: readonly T[], cur: T, by: number): T => list[((Math.max(0, list.indexOf(cur)) + by) % list.length + list.length) % list.length]!;
const specOf = (specs: readonly RigSpecInfo[], spec: string | null) => (spec === null ? undefined : specs.find(s => s.name === spec || s.id === spec));

/** « Nouveau rig » (the launch screen's rig mode): the goal, the spec and where; Ledge's plan (optional, imposed on a real repository);
 *  then the start, followed seat by seat until ↵ opens the rig's room. `rig.prepare` → `rig.plan`, `rig.launch` → `rig.result`. */
export function RigLaunch() {
  const tui = useTui();
  const { client, machines, projects, rigs, openrig, t, g, go, toast, small } = tui;
  const w = t.rigLaunch;
  const list = projects?.projects ?? [];
  const [form, setForm] = useState<RigForm>(() => {
    // The project of what is chosen (a rig, a session), else the first one.
    const f = tui.focus;
    const rig = f.kind === 'rig' || f.kind === 'seat' ? rigs.find(r => r.machine === f.machine && r.id === f.rigId) : undefined;
    const project = rig?.projectId ?? tui.selected?.project ?? list[0]?.id;
    return rigFormDefaults({ projects: list, machines, wanted: project ? { project } : {} });
  });
  // A spec or a branch the user chose is kept; until then the spec follows Ledge's recommendation and the branch the spec.
  const [touched, setTouched] = useState({ spec: false, branch: false });
  const [field, setField] = useState<Field>('goal');
  const [tried, setTried] = useState(false);
  const [step, setStep] = useState<RigLaunchStep>({ kind: 'form' });
  const [busy, setBusy] = useState<'preparing' | 'launching' | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  // The fleet machine that made each plan, the plans a launch already took (a failed launch keeps its plan: a new one is made),
  // the launch under way and where it came from, and whether the screen is still shown (an answer after esc launches nothing).
  const planMachine = useRef(new Map<string, string>()).current;
  const taken = useRef(new Set<string>()).current;
  const launching = useRef<{ plan: RigPlan; machine: string; from: RigLaunchStep } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEditing(step.kind === 'form');

  const specs = useRigSpecs(client, form.machine);
  const withSpec = (f: RigForm, spec: string, branchTouched = touched.branch): RigForm =>
    ({ ...f, spec, place: f.place.kind === 'project' && !branchTouched ? { ...f.place, branch: `feat/${spec}` } : f.place });
  const recName = specOf(specs.specs, recommendSpec(form.goal, specs.specs)?.spec ?? null)?.name;
  useEffect(() => { if (!touched.spec && recName && recName !== form.spec) setForm(f => withSpec(f, recName)); }, [recName, touched.spec, form.spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const machine = machines.find(m => m.id === form.machine);
  const machineLabel = machine?.label ?? form.machine;
  const can = machine ? launchability(machine, openrig.find(s => s.machine === machine.id)) : { ok: false as const, why: 'offline' as const };
  const missing = missingOf(form);
  const action = primaryAction(form);
  const spec = specOf(specs.specs, form.spec);
  const project = form.place.kind === 'project' ? list.find(p => p.id === (form.place as { projectId: string }).projectId) : undefined;
  const repos = project ? project.repos.filter(r => r.machine === form.machine).map(r => r.path) : [];
  const fields = fieldsOf(form);
  const at: Field = fields.includes(field) ? field : 'goal';

  const why = (a: Extract<RigLaunchAnswer, { ok: false }>, ms: number) => w.refused(a.reason === 'timeout' ? w.timeout(ms / 1000) : a.reason);

  const launch = (plan: RigPlan, from: RigLaunchStep) => {
    // A plan a launch already took, even a failed one, is not launched again: a new one is made, then launched.
    if (taken.has(plan.id)) { prepare('launch', from); return; }
    taken.add(plan.id);
    const machineId = planMachine.get(plan.id) ?? plan.machine;
    launching.current = { plan, machine: machineId, from };
    setBusy('launching'); setRefused(null);
    setStep({ kind: 'starting', planId: plan.id });
    void rigLaunchCall(client, machineId, { type: 'rig.launch', rid: randomUUID(), planId: plan.id }).then(a => {
      if (!alive.current) return;
      setBusy(null);
      if (!a.ok) { setRefused(why(a, RIG_LAUNCH_MS)); setStep(from); }
    });
  };
  const prepare = (then: 'plan' | 'launch', from: RigLaunchStep = step) => {
    if (busy) return;
    setTried(true);
    const where = whereOf(form);
    if (!can.ok || missing.length > 0 || !where || !form.spec) return;
    const machineId = form.machine;
    setBusy('preparing'); setRefused(null);
    void rigLaunchCall(client, machineId, { type: 'rig.prepare', rid: randomUUID(), machine: machineId, spec: form.spec, goal: form.goal.trim(), where }).then(a => {
      if (!alive.current) return;
      if (!a.ok || !a.plan) { setBusy(null); setRefused(a.ok ? w.refused('?') : why(a, RIG_PREPARE_MS)); return; }
      planMachine.set(a.plan.id, machineId);
      if (then === 'launch') { setBusy(null); launch(a.plan, from); return; }
      setBusy(null); setStep({ kind: 'plan', plan: a.plan });
    });
  };

  // The start: the rig the launch made, found by its plan once the daemon names it.
  const started = step.kind === 'starting' ? launching.current : null;
  // Known by its id once found: the launch's annotation may go (a cancelled launch), the rig stays.
  const rig = !started ? undefined : step.kind === 'starting' && step.rigId ? rigs.find(r => r.machine === started.machine && r.id === step.rigId) : launchedRig(rigs, started.machine, started.plan.id);
  const trust = trustSeat(rig);
  useEffect(() => { if (step.kind === 'starting' && rig && step.rigId !== rig.id) setStep({ ...step, rigId: rig.id }); }, [rig?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPlace = (id: string | null) => setForm(f => {
    if (id === null) return f.place.kind === 'off' ? f : { ...f, place: { kind: 'off', name: slugOfGoal(f.goal), nameTouched: false } };
    const p = list.find(x => x.id === id);
    const branch = f.place.kind === 'project' ? f.place.branch : f.spec ? `feat/${f.spec}` : '';
    return { ...f, place: { kind: 'project', projectId: id, repo: p?.repos.find(r => r.machine === f.machine)?.path ?? null, branch, copy: f.place.kind === 'project' ? f.place.copy : true } };
  });
  const setMachine = (id: string) => setForm(f => {
    if (f.place.kind !== 'project') return { ...f, machine: id };
    const projectId = f.place.projectId;
    return { ...f, machine: id, place: { ...f.place, repo: list.find(x => x.id === projectId)?.repos.find(r => r.machine === id)?.path ?? null } };
  });

  // The form: a field has the keyboard (the App's keys are off).
  useInput((input, key) => {
    if (small && !key.escape) return;
    if (key.escape) { go('home'); return; }
    if (key.ctrl && input === 't') { tui.setLaunchMode('session'); return; }
    if (key.ctrl && input === 's') { prepare(action); return; }
    if (key.ctrl && input === 'r') {
      if (form.place.kind === 'off') { const name = pickName([...rigs.map(r => r.name), form.place.name].map(x => x.charAt(0).toUpperCase() + x.slice(1))).toLowerCase(); if (RIG_NAME.test(name)) setForm(f => ({ ...f, place: { kind: 'off', name, nameTouched: true } })); }
      return;
    }
    if (key.tab || key.downArrow || (key.return && TEXT.has(at))) { setField(cycle(fields, at, key.shift ? -1 : 1)); return; }
    if (key.upArrow) { setField(cycle(fields, at, -1)); return; }
    if (TEXT.has(at)) return;
    if (key.return) { prepare(action); return; }
    if (input === 'v') { prepare('plan'); return; }
    if (at === 'copy' && input === ' ') { setForm(f => (f.place.kind === 'project' ? { ...f, place: { ...f.place, copy: !f.place.copy } } : f)); return; }
    const by = key.rightArrow || input === 'l' ? 1 : key.leftArrow || input === 'h' ? -1 : 0;
    if (!by) return;
    if (at === 'spec' && specs.specs.length) { setTouched(x => ({ ...x, spec: true })); setForm(f => withSpec(f, cycle(specs.specs.map(s => s.name), spec?.name ?? specs.specs[0]!.name, by))); }
    else if (at === 'where') setPlace(cycle([...list.map(p => p.id), null], form.place.kind === 'project' ? form.place.projectId : null, by));
    else if (at === 'repo' && repos.length) setForm(f => (f.place.kind === 'project' ? { ...f, place: { ...f.place, repo: cycle(repos, f.place.repo ?? repos[0]!, by) } } : f));
    else if (at === 'machine' && machines.length) setMachine(cycle(machines.map(m => m.id), form.machine, by));
  }, { isActive: step.kind === 'form' });

  // The plan and the start: the screen's keys, before the App's (1, esc, q…).
  useScreenKeys((input, key) => {
    if (step.kind === 'form') return false;
    // Help would leave the screen and its launch: not from here.
    if (input === '?') return true;
    if (step.kind === 'plan') {
      if (key.ctrl && input === 's') { if (!busy) launch(step.plan, step); return true; }
      if (key.escape) { if (!busy) { setStep({ kind: 'form' }); setRefused(null); } return true; }
      return false;
    }
    if (key.return) {
      if (trust && rig) {
        const argv = tui.fleet.seatTerminal(rig.machine, trust.ref);
        if (!argv) toast({ text: t.room.noTerminalCommand(trust.name), tone: 'info' }); else tui.runInTerminal(argv);
      } else if (rig?.lifecycle === 'running') { tui.setFocus({ kind: 'rig', machine: rig.machine, rigId: rig.id }); go('home'); }
      return true;
    }
    if (input === 'x') {
      if (!rig) { toast({ text: w.notNamed, tone: 'info' }); return true; }
      void rigCall(client, { type: 'rig.act', rid: randomUUID(), machine: rig.machine, rigId: rig.id, verb: 'down' }).then(r => {
        toast(r.ok ? { text: w.cancelled(rig.name), tone: 'ok' } : { text: refusalText(r, t.rigAct), tone: 'error' });
        if (r.ok && alive.current) { tui.setFocus({ kind: 'ledge' }); tui.setLedgeFocus(LEDGE_FOCUS.left); go('home'); }
      });
      return true;
    }
    return false;
  });

  if (step.kind === 'plan') {
    const plan = step.plan;
    return (
      <Frame crumb={w.crumb} keys={[['ctrl+s', t.keys.start], ['esc', t.keys.back]]}>
        <TitledBox title={w.planTitle} mark={{ text: `· ${g.rig} ${plan.spec}`, color: C.faint }} color={C.coral} titleColor={C.coral} flexGrow={1}>
          <Text color={C.fg} wrap="truncate">{w.plan.intro}</Text>
          <Text color={C.dim} wrap="truncate">{plan.goal}</Text>
          <Text> </Text>
          <Text color={C.faint}>{`  ${w.plan.head.seat.padEnd(12)}${w.plan.head.agent.padEnd(30)}${w.plan.head.autonomy}`}</Text>
          {plan.seats.map(s => (
            <Text key={s.address} wrap="truncate"><Text color={C.violet}>{`  ${s.address.padEnd(12)}`}</Text><Text color={C.dim}>{`${runtimeLabel(s.runtime)}${s.model ? ` · ${s.model}` : ''}`.padEnd(30)}</Text><Text color={C.fg}>{s.autonomy}</Text></Text>
          ))}
          <Text> </Text>
          <Text wrap="truncate"><Text color={C.dim}>{w.plan.folder.padEnd(14)}</Text><Text color={C.fg}>{plan.cwd}</Text></Text>
          <Text wrap="truncate"><Text color={C.dim}>{w.plan.writes} </Text>{plan.writes.map((x, i) => <Text key={x}>{i ? ' ' : ''}<Text color={C.code}>{x}</Text></Text>)}</Text>
          <Text wrap="truncate"><Text color={C.dim}>{w.plan.command.padEnd(14)}</Text><Text color={C.code}>{plan.command}</Text></Text>
          <Box marginTop={1} columnGap={2}>
            <Button label={busy ? (busy === 'preparing' ? w.preparing : w.launching) : w.launchRig} k="ctrl+s" primary off={!!busy} />
            <Button label={w.back} k="esc" />
            {refused ? <Text color={C.red} wrap="truncate">{refused}</Text> : null}
          </Box>
        </TitledBox>
      </Frame>
    );
  }

  if (step.kind === 'starting' && started) {
    const lines = startingLines(rig, started.plan, w);
    const color = { ok: C.green, running: C.blue, held: C.faint } as const;
    const glyph = { ok: g.ok, running: g.running, held: g.held } as const;
    const keys: Array<readonly [string, string]> = [...(trust ? [['↵', w.keys.trust] as const] : rig?.lifecycle === 'running' ? [['↵', w.keys.openRoom] as const] : []),
      ['x', w.keys.cancelLaunch], ['1', w.keys.ledge], ['esc', t.keys.close]];
    return (
      <Frame crumb={w.crumb} keys={keys}>
        <TitledBox title={w.startTitle} mark={{ text: `· ${g.rig} ${rig?.name ?? started.plan.spec}`, color: C.faint }} color={C.coral} titleColor={C.coral} flexGrow={1}>
          {lines.map(l => (
            <Text key={l.label} wrap="truncate"><Text color={color[l.glyph]}>{glyph[l.glyph]} </Text><Text color={l.glyph === 'held' ? C.dim : C.fg} bold={l.glyph !== 'held'}>{l.label.padEnd(24)}</Text><Text color={C.dim}>{l.detail}</Text></Text>
          ))}
          {rig && rig.seats.length ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color={C.faint}>{`  ${t.room.head.seat.padEnd(12)}${t.room.head.name.padEnd(12)}${t.room.head.state}`}</Text>
              {rig.seats.map(s => {
                const st = seatStateLabel(s, tui.escalations, t.seat);
                return <Text key={s.ref} wrap="truncate"><Text color={C.violet}>{`  ${s.address.padEnd(12)}`}</Text><Text color={C.fg} bold>{s.name.padEnd(12)}</Text><Text color={st.color}>{g[st.glyph]} {st.label}</Text></Text>;
              })}
            </Box>
          ) : null}
          {trust ? <Box marginTop={1}><Text color={C.yellow} wrap="truncate">{g.approval} {w.trust(trust.name)}</Text></Box> : null}
          <Box marginTop={1} columnGap={2}>
            <Button label={w.openRoom} k="↵" primary off={rig?.lifecycle !== 'running'} />
            <Button label={w.cancelLaunch} k="x" off={!rig} />
            <Button label={w.backToLedge} k="1" />
          </Box>
          {refused ? <Text color={C.red} wrap="truncate">{refused}</Text> : <Text color={C.faint} wrap="truncate">{w.leave}</Text>}
        </TitledBox>
      </Frame>
    );
  }

  const row = (f: Field | null, label: string, value: ReactNode, key: string = f ?? label) => (
    <Box key={key} backgroundColor={f && at === f ? C.sel : undefined}>
      <Text color={f && at === f ? C.coral : C.faint}>{f && at === f ? '▌' : ' '}</Text>
      <Box width={14} flexShrink={0}><Text color={f && at === f ? C.fg : C.dim}>{label}</Text></Box>
      <Box flexGrow={1} overflow="hidden">{value}</Box>
    </Box>
  );
  const hint = (key: string, text: ReactNode) => row(null, '', <Text color={C.faint} wrap="truncate">{text}</Text>, key);
  const chosen = (label: ReactNode, on: boolean) => (on ? <Text color={C.fg} bold>{`${g.prev} `}{label}{` ${g.next}`}</Text> : <Text color={C.dim}>{label}</Text>);
  const n = spec?.seats.length ?? 0;
  const where = project ? w.inProjectOf(project.name) : w.offPlace;
  const name = form.place.kind === 'off' ? form.place.name : spec?.name ?? form.spec ?? '';
  const first = missing[0];
  const keys: Array<readonly [string, string]> = [['tab', t.keys.nextField], ['← →', t.keys.choose], [t.keys.space, t.keys.tick], ['ctrl+t', w.keys.mode],
    ['ctrl+s', action === 'plan' ? w.keys.seePlan : t.keys.start], ...(action === 'launch' ? [['v', w.keys.seePlan] as const] : []),
    ...(form.place.kind === 'off' ? [['ctrl+r', t.keys.redraw] as const] : []), ['esc', t.keys.cancel]];
  return (
    <Frame crumb={w.crumb} keys={keys}>
      <TitledBox title={w.title} color={C.coral} titleColor={C.coral} flexGrow={1}>
        {row(null, w.mode, <Text><Text color={C.coral}>{g.radioOn} </Text><Text color={C.fg} bold>{w.rig}</Text><Text color={C.dim}>   {g.radioOff} {w.session}</Text><Text color={C.faint}>  ctrl+t</Text></Text>)}
        {row('goal', w.goal, <TextInput value={form.goal} onChange={v => setForm(f => withGoal(f, v))} active={at === 'goal'} />)}
        {hint('goal-hint', w.goalHint)}
        {row('spec', w.spec, specs.status !== 'ready' ? <Text color={C.faint}>{w.specsLoading}</Text> : specs.error || !specs.specs.length ? <Text color={C.yellow}>{specs.error ? w.specsFailed : w.noSpec}</Text> : (
          <Text wrap="truncate">{specs.specs.map(s => <Text key={s.id}>{chosen(s.name, s.name === spec?.name)}{s.name === recName && !touched.spec ? <Text color={C.faint}> {w.recommended}</Text> : null}{'   '}</Text>)}</Text>
        ))}
        {spec ? hint('seats', w.seatsOf(n, spec.seats.map(s => s.member).join(', '), providers(spec.seats).map(p => runtimeLabel(p.runtime)).join(', '))) : null}
        {row('where', w.where, (
          <Text wrap="truncate">
            <Text color={project ? C.coral : C.dim}>{project ? g.radioOn : g.radioOff} </Text><Text color={project ? C.fg : C.dim}>{w.inProject}</Text>{'  '}
            {list.map(p => <Text key={p.id}>{chosen(<><Text color={projectColor(p.color)}>{g.project}</Text> {p.name}</>, p.id === project?.id)}{'  '}</Text>)}
            <Text color={project ? C.dim : C.coral}> {project ? g.radioOff : g.radioOn} </Text><Text color={project ? C.dim : C.fg}>{w.offProject}</Text>
          </Text>
        ))}
        {hint('where-hint', project ? w.whereHint(project.name) : w.offHint)}
        {form.place.kind === 'project' ? <>
          {row('repo', w.repo, repos.length === 0 ? <Text color={C.yellow}>{w.noRepo(project?.name ?? '', machineLabel)}</Text> : (
            <Text wrap="truncate">{repos.map(r => <Text key={r}>{chosen(<><Text color={C.green}>{g.ok}</Text> {r.split('/').filter(Boolean).at(-1) ?? r}</>, form.place.kind === 'project' && r === form.place.repo)}<Text color={C.faint}> {r}</Text>{'   '}</Text>)}</Text>
          ))}
          {row('branch', w.branch, <Box><TextInput value={form.place.branch} onChange={v => { setTouched(x => ({ ...x, branch: true })); setForm(f => (f.place.kind === 'project' ? { ...f, place: { ...f.place, branch: v } } : f)); }} active={at === 'branch'} /><Text color={C.faint}> {w.newBranch}</Text></Box>)}
          {row('copy', w.copyRow, <Text><Text color={form.place.copy ? C.green : C.faint}>{form.place.copy ? g.boxOn : g.boxOff}</Text><Text color={C.fg}> {w.copy}</Text></Text>)}
        </> : null}
        {row('machine', w.machine, <Text wrap="truncate">{machines.map(m => <Text key={m.id} color={m.id === form.machine ? C.fg : C.dim} bold={m.id === form.machine}><Text color={m.ready ? C.green : C.faint}>{g.machine}</Text> {m.label}{'    '}</Text>)}</Text>)}
        {!can.ok ? hint('why', <Text color={C.yellow}>{w.why[can.why](machineLabel)}</Text>) : null}
        {!can.ok && can.install ? hint('install', <Text><Text color={C.dim}>{w.install} </Text><Text color={C.code}>{can.install}</Text></Text>) : null}
        {form.place.kind === 'off' ? row('name', w.name, <Box><TextInput value={form.place.name} onChange={v => setForm(f => ({ ...f, place: { kind: 'off', name: v, nameTouched: true } }))} active={at === 'name'} /><Text color={C.faint}> {w.nameHint}</Text></Box>) : null}
      </TitledBox>
      <TitledBox title={w.preview}>
        <Text wrap="truncate"><Text color={C.coral}>{g.rig} </Text><Text color={C.fg} bold>{name}</Text><Text color={C.dim}>{w.previewLine(spec?.name ?? '-', where, n, machineLabel)}{form.place.kind === 'project' && form.place.branch ? ` · ${g.branch} ${form.place.branch}` : ''}</Text></Text>
        <Box marginTop={1} columnGap={2}>
          {action === 'launch' ? <>
            <Button label={busy === 'preparing' ? w.preparing : w.launch} k="ctrl+s" primary off={!can.ok || !!busy} />
            <Button label={w.seePlan} k="v" off={!can.ok || !!busy} />
          </> : <Button label={busy === 'preparing' ? w.preparing : w.seePlan} k="ctrl+s" primary off={!can.ok || !!busy} />}
          <Button label={w.cancel} k="esc" />
          {refused ? <Text color={C.red} wrap="truncate">{refused}</Text>
            : tried && first ? <Text color={C.yellow} wrap="truncate">{w.missing[first]}</Text>
              : <Text color={C.faint} wrap="truncate">{action === 'plan' ? w.planImposed : w.planOptional}</Text>}
        </Box>
      </TitledBox>
    </Frame>
  );
}
