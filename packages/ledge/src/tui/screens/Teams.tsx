import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { randomUUID } from 'node:crypto';
import { useTeams } from '@ledge/fleet';
import { projectOf, ROLE_PROMPT_MAX, type DefinitionProblem, type Role, type TeamTemplate } from '@ledge/protocol';
import { useScreenKeys, useTui } from '../context.js';
import { bySource, catalogScopes, heldBy, initialScope, projectOfFolder, stepIndex, usedIn, type Scope } from '../model/catalog.js';
import { fit, TOOL_NAME } from '../model/labels.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { Instruction } from '../ui/Instruction.js';
import { TitledBox } from '../ui/TitledBox.js';
import { WIDE, windowed } from './Overview.js';

type View = 'roles' | 'templates';
type Defs = { roles: Role[]; templates: TeamTemplate[]; problems: DefinitionProblem[] };
type Row = { kind: 'head'; key: string; text: string } | { kind: 'role'; key: string; role: Role } | { kind: 'template'; key: string; template: TeamTemplate };
/** Read from the palette at each render: it changes with the tone. */
const autonomyColor = (a: 'ask' | 'edits' | 'auto'): string => (a === 'auto' ? C.yellow : a === 'edits' ? C.blue : C.faint);

/** « Équipes » (6, #97): the roles and team templates a folder sees, its repository's then the home's, read only. ↵ hands
 *  the selected one to « Nouvelle session », o opens its file, c changes the folder, ! shows the files skipped. */
export function Teams() {
  const tui = useTui();
  const { client, d, projects, machines, t, g, selected, catalog, go } = tui;
  const { columns, rows: height } = useWindowSize();
  const wide = columns >= WIDE;
  const left = wide ? Math.min(64, Math.max(44, Math.floor(columns * 0.42))) : columns;
  const teams = useTeams(client) ?? [];
  const recents = machines.find(m => m.id === 'local')?.recents.map(r => r.cwd) ?? [];
  const scopes = catalogScopes({ selected, memo: catalog.current, projects, recents, homeOnly: t.catalog.homeOnly });
  const [scope, setScope] = useState<Scope>(() => initialScope(scopes, selected, catalog.current));
  const [defs, setDefs] = useState<Defs | null>(null);
  const [view, setView] = useState<View>('roles');
  const [at, setAt] = useState<Record<View, string | null>>({ roles: null, templates: null });
  const [problems, setProblems] = useState(false);

  // Read at opening and at each change of folder; nothing watches the files.
  useEffect(() => {
    setDefs(null);
    const requestId = `tui-catalog-${randomUUID()}`;
    const off = client.onMessage(m => {
      if (m.type !== 'roles.listing' || m.requestId !== requestId) return;
      off(); setDefs({ roles: m.roles, templates: m.templates, problems: m.problems });
    });
    client.send({ type: 'roles.list', requestId, ...(scope.cwd ? { cwd: scope.cwd } : {}) });
    return off;
  }, [scope.cwd]); // eslint-disable-line react-hooks/exhaustive-deps

  const roles = bySource(defs?.roles ?? []), templates = bySource(defs?.templates ?? []);
  const order: Row[] = useMemo(() => view === 'roles'
    ? [...roles.repo.map(role => ({ kind: 'role' as const, key: role.id, role })), ...roles.home.map(role => ({ kind: 'role' as const, key: role.id, role }))]
    : [...templates.repo.map(template => ({ kind: 'template' as const, key: template.id, template })), ...templates.home.map(template => ({ kind: 'template' as const, key: template.id, template }))],
  [defs, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = order.find(r => r.key === at[view]) ?? order[0];
  const role = current?.kind === 'role' ? current.role : undefined;
  const template = current?.kind === 'template' ? current.template : undefined;
  const project = projectOfFolder(projects, scope.cwd);

  useScreenKeys((input, key) => {
    if (problems && (key.escape || input === '!')) { setProblems(false); return true; }
    if (input === '!') { if (defs?.problems.length) setProblems(true); return true; }
    if (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') { setView(v => (v === 'roles' ? 'templates' : 'roles')); setProblems(false); return true; }
    if (input === 'j' || key.downArrow || input === 'k' || key.upArrow) {
      const i = Math.max(0, order.findIndex(r => r.key === current?.key));
      const next = order[stepIndex(order.length, i, input === 'j' || key.downArrow ? 1 : -1)];
      if (next) setAt(x => ({ ...x, [view]: next.key }));
      return true;
    }
    if (input === 'c') {
      const next = scopes[stepIndex(scopes.length, scopes.findIndex(x => x.cwd === scope.cwd), 1)]!;
      catalog.current.folder = next.cwd; setScope(next); setProblems(false);
      return true;
    }
    if (key.return && current) {
      catalog.current.launch = { cwd: scope.cwd, project, ...(role ? { role } : {}), ...(template ? { template: template.id } : {}) };
      go('launch');
      return true;
    }
    if (input === 'o' && current) {
      const editor = (tui.env.VISUAL || tui.env.EDITOR || 'vi').split(/\s+/).filter(Boolean);
      tui.runInTerminal([...editor, role?.path ?? template!.path]);
      return true;
    }
    return false;
  });

  const head = (key: string, text: string): Row => ({ kind: 'head', key, text });
  const list: Row[] = view === 'roles'
    ? [...(roles.repo.length ? [head('h:repo', t.catalog.repoRoles), ...order.filter(r => r.kind === 'role' && r.role.source === 'repo')] : []),
      ...(roles.home.length ? [head('h:home', t.catalog.homeRoles), ...order.filter(r => r.kind === 'role' && r.role.source === 'home')] : [])]
    : [...(templates.repo.length ? [head('h:repo', t.catalog.repoTeams), ...order.filter(r => r.kind === 'template' && r.template.source === 'repo')] : []),
      ...(templates.home.length ? [head('h:home', t.catalog.homeTeams), ...order.filter(r => r.kind === 'template' && r.template.source === 'home')] : [])];
  const issues = defs?.problems ?? [];
  // The status bar, the key bar, the toast, the box's borders, its tab line and its footer.
  const listHeight = Math.max(3, height - 3 - 3 - 1 - (issues.length ? 2 : 0));
  const inner = left - 4;
  const roleById = (id: string) => defs?.roles.find(r => r.id === id);
  const autonomy = (r: Role | undefined) => r?.autonomy ?? 'ask';

  const tabs = (
    <Text wrap="truncate">
      {(['roles', 'templates'] as const).map((v, i) => <Text key={v}>{i ? <Text color={C.faint}> · </Text> : null}<Text color={v === view ? C.coral : C.dim} bold={v === view}>{v === view ? t.catalog[v].toUpperCase() : t.catalog[v]}</Text></Text>)}
    </Text>
  );
  const listBox = (
    <TitledBox title={scope.label} flexGrow={1}>
      {tabs}
      {defs === null ? <Text color={C.faint}>{t.catalog.loading}</Text>
        : list.length === 0 ? <Text color={C.faint}>{view === 'roles' ? t.catalog.noRole : t.catalog.noTemplateHere}</Text>
        : windowed(list, current?.key ?? null, listHeight).map(r => {
          if (r.kind === 'head') return <Text key={r.key} wrap="truncate" color={C.faint}> {r.text}</Text>;
          const on = r.key === current?.key;
          return (
            <Text key={r.key} wrap="truncate" backgroundColor={on ? C.sel : undefined}>
              <Text color={on ? C.coral : C.faint}>{on ? '▌' : ' '}</Text>
              {r.kind === 'role' ? <>
                <Text color={C.violet}>@{fit(r.role.id, 8)}</Text> <Text color={C.fg}>{fit(r.role.label, 12)}</Text> <Text color={C.dim}>{fit(r.role.tool ? TOOL_NAME[r.role.tool] : '', 13)}</Text> <Text color={autonomyColor(autonomy(r.role))}>{t.catalog.autonomyShort[autonomy(r.role)]}</Text>
              </> : <>
                <Text color={C.violet}>{g.team}</Text> <Text color={C.fg}>{fit(r.template.name, 12)}</Text> <Text color={C.dim}>{fit(r.template.seats.map(s => `@${s.role}`).join(' '), Math.max(6, inner - 16))}</Text>
              </>}
            </Text>
          );
        })}
      {issues.length ? <><Text> </Text><Text wrap="truncate"><Text color={C.yellow}>{t.catalog.ignored(issues.length)}</Text>  <Text color={C.faint}>! {t.catalog.see}</Text></Text></> : null}
    </TitledBox>
  );

  const field = (label: string, value: ReactNode) => <Text wrap="truncate"><Text color={C.dim}>{fit(label, 11)}</Text>{value}</Text>;
  const detail = problems ? (
    <TitledBox title={t.catalog.problems} color={C.yellow} titleColor={C.yellow} flexGrow={1}>
      {issues.length === 0 ? <Text color={C.faint}>{t.catalog.noProblem}</Text> : issues.map(p => (
        <Box key={p.path} flexDirection="column" marginBottom={1}><Text wrap="truncate" color={C.fg}>{p.path}</Text><Text wrap="wrap" color={C.dim}>{p.reason}</Text></Box>
      ))}
    </TitledBox>
  ) : role ? (
    <>
      <TitledBox title={`@${role.id} · ${role.label} · ${role.source === 'repo' ? t.catalog.repo : t.catalog.home}`} color={C.coral} titleColor={C.coral}>
        {field(t.catalog.tool, <Text color={C.fg}>{role.tool ? TOOL_NAME[role.tool] : t.catalog.toolDefault}</Text>)}
        {field(t.catalog.model, <Text><Text color={role.model ? C.fg : C.faint}>{role.model ?? t.catalog.toolDefault}</Text>  <Text color={C.dim}>{t.catalog.effort}</Text> <Text color={C.fg}>{role.effort ?? '—'}</Text></Text>)}
        {field(t.catalog.autonomy, <Text color={autonomyColor(autonomy(role))}>{t.ask.autonomy[autonomy(role)]}</Text>)}
        {field(t.catalog.file, <Text color={C.dim}>{role.path}</Text>)}
        {role.shadows ? field('', <Text color={C.dim}>{t.catalog.replaces(role.shadows)}</Text>) : null}
        {field(t.catalog.usedIn, (() => { const xs = usedIn(role.id, defs?.templates ?? []); return xs.length ? <Text>{xs.map(x => <Text key={x.id} color={C.violet}>{g.team} {x.name}  </Text>)}</Text> : <Text color={C.faint}>{t.catalog.noTemplate}</Text>; })())}
        {field(t.catalog.heldBy, (() => {
          const xs = heldBy(role.id, d.sessions, teams, project, s => (projects ? projectOf(s, projects) : null));
          return xs.length ? <Text>{xs.map(x => <Text key={x.name}><Text color={C.fg} bold>{x.name}</Text>{x.team ? <Text color={C.dim}> {x.team}</Text> : null}  </Text>)}</Text> : <Text color={C.faint}>{t.catalog.nobody}</Text>;
        })())}
      </TitledBox>
      <TitledBox title={t.catalog.instruction(role.prompt.length, ROLE_PROMPT_MAX)} flexGrow={1}>
        <Instruction text={role.prompt} empty={t.catalog.noInstruction} />
      </TitledBox>
    </>
  ) : template ? (
    <TitledBox title={`${g.team} ${template.name} · ${t.catalog.seats(template.seats.length)} · ${template.source === 'repo' ? t.catalog.repo : t.catalog.home}`} color={C.coral} titleColor={C.coral} flexGrow={1}>
      {template.seats.map(s => {
        const r = roleById(s.role);
        const tool = s.tool ?? r?.tool;
        return (
          <Text key={s.role} wrap="truncate">
            <Text color={C.violet}>@{fit(s.role, 8)}</Text> <Text color={C.fg}>{fit(r?.label ?? '?', 12)}</Text> <Text color={s.tool ? C.blue : C.dim}>{tool ? TOOL_NAME[tool] : t.catalog.toolDefault}</Text>
            {s.model ? <Text color={C.blue}> · {s.model}</Text> : r?.model ? <Text color={C.dim}> · {r.model}</Text> : null}
            {' '}<Text color={autonomyColor(autonomy(r))}>{t.catalog.autonomyShort[autonomy(r)]}</Text>
          </Text>
        );
      })}
      <Text> </Text>
      {(() => { const auto = template.seats.filter(s => roleById(s.role)?.autonomy === 'auto').map(s => `@${s.role}`); return auto.length ? <Text color={C.yellow} wrap="truncate">⚠ {t.ask.autoWarning(auto.join(', '))}</Text> : null; })()}
      {field(t.catalog.file, <Text color={C.dim}>{template.path}</Text>)}
      {field(t.catalog.teams, (() => {
        const xs = teams.filter(x => x.template === template.id && x.state !== 'dissolved');
        return xs.length ? <Text>{xs.map(x => <Text key={x.id}><Text color={C.violet}>{g.team} {x.name}</Text> <Text color={C.dim}>{x.state === 'active' ? t.catalog.active : t.catalog.resting}</Text>  </Text>)}</Text> : <Text color={C.faint}>{t.catalog.noTeam}</Text>;
      })())}
    </TitledBox>
  ) : <TitledBox title={t.tabs.teams} flexGrow={1}><Text color={C.faint}>{defs === null ? t.catalog.loading : view === 'roles' ? t.catalog.noRole : t.catalog.noTemplateHere}</Text></TitledBox>;

  const keys: Array<readonly [string, string]> = [
    ['j k', t.keys.navigate], ['← →', t.keys.rolesTemplates], ['c', t.keys.folder],
    ...(current ? [['↵', view === 'roles' ? t.keys.launchRole : t.keys.launchTeam] as const, ['o', t.keys.openFile] as const] : []),
    ...(issues.length ? [['!', t.keys.ignored] as const] : []), ['esc', t.keys.back]
  ];
  return (
    <Frame crumb={t.tabs.teams} keys={keys}>
      <Box flexGrow={1} flexDirection={wide ? 'row' : 'column'}>
        <Box flexDirection="column" width={wide ? left : undefined} flexShrink={0} flexGrow={wide ? 0 : 1}>{listBox}</Box>
        <Box flexDirection="column" flexGrow={1}>{detail}</Box>
      </Box>
    </Frame>
  );
}
