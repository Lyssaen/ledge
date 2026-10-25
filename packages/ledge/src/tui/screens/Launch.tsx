import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { launchDefaults, launchMessage, missingOf, MULTI_REPO_TOOLS, previewOf, reposOn, toggleRepo, withMachine, withPick, withProject, withTool, type LaunchForm } from '@ledge/fleet/launch';
import { useModels } from '@ledge/fleet/models';
import { pickName, projectOf, type Tool } from '@ledge/protocol';
import { useEditing, useTui } from '../context.js';
import { TOOL_NAME } from '../model/labels.js';
import { C, projectColor } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { Button } from '../ui/SessionCard.js';
import { TextInput } from '../ui/TextInput.js';
import { TitledBox } from '../ui/TitledBox.js';

const FIELDS = ['prompt', 'tool', 'model', 'effort', 'project', 'machine', 'repos', 'folder', 'name'] as const;
type Field = typeof FIELDS[number];
const TEXT: ReadonlySet<Field> = new Set(['prompt', 'folder']);
/** A launch not answered by then is given up (the daemon's own LAUNCH_TIMEOUT_MS). */
const LAUNCH_MS = 20_000;

/** `list[i ± 1]`, wrapping. */
const cycle = <T,>(list: readonly T[], cur: T, by: number): T => list[((Math.max(0, list.indexOf(cur)) + by) % list.length + list.length) % list.length]!;

export function Launch() {
  const { client, d, machines, projects, t, g, toast, go, select } = useTui();
  const list = projects?.projects ?? [];
  const [form, setForm] = useState<LaunchForm>(() => launchDefaults(list, machines, {}, 'claude'));
  const [field, setField] = useState<Field>('prompt');
  const [folder, setFolder] = useState('');
  const [repoAt, setRepoAt] = useState(0);
  const [launching, setLaunching] = useState<{ seq: number; errorSeq: number; at: number; name: string } | null>(null);
  useEditing(true);

  // A machine that comes up after the form opened is chosen when none was.
  useEffect(() => { if (form.machine === null) { const up = machines.find(m => m.ready); if (up) setForm(f => withMachine(f, list, up.id)); } }, [machines]); // eslint-disable-line react-hooks/exhaustive-deps

  const machine = machines.find(m => m.id === form.machine);
  const tools: Tool[] = ['claude', 'codex', 'cursor', ...(machine?.daemon?.omp ? ['omp' as const] : [])];
  const models = useModels(client, machine?.daemon?.models ? form.machine : null, form.tool);
  const modelIds = [null, ...models.models.map(m => m.id as string)];
  const model = models.models.find(m => m.id === form.model);
  const efforts = [null, ...(model?.efforts ?? [])];
  const project = list.find(p => p.id === form.project);
  const repoOptions = useMemo(() => {
    const own = reposOn(project, form.machine).map(r => r.path);
    return own.length ? own : (machine?.recents ?? []).slice(0, 6).map(r => r.cwd);
  }, [project, form.machine, machine?.recents]);
  const withFolder: LaunchForm = folder.trim() ? { ...form, repos: MULTI_REPO_TOOLS.has(form.tool) ? [folder.trim(), ...form.repos.filter(r => r !== folder.trim())] : [folder.trim()] } : form;
  const projectIdOf = (s: Parameters<typeof projectOf>[0]) => (projects ? projectOf(s, projects) : null);
  const drawn = useMemo(() => previewOf(withFolder, d.sessions, projectIdOf), [form.machine, form.project, d.sessions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [name, setName] = useState<string | null>(null);
  const shownName = name ?? drawn.name;
  const missing = missingOf(withFolder, machines);

  // The launch is answered by its `session.launched` (the new session is selected) or refused by an error without a session id.
  useEffect(() => {
    if (!launching) return;
    if ((d.lastLaunched?.seq ?? 0) > launching.seq) {
      select(d.lastLaunched!.id); toast({ text: t.launch.launched(launching.name), tone: 'ok' }); setLaunching(null); go('overview'); return;
    }
    const refused = d.errors.find(e => e.seq > launching.errorSeq && e.id === undefined);
    if (refused) { toast({ text: refused.message, tone: 'error' }); setLaunching(null); return; }
    const timer = setTimeout(() => setLaunching(null), Math.max(0, launching.at + LAUNCH_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [launching, d.lastLaunched, d.errors]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = () => {
    if (launching) return;
    if (missing) { toast({ text: t.launch.missing[missing], tone: 'info' }); setField(missing === 'prompt' ? 'prompt' : missing === 'machine' ? 'machine' : 'repos'); return; }
    setLaunching({ seq: d.lastLaunched?.seq ?? 0, errorSeq: d.errors.at(-1)?.seq ?? 0, at: Date.now(), name: shownName });
    client.send(launchMessage(withFolder, shownName));
  };

  useInput((input, key) => {
    if (key.escape) { go('overview'); return; }
    if (key.ctrl && input === 's') { launch(); return; }
    if (key.ctrl && input === 'r') { setName(pickName([...d.sessions.map(s => s.name), shownName])); return; }
    if (key.tab || key.downArrow || (key.return && field !== 'name')) { setField(f => cycle(FIELDS, f, key.shift ? -1 : 1)); return; }
    if (key.upArrow) { setField(f => cycle(FIELDS, f, -1)); return; }
    if (key.return) { launch(); return; }
    if (TEXT.has(field)) return;
    const by = key.rightArrow || input === 'l' ? 1 : key.leftArrow || input === 'h' ? -1 : 0;
    if (field === 'repos') {
      if (by) setRepoAt(i => (repoOptions.length ? (i + by + repoOptions.length) % repoOptions.length : 0));
      else if (input === ' ' && repoOptions[repoAt]) setForm(f => toggleRepo(f, repoOptions[repoAt]!));
      return;
    }
    if (!by) return;
    if (field === 'tool') setForm(f => withTool(f, cycle(tools, f.tool, by)));
    else if (field === 'model') setForm(f => withPick(f, { model: cycle(modelIds, f.model, by), effort: null }));
    else if (field === 'effort') setForm(f => withPick(f, { model: f.model, effort: cycle(efforts, f.effort, by) }));
    else if (field === 'project') { const ids = [...list.map(p => p.id), null]; setForm(f => { const next = cycle(ids, f.project, by); return next === null ? { ...f, project: null, repos: [] } : withProject(f, list, next); }); setRepoAt(0); }
    else if (field === 'machine') { const up = machines.filter(m => m.ready).map(m => m.id); if (up.length) setForm(f => withMachine(f, list, cycle(up, f.machine ?? up[0]!, by))); setRepoAt(0); }
  });

  const row = (f: Field, label: string, value: ReactNode) => (
    <Box key={f} backgroundColor={field === f ? C.sel : undefined}>
      <Text color={field === f ? C.coral : C.faint}>{field === f ? '▌' : ' '}</Text>
      <Box width={14} flexShrink={0}><Text color={C.dim}>{label}</Text></Box>
      <Box flexGrow={1} overflow="hidden">{value}</Box>
    </Box>
  );
  const choice = <T extends string | null,>(items: readonly T[], cur: T, label: (x: T) => string, color?: (x: T) => string | undefined) => (
    <Text wrap="truncate">{items.map((x, i) => (
      <Text key={i}>{x === cur ? <Text color={C.fg} bold>{`${g.prev} ${label(x)} ${g.next}`}</Text> : <Text color={color?.(x) ?? C.dim}>{label(x)}</Text>}{'   '}</Text>
    ))}</Text>
  );
  return (
    <Frame crumb={t.launch.title} keys={[['tab', t.keys.nextField], ['← →', t.keys.choose], [t.keys.space, t.keys.tick], ['ctrl+s', t.keys.start], ['ctrl+r', t.keys.redraw], ['esc', t.keys.cancel]]}>
      <TitledBox title={t.launch.title} flexGrow={1}>
        {row('prompt', t.launch.instruction, <TextInput value={form.prompt} onChange={v => setForm(f => ({ ...f, prompt: v }))} active={field === 'prompt'} />)}
        <Text> </Text>
        {row('tool', t.launch.agent, <Text wrap="truncate">{tools.map(x => <Text key={x} color={x === form.tool ? C.coral : C.dim}>{x === form.tool ? g.radioOn : g.radioOff} {TOOL_NAME[x]}   </Text>)}</Text>)}
        {row('model', t.launch.model, models.status === 'loading' ? <Text color={C.faint}>{t.launch.loading}</Text> : choice(modelIds, form.model, x => x === null ? t.launch.defaultModel : (models.models.find(m => m.id === x)?.label ?? x)))}
        {row('effort', t.launch.effort, efforts.length > 1 ? choice(efforts, form.effort, x => x ?? t.launch.defaultModel) : <Text color={C.faint}>{t.launch.defaultModel}</Text>)}
        {row('project', t.launch.project, choice([...list.map(p => p.id), null], form.project, x => x === null ? t.launch.none : list.find(p => p.id === x)!.name, x => projectColor(list.find(p => p.id === x)?.color)))}
        {row('machine', t.launch.machine, <Text wrap="truncate">{machines.map(m => <Text key={m.id} color={m.id === form.machine ? C.fg : C.dim} bold={m.id === form.machine}><Text color={m.ready ? C.green : C.faint}>{g.machine}</Text> {m.label}{'    '}</Text>)}</Text>)}
        {row('repos', t.launch.repos, repoOptions.length === 0 ? <Text color={C.faint}>{t.launch.none}</Text> : (
          <Text wrap="truncate">{repoOptions.map((r, i) => (
            <Text key={r} backgroundColor={field === 'repos' && i === repoAt ? '#3a3532' : undefined} color={form.repos.includes(r) ? C.fg : C.dim}>
              <Text color={form.repos.includes(r) ? C.green : C.faint}>{form.repos.includes(r) ? g.boxOn : g.boxOff}</Text> {r.split('/').filter(Boolean).at(-1) ?? r} <Text color={C.faint}>{r}</Text>{'   '}
            </Text>
          ))}</Text>
        ))}
        {row('folder', t.launch.folder, <TextInput value={folder} onChange={setFolder} active={field === 'folder'} placeholder={t.launch.folderHint} />)}
        {row('name', t.launch.name, <Text>{shownName} <Text color={C.faint}>{t.launch.drawn}</Text></Text>)}
      </TitledBox>
      <TitledBox title={t.launch.preview} color={C.coral} titleColor={C.coral}>
        <Text wrap="truncate"><Text color={C.fg} bold>{project ? t.launch.joins(shownName, project.name) : shownName}</Text>
          <Text color={C.faint}> · {machine?.label ?? '-'} · {TOOL_NAME[form.tool]} · {form.model ?? t.launch.defaultModel}{form.effort ? ` · ${form.effort}` : ''}</Text></Text>
        <Box marginTop={1} columnGap={2}>
          <Button label={launching ? t.launch.launching : t.launch.launch} k="ctrl+s" primary />
          <Button label={t.launch.cancel} k="esc" />
          {missing ? <Text color={C.yellow}>{t.launch.missing[missing]}</Text> : <Text color={C.faint}>{t.launch.thenAttach}</Text>}
        </Box>
      </TitledBox>
    </Frame>
  );
}
