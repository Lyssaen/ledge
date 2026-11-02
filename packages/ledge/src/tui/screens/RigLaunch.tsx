import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { launchRig, useRigSpecs } from '@ledge/fleet/openrig';
import { RIG_POLICIES, type OpenRigLaunched, type RigSpec } from '@ledge/protocol';
import { useEditing, useTui } from '../context.js';
import {
  emptyForm, fieldsOf, folderChoices, isText, launchOf, missingOf, modelOf, moveField, nameOf, nextFolder, orderSpecs, roleAt, rolesOf,
  runtimeOf, scaled, seatsOf, totalSeats, warningLines, withModel, withPolicy, withRolePolicy, withRuntime, withSeats, withSpec, yoloChosen, type FieldId, type RigForm
} from '../model/rigLaunch.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { TextInput } from '../ui/TextInput.js';
import { TitledBox } from '../ui/TitledBox.js';

/** How many specs the first panel shows at once, around the one chosen. */
const SPEC_ROWS = 7;

/** A spec as its line reads: its roles joined, then how many seats. */
const specLine = (s: RigSpec): string => {
  const members = s.pods.flatMap(p => p.members.map(m => m.id));
  return `${members.slice(0, 4).join(' + ')}${members.length > 4 ? '…' : ''} · ${members.length}`;
};

/**
 * « Lancer un rig » (docs/mockups/ledge-openrig.html, view 4, « Lancer un rig (+) »), from the OpenRig screen, on the machine
 * it shows: a spec, a folder and a name, the seats of each role, how added seats delegate; `p` checks it (`rig up --plan`) and
 * the preview shows what OpenRig said and the spec it would run; ctrl+s launches, then back to the OpenRig screen.
 */
export function RigLaunchScreen() {
  const tui = useTui();
  const { t, g, machines, projects, client, toast, go, small } = tui;
  const l = t.rigLaunch;
  const machine = machines.find(m => m.id === tui.kept.rigMachine) ?? machines[0] ?? null;
  const machineId = machine?.id ?? null;
  const specsView = useRigSpecs(client, machineId);
  const specs = useMemo(() => orderSpecs(specsView.specs), [specsView.specs]);
  const folders = useMemo(() => folderChoices(projects, machineId), [projects, machineId]);
  const [form, setFormState] = useState<RigForm>(() => emptyForm(null, folders[0]?.path ?? ''));
  const [field, setField] = useState<FieldId>('spec');
  const [modelAt, setModelAt] = useState<number | null>(null);
  const [modelDraft, setModelDraft] = useState('');
  const [busy, setBusy] = useState<'check' | 'launch' | null>(null);
  const [result, setResult] = useState<OpenRigLaunched | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEditing(true);

  const spec = specs.find(s => s.name === form.spec);
  const roles = rolesOf(spec);
  const yolo = yoloChosen(form, roles);
  const fields = fieldsOf(roles, yolo);
  // The first spec is chosen once the list comes; the folder too, once the projects come.
  useEffect(() => { if (!form.spec && specs[0]) setFormState(f => withSpec(f, specs[0]!.name)); }, [specs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!form.cwd && folders[0]) setFormState(f => ({ ...f, cwd: folders[0]!.path })); }, [folders]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Any change makes the last check stale: the preview asks for another. */
  const setForm = (fn: (f: RigForm) => RigForm) => { setFormState(fn); setResult(null); };

  const submit = (plan: boolean) => {
    if (busy || !machineId) return;
    const missing = missingOf(form, roles);
    if (missing) { toast({ text: l.missing[missing], tone: 'info' }); return; }
    setBusy(plan ? 'check' : 'launch'); setResult(null);
    const launch = launchOf(form, roles, plan);
    void launchRig(client, machineId, launch).then(r => {
      if (!alive.current) return;
      setBusy(null); setResult(r);
      if (!r.ok) { toast({ text: l.why[r.error ?? ''] ?? r.error ?? '', tone: 'error' }); return; }
      if (!plan) { toast({ text: l.launched(launch.name, r.seats ?? totalSeats(form, roles)), tone: 'ok' }); go('openrig'); }
    });
  };

  const role = roleAt(field) !== null ? roles[roleAt(field)!] : undefined;
  useInput((input, key) => {
    if (small && !key.escape) return;
    if (busy === 'launch') return;
    if (modelAt !== null) {
      // The model's field has the keys; tab leaves it as ↵ does.
      if (key.tab) { const r = roles[modelAt]; if (r) setForm(f => withModel(f, r, modelDraft)); setModelAt(null); }
      return;
    }
    if (key.escape) { go('openrig'); return; }
    if (key.ctrl && input === 's') { submit(false); return; }
    if (key.ctrl && input === 'p') { submit(true); return; }
    if (key.tab || key.downArrow) { setField(f => moveField(fields, f, key.shift ? -1 : 1)); return; }
    if (key.upArrow) { setField(f => moveField(fields, f, -1)); return; }
    const by = key.rightArrow ? 1 : key.leftArrow ? -1 : 0;
    if (field === 'cwd' && by) { setForm(f => ({ ...f, cwd: nextFolder(folders, f.cwd, by) })); return; }
    if (isText(field)) return;
    if (input === 'p') { submit(true); return; }
    if (field === 'spec' && by && specs.length) {
      const i = Math.max(0, specs.findIndex(s => s.name === form.spec));
      setForm(f => withSpec(f, specs[(i + by + specs.length) % specs.length]!.name)); return;
    }
    if (role) {
      if (by) setForm(f => withRuntime(f, role, by));
      else if (input === '+' || input === '=') setForm(f => withSeats(f, role.role, 1));
      else if (input === '-') setForm(f => withSeats(f, role.role, -1));
      else if (input === 'm') { setModelAt(roleAt(field)); setModelDraft(modelOf(form, role) ?? ''); }
      else if (input === 'o') setForm(f => withRolePolicy(f, role.role));
      return;
    }
    if (field === 'policy' && by) { setForm(f => withPolicy(f, by)); return; }
    if (field === 'nonInterruptive' && (by || input === ' ' || key.return)) { setForm(f => ({ ...f, nonInterruptive: !f.nonInterruptive })); return; }
    if (field === 'delegation' && (by || input === ' ')) { setForm(f => ({ ...f, delegation: f.delegation === 'pairs' ? 'all' : 'pairs' })); return; }
    if (field === 'save' && (by || input === ' ' || key.return)) { setForm(f => ({ ...f, save: !f.save })); return; }
  });

  const row = (f: FieldId, label: string, value: ReactNode, width = 9) => (
    <Box key={f} flexShrink={0} backgroundColor={field === f ? C.sel : undefined}>
      <Text color={field === f ? C.coral : C.faint}>{field === f ? '▌' : ' '}</Text>
      <Box width={width} flexShrink={0}><Text color={C.dim}>{label}</Text></Box>
      <Box flexGrow={1} overflow="hidden">{value}</Box>
    </Box>
  );
  const chosen = (on: boolean, text: string) => (on ? <Text color={C.fg} bold>{`${g.prev} ${text} ${g.next}`}</Text> : <Text color={C.dim}>{text}</Text>);

  // The specs shown: a window around the one chosen.
  const at = Math.max(0, specs.findIndex(s => s.name === form.spec));
  const from = Math.max(0, Math.min(at - Math.floor(SPEC_ROWS / 2), specs.length - SPEC_ROWS));
  const folderOf = folders.find(f => f.path === form.cwd);
  const seats = totalSeats(form, roles);
  const stopped = specsView.error === 'daemon_stopped';

  const keys: Array<[string, string]> = modelAt !== null
    ? [['↵', t.keys.apply], ['esc', t.keys.cancel]]
    : [['tab ↑ ↓', t.keys.nextField], ['← →', t.keys.choose], ['- +', l.count], ['m', l.modelKey], ['o', l.policyKey], ['p', l.check], ['ctrl+s', l.launch(seats)], ['esc', t.keys.cancel]];

  return (
    <Frame crumb={`${l.title} · ${machine?.label ?? '-'}`} crumbShort={l.title} keys={keys}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width="55%" flexShrink={0}>
          <TitledBox title={l.spec} color={field === 'spec' ? C.coral : C.line} titleColor={field === 'spec' ? C.coral : C.dim} flexShrink={0} height={(specs.length ? Math.min(SPEC_ROWS, specs.length) : 2) + 2}>
            {specsView.status === 'loading' ? <Text color={C.faint}>{l.loading}</Text>
              : stopped ? <Text color={C.yellow}>{l.daemonStopped}</Text>
              : specsView.error ? <Text color={C.yellow}>{l.why[specsView.error] ?? specsView.error}</Text>
              : !specs.length ? <Text color={C.faint}>{l.noSpecs}</Text>
              : specs.slice(from, from + SPEC_ROWS).map(s => {
                const on = s.name === form.spec;
                return (
                  <Box key={`${s.source}:${s.name}`} flexShrink={0} backgroundColor={on && field === 'spec' ? C.sel : undefined}>
                    <Text wrap="truncate">
                      <Text color={on ? C.coral : C.dim}>{on ? g.radioOn : g.radioOff} </Text>
                      <Text color={on ? C.fg : C.dim} bold={on}>{s.name.padEnd(16)}</Text>
                      <Text color={C.dim}>{specLine(s).padEnd(24)}</Text>
                      <Text color={C.faint}>{l.source[s.source] ?? s.source}</Text>
                    </Text>
                  </Box>
                );
              })}
          </TitledBox>
          <TitledBox title={l.where} flexShrink={0} height={folderOf ? 5 : 4}>
            {row('cwd', l.folder, <Box><TextInput value={form.cwd} onChange={v => setForm(f => ({ ...f, cwd: v }))} active={field === 'cwd' && modelAt === null} placeholder={l.folderHint} /></Box>)}
            {folderOf ? <Box flexShrink={0}><Text wrap="truncate" color={C.faint}>{'          '}{g.prev} {l.projectFolder(folderOf.project)} {g.next}</Text></Box> : null}
            {row('name', l.name, <Box><TextInput value={form.name ?? ''} onChange={v => setForm(f => ({ ...f, name: v }))} active={field === 'name' && modelAt === null} placeholder={form.spec ?? ''} /></Box>)}
          </TitledBox>
          <TitledBox title={l.roles} flexGrow={1} flexShrink={1}>
            {roles.length ? <Box flexShrink={0}><Text wrap="truncate" color={C.faint}>{l.rolesHint}</Text></Box> : null}
            {roles.map((r, i) => {
              const f: FieldId = `role:${i}`, on = field === f, n = seatsOf(form, r.role);
              const runtime = runtimeOf(form, r), model = modelOf(form, r);
              return (
                <Box key={r.role} flexShrink={0} backgroundColor={on ? C.sel : undefined}>
                  <Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>
                  <Box width={14} flexShrink={0}><Text wrap="truncate" color={C.fg} bold>{r.role}</Text></Box>
                  <Box width={16} flexShrink={0}><Text wrap="truncate">{chosen(on, runtime)}</Text></Box>
                  <Box width={7} flexShrink={0}><Text><Text color={C.dim}>− </Text><Text color={n === 1 ? C.fg : C.green} bold>{n}</Text><Text color={C.dim}> +</Text></Text></Box>
                  <Box width={13} flexShrink={0}><Text wrap="truncate" color={form.policies[r.role] === 'yolo' ? C.red : form.policies[r.role] ? C.fg : C.faint}>{form.policies[r.role] ? l.policyOf[form.policies[r.role]!] : l.asRig}</Text></Box>
                  <Box flexGrow={1} overflow="hidden">
                    {modelAt === i
                      ? <TextInput value={modelDraft} onChange={setModelDraft} active onSubmit={v => { setForm(x => withModel(x, r, v)); setModelAt(null); }} onEscape={() => setModelAt(null)} placeholder={l.defaultModel} />
                      : <Text wrap="truncate" color={model ? C.fg : C.faint}>{model ?? l.defaultModel}</Text>}
                  </Box>
                </Box>
              );
            })}
          </TitledBox>
          <TitledBox title={l.permissions} flexShrink={0}>
            {row('policy', '', <Text wrap="truncate">{chosen(field === 'policy' || form.policy !== null, form.policy === null ? l.specPolicy(spec?.policy ?? l.noSpecPolicy) : l.policyOf[form.policy]!)}<Text color={C.faint}>{`  ${[null, ...RIG_POLICIES].indexOf(form.policy) + 1}/${RIG_POLICIES.length + 1}`}</Text></Text>, 1)}
            <Box flexShrink={0} paddingLeft={3}><Text wrap="wrap" color={(form.policy ?? spec?.policy?.replace(/^builtin:/, '')) === 'yolo' ? C.red : C.faint}>{l.policyHint[form.policy ?? spec?.policy?.replace(/^builtin:/, '') ?? 'none'] ?? l.policyHint.none}</Text></Box>
            {yolo ? row('nonInterruptive', '', <Text wrap="truncate"><Text color={form.nonInterruptive ? C.red : C.faint}>{form.nonInterruptive ? g.boxOn : g.boxOff}</Text><Text color={C.dim}> {l.nonInterruptive}</Text></Text>, 1) : null}
          </TitledBox>
          <TitledBox title={l.delegation} flexShrink={0} height={4}>
            {row('delegation', '', <Text wrap="truncate">{scaled(form, roles)
              ? <>{chosen(form.delegation === 'pairs', l.pairs)}<Text color={C.faint}> {l.pairsHint}   </Text>{chosen(form.delegation === 'all', l.all)}</>
              : <Text color={C.faint}>{l.notScaled}</Text>}</Text>, 1)}
            {row('save', '', <Text wrap="truncate"><Text color={form.save ? C.green : C.faint}>{form.save ? g.boxOn : g.boxOff}</Text><Text color={C.dim}> {l.save}{form.save ? ` : ${nameOf(form)}` : ''}</Text></Text>, 1)}
          </TitledBox>
        </Box>
        <Preview busy={busy} result={result} seats={seats} />
      </Box>
    </Frame>
  );
}

function Preview({ busy, result, seats }: { busy: 'check' | 'launch' | null; result: OpenRigLaunched | null; seats: number }) {
  const { t } = useTui();
  const l = t.rigLaunch;
  const check = result?.check;
  return (
    <TitledBox title={l.preview} flexGrow={1} color={C.coral} titleColor={C.coral}>
      {busy ? <Text color={C.blue}>{busy === 'check' ? l.checking : l.launching}</Text>
        : !result ? <Text wrap="wrap" color={C.faint}>{l.noCheck}</Text>
        : <>
          {check ? (check.status === 'planned' && !check.errors.length
            ? <Text color={C.green} bold>{l.passes(result.seats ?? seats)}</Text>
            : <Text color={check.errors.length ? C.red : C.yellow} bold>{l.planStatus(check.status)}</Text>) : null}
          {!result.ok ? <Text wrap="wrap" color={C.red}>{l.why[result.error ?? ''] ?? result.error}</Text> : null}
          {check?.errors.map((e, i) => <Text key={`e${i}`} wrap="wrap" color={C.red}>{e}</Text>)}
          {warningLines(check?.warnings ?? []).map((w, i) => <Text key={`w${i}`} wrap="wrap" color={C.yellow}>{l.warning(w.text, w.seats.join(', '))}</Text>)}
          {result.commands.map(c => <Text key={c} wrap="truncate" color={C.faint}>{c}</Text>)}
          {result.yaml ? <Box marginTop={1} flexDirection="column">{result.yaml.split('\n').map((line, i) => <YamlLine key={i} line={line} />)}</Box> : null}
        </>}
    </TitledBox>
  );
}

/** A YAML line: its key in blue, its value in green, a comment faint. */
function YamlLine({ line }: { line: string }) {
  const m = /^(\s*-?\s*)([A-Za-z0-9_.-]+:)(.*)$/.exec(line);
  if (line.trim().startsWith('#')) return <Text wrap="truncate" color={C.faint}>{line || ' '}</Text>;
  if (!m) return <Text wrap="truncate" color={C.dim}>{line || ' '}</Text>;
  return <Text wrap="truncate"><Text color={C.dim}>{m[1]}</Text><Text color={C.blue}>{m[2]}</Text><Text color={C.green}>{m[3]}</Text></Text>;
}
