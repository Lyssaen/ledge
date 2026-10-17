import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import WebSocket from 'ws';
import { createElement, type ComponentType } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Machines, Projects, RepoInfo, Session, ThreadItem } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { activeCount } from '../src/nav/agents';
import { loadWorkspace } from '../src/session/lazy';
import { loadComposer } from '../src/launch/lazy';
import { loadEditor } from '../src/projects/lazy';

/** jsdom loads no stylesheet: the declarations of the top-level rules naming `selector` in one of the app's sheets (@media and @container blocks removed). */
export function declarations(sheet: string, selector: string): string {
  const css = readFileSync(resolve(__dirname, '../src/styles', sheet), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:media|container)[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(m => m[1]!.split(',').map(x => x.trim().replace(/\s+/g, ' ')).includes(selector)).map(m => m[2]!.replace(/\s+/g, '')).join(';');
}

/** jsdom has no DataTransfer. */
export function transfer(): { setData(k: string, v: string): void; getData(k: string): string; effectAllowed: string; dropEffect: string } {
  const data: Record<string, string> = {};
  return { setData: (k, v) => { data[k] = v; }, getData: k => data[k] ?? '', effectAllowed: '', dropEffect: '' };
}

export const PROJECTS: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'pay', name: 'Payment Service Platform Migration Europe', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] },
    { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/docs' }] }
  ],
  rules: []
};
export const TWO_PROJECTS: Projects = { ...PROJECTS, projects: PROJECTS.projects.slice(0, 2) };

/** The New session form's fixture: PROJECTS with Ledge's two repositories on local (app on desktop, docs on main) and one on NAS,
 *  a rule keeping the /w/ledge sessions at the Ledge table, and Docs only on NAS (no repository on local). */
export const LAUNCH_PROJECTS: Projects = {
  projects: [
    { ...PROJECTS.projects[0]!, repos: [{ machine: 'local', path: '/w/ledge/app' }, { machine: 'local', path: '/w/ledge/docs' }, { machine: 'nas', path: '/srv/ledge' }] },
    PROJECTS.projects[1]!,
    { ...PROJECTS.projects[2]!, repos: [{ machine: 'nas', path: '/srv/docs' }] }
  ],
  rules: [{ machine: 'local', path: '/w/ledge', project: 'ledge' }]
};
export const LAUNCH_REPOS = (): Map<string, RepoInfo> => new Map([
  ['/w/ledge/docs', { path: '/w/ledge/docs', exists: true, branch: 'main' }],
  ['/w/ledge/app', { path: '/w/ledge/app', exists: true, branch: 'desktop' }]
]);
/** Local, and NAS that never connects (the mock's snapshot names no SSH alias): offline. */
export const LOCAL_AND_NAS: Machines = [{ id: 'local', label: 'Local' }, { id: 'nas', label: 'NAS', ssh: 'nas' }];

export const DEFAULT_SESSIONS: Session[] = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' }),
  fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' })
];

/** La Liste du lot 5 : Otto (Ledge, permission, depuis 12 min, branche desktop, un sous-agent Explore « Lire le code »), Bix (Ledge, terminé, il y a 90 min),
 *  Rio (Ledge, hors ligne, il y a 3 jours), Nova (pay, au travail, il y a 3 min), Kit (/tmp, question, à l'instant). Heures relatives à l'appel. */
export function listSessions(): Session[] {
  const now = Date.now();
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' }, lastActivityAt: ago(12), branch: 'desktop', topic: 'Câbler la liste', helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' }] }),
    fakeSession('bix', { name: 'Bix', cwd: '/w/ledge', state: 'exited', lastActivityAt: ago(90), topic: 'Relire la PR' }),
    fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'working', offline: true, lastActivityAt: ago(3 * 24 * 60), topic: 'Migrer la base' }),
    fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working', lastActivityAt: ago(3), topic: 'Payer en euros' }),
    fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' }, lastActivityAt: ago(0), topic: 'Essayer une idée' })
  ];
}

/** Le fil d'Otto (listSessions) : tour 1 (consigne, Read, Grep, Edit, message, permission accordée, Bash en échec, sous-agent h1 et son fil, réponse),
 *  tour 2 (consigne, la permission « npm test » non décidée, Bash en cours). Heures relatives à l'appel, le tour 2 il y a 1 min. */
export function ottoThread(): ThreadItem[] {
  const now = Date.now();
  const at = (s: number) => new Date(now - 60_000 + s * 1000).toISOString();
  const tool = (id: string, s: number, name: string, label: string, extra: Record<string, unknown> = {}): ThreadItem =>
    ({ kind: 'tool', id, at: at(s), turn: 1, tool: name, label, status: 'success', files: [], ...extra }) as ThreadItem;
  return [
    { kind: 'prompt', id: 'prompt-1', at: at(-600), turn: 1, text: 'Câble la liste' },
    tool('t1', -590, 'Read', '/w/ledge/src/App.tsx', { durationMs: 400 }),
    tool('t2', -580, 'Grep', 'useKeys', { durationMs: 300 }),
    tool('t3', -570, 'Edit', '/w/ledge/src/App.tsx', { durationMs: 200, files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }] }),
    { kind: 'message', id: 'msg-1', at: at(-560), turn: 1, text: 'Je lance les tests.' },
    { kind: 'permission', id: 'perm-1', at: at(-550), turn: 1, tool: 'Bash', text: 'npm test', decision: 'accept' },
    tool('t4', -540, 'Bash', 'npm test', { status: 'failed', error: 'exit 1', durationMs: 6800 }),
    { kind: 'helper', id: 'h1', at: at(-530), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'working' },
    { kind: 'message', id: 'msg-h', at: at(-525), turn: 1, helperId: 'h1', text: 'Je lis.' },
    { kind: 'reply', id: 'reply-1', at: at(-520), turn: 1, text: 'Deux tests échouent.' },
    { kind: 'prompt', id: 'prompt-2', at: at(0), turn: 2, text: 'Corrige-les' },
    { kind: 'permission', id: 'perm-2', at: at(1), turn: 2, tool: 'Bash', text: 'npm test' },
    tool('t5', 2, 'Bash', 'npm test', { turn: 2, status: 'running' })
  ];
}

export type MockDaemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: MockDaemon[] = [];

/** Closes the daemons `boot` opened: call it in each file's afterEach. */
export async function closeDaemons(): Promise<void> {
  for (const d of daemons.splice(0)) await d.close();
}

/** Mounts the app on a mock daemon (machines Local and Dev SSH unless `machines` says otherwise; `repoInfo`: what `repos.inspect` answers).
 *  `list` writes `desktop.overview` on the List before rendering.
 *  Ready once the Atelier counter shows the active sessions, the last project's row is in the sidebar and, with sessions,
 *  the first one is shown (its seat in the atelier, its row in the List). */
export async function boot({ sessions = DEFAULT_SESSIONS, projects = PROJECTS, list = false, machines = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }], repoInfo }: { sessions?: Session[]; projects?: Projects; list?: boolean; machines?: Machines; repoInfo?: ReadonlyMap<string, RepoInfo> } = {}): Promise<{ d: MockDaemon; side: ReturnType<typeof within>; view: RenderResult; client: DaemonClient; user: UserEvent }> {
  // The session page's, the New session form's and the project editor's own chunks are there before a test opens them: they come in the same render, as once preloaded in the app.
  await loadWorkspace();
  await loadComposer();
  await loadEditor();
  const d = await createMockDaemon(); daemons.push(d);
  d.machines(machines);
  d.projects(projects);
  for (const [path, info] of repoInfo ?? []) d.repoInfo.set(path, info);
  for (const s of sessions) d.upsert(s);
  if (list) localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  const view = render(createElement(App as ComponentType<{ client?: DaemonClient }>, { client }));
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(sessions))));
  const last = projects.projects[projects.projects.length - 1];
  if (last) await side.findByRole('button', { name: new RegExp(`^${last.name}`) });
  if (sessions.length > 0) await screen.findByRole(list ? 'listitem' : 'button', { name: new RegExp(`^${sessions[0]!.name},`) });
  return { d, side, view, client, user: userEvent.setup() };
}

/** The app on the List (the Atelier with `list: false`) with listSessions, LAUNCH_PROJECTS, Local and NAS (offline), then N: the New session dialog. */
export async function openLaunch(opts: { repoInfo?: Map<string, RepoInfo>; list?: boolean } = {}) {
  const env = await boot({ sessions: listSessions(), list: opts.list ?? true, projects: LAUNCH_PROJECTS, machines: LOCAL_AND_NAS, repoInfo: opts.repoInfo ?? LAUNCH_REPOS() });
  await env.user.keyboard('n');
  return { ...env, form: within(await screen.findByRole('dialog', { name: 'New session' })) };
}
