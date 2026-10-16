import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import WebSocket from 'ws';
import { createElement, type ComponentType } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { activeCount } from '../src/nav/agents';

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

export type MockDaemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: MockDaemon[] = [];

/** Closes the daemons `boot` opened: call it in each file's afterEach. */
export async function closeDaemons(): Promise<void> {
  for (const d of daemons.splice(0)) await d.close();
}

/** Mounts the app on a mock daemon (machines Local and Dev SSH). `list` writes `desktop.overview` on the List before rendering.
 *  Ready once the Atelier counter shows the active sessions, the last project's row is in the sidebar and, with sessions,
 *  the first one is shown (its seat in the atelier, its row in the List). */
export async function boot({ sessions = DEFAULT_SESSIONS, projects = PROJECTS, list = false }: { sessions?: Session[]; projects?: Projects; list?: boolean } = {}): Promise<{ d: MockDaemon; side: ReturnType<typeof within>; view: RenderResult; client: DaemonClient; user: UserEvent }> {
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }]);
  d.projects(projects);
  for (const s of sessions) d.upsert(s);
  if (list) localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false }));
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  const view = render(createElement(App as ComponentType<{ client?: DaemonClient }>, { client }));
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(activeCount(sessions))));
  const last = projects.projects[projects.projects.length - 1]!;
  await side.findByRole('button', { name: new RegExp(`^${last.name}`) });
  if (sessions.length > 0) await screen.findByRole(list ? 'listitem' : 'button', { name: new RegExp(`^${sessions[0]!.name},`) });
  return { d, side, view, client, user: userEvent.setup() };
}
