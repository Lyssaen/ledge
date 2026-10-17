import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, Project, Projects, RepoInfo, Session } from '@ledge/protocol';
import { boot, closeDaemons, recordToasts, savedNotices, type MockDaemon } from './helpers';
import { UNCONFIRMED_MS } from '../src/projects/useProjectSave';

let log: string[] = [];
beforeEach(() => { log = recordToasts(); localStorage.clear(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); cleanup(); await closeDaemons(); });

/** Ledge holds /w/ledge (Otto) and remembers /w/scratch (Bix); Payment Service has /w/pay (Nova) and /srv/pay on NAS, and remembers
 *  /w/billing; Docs has no repository and nobody. Kit has no project. */
const LEDGE: Project = { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] };
const PAYMENT: Project = { id: 'payment', name: 'Payment Service', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }, { machine: 'nas', path: '/srv/pay' }] };
const DOCS: Project = { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [] };
const STATE: Projects = {
  projects: [LEDGE, PAYMENT, DOCS],
  rules: [{ machine: 'local', path: '/w/scratch', project: 'ledge' }, { machine: 'local', path: '/w/billing', project: 'payment' }]
};
const SESSIONS: Session[] = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }),
  fakeSession('bix', { name: 'Bix', cwd: '/w/scratch', state: 'working' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' }),
  fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' })
];
/** /w/ledge is a Git repository on main, /w/pay a plain folder. */
const REPOS = new Map<string, RepoInfo>([['/w/ledge', { path: '/w/ledge', exists: true, branch: 'main' }], ['/w/pay', { path: '/w/pay', exists: true, branch: null }]]);

type ProjectsSet = Extract<ClientMessage, { type: 'projects.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is ProjectsSet => m.type === 'projects.set');
const saved = () => savedNotices(log);
const nav = () => within(screen.getByRole('navigation', { name: 'Settings sections' }));
/** A card, by its title (the section and its first card are both « Projects »). */
const region = (name: string) => within(screen.getByRole('heading', { level: 2, name }).closest('section')!);
const project = (name: string) => within(region('Projects').getByRole('article', { name }));
const rules = () => region('Remembered folders').queryAllByRole('article').map(a => a.getAttribute('aria-label'));
const rule = (name: string) => within(region('Remembered folders').getByRole('article', { name }));
const target = (path: string) => region('Remembered folders').getByRole<HTMLSelectElement>('combobox', { name: `Project for ${path}` });

async function open(state: Projects = STATE, before?: (env: Awaited<ReturnType<typeof boot>>) => Promise<void>) {
  const env = await boot({ sessions: SESSIONS, projects: state, machines: [{ id: 'local', label: 'Local' }, { id: 'nas', label: 'NAS', ssh: 'nas' }], repoInfo: REPOS });
  await before?.(env);
  await env.user.keyboard('{Control>},{/Control}');
  await screen.findByRole('heading', { level: 1, name: 'General' });
  await env.user.click(nav().getByRole('button', { name: /^Projects/ }));
  await screen.findByRole('heading', { level: 2, name: 'Projects' });
  return env;
}

describe('Settings › Projects: the list', () => {
  it('each project shows its repositories (name, machine, Git branch or folder) and how many agents work there', async () => {
    await open();
    expect(region('Projects').getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Ledge', 'Payment Service', 'Docs']);
    const chips = (name: string) => [...screen.getByRole('article', { name }).querySelectorAll('.repo-chips .set-tag')].map(c => [c.textContent, c.getAttribute('title')]);
    // The saved repositories are inspected on the machines online: /w/ledge is on main, /w/pay is a plain folder, NAS is offline.
    await waitFor(() => expect(chips('Ledge')).toEqual([['ledgeLocal', '/w/ledge · Local · ⎇ main']]));
    expect(chips('Payment Service')).toEqual([['payLocal', '/w/pay · Local'], ['payNAS', '/srv/pay · NAS']]);
    expect(project('Ledge').getByText('2 agents')).toBeVisible();
    expect(project('Payment Service').getByText('1 agent')).toBeVisible();
    expect(project('Docs').getByText('0 agents')).toBeVisible();
    expect(project('Docs').getByText('No repository')).toBeVisible();
    expect(project('Ledge').getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Edit Ledge', 'Delete Ledge']);
    expect(saved()).toEqual([]);
  });

  it('« Edit » opens the project editor on that project', async () => {
    const { user } = await open();
    await user.click(project('Ledge').getByRole('button', { name: 'Edit Ledge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit Ledge' }));
    expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Ledge');
    // Still in Settings, behind the dialog.
    expect(screen.getByRole('heading', { level: 1, name: 'Projects', hidden: true })).toBeInTheDocument();
  });

  it('« Delete » opens the editor straight on its deletion view; Escape closes it', async () => {
    const { user } = await open();
    await user.click(project('Ledge').getByRole('button', { name: 'Delete Ledge' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete Ledge' }));
    expect(dialog.getByRole('alert')).toHaveTextContent('Ledge disappears from the sidebar and the atelier.');
    expect(dialog.getByRole('alert')).toHaveTextContent(/2 agents \((Otto, Bix|Bix, Otto)\) will move to « No project »\./);
    expect(dialog.queryByRole('textbox', { name: 'Name' })).toBeNull();
    // Entering the view focuses where its agents go, as when « Delete the project » is clicked in the editor.
    expect(dialog.getByRole('radio', { name: 'No project' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('« New project » opens the editor for a new project', async () => {
    const { user } = await open();
    await user.click(region('Projects').getByRole('button', { name: 'New project' }));
    expect(await screen.findByRole('dialog', { name: 'New project' })).toBeVisible();
  });
});

describe('Settings › Projects: remembered folders', () => {
  it('lists the rules: the path, the machine, the project it points to', async () => {
    await open();
    expect(rules()).toEqual(['/w/scratch on Local', '/w/billing on Local']);
    expect(rule('/w/scratch on Local').getByText('/w/scratch').tagName).toBe('CODE');
    expect(rule('/w/scratch on Local').getByText('Local')).toBeVisible();
    expect(target('/w/scratch')).toHaveValue('ledge');
    expect(within(target('/w/scratch')).getAllByRole('option').map(o => o.textContent)).toEqual(['Ledge', 'Payment Service', 'Docs']);
    expect(target('/w/billing')).toHaveValue('payment');
  });

  it('without a rule: says how one comes', async () => {
    await open({ ...STATE, rules: [] });
    expect(region('Remembered folders').getByText('No remembered folder. Filing an agent adds one.')).toBeVisible();
  });

  it('re-pointing a rule to Payment Service sends the state with that rule changed; the rule changes only once broadcast, then « Setting saved » (Review Focus 3)', async () => {
    const { d, user } = await open();
    d.holdProjects();
    await user.selectOptions(target('/w/scratch'), 'Payment Service');
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    expect(setsOf(d)[0]!.projects).toEqual({ projects: STATE.projects, rules: [{ machine: 'local', path: '/w/scratch', project: 'payment' }, STATE.rules[1]] });
    // Nothing optimistic: the rule stays as it was, and nothing is said yet.
    expect(target('/w/scratch')).toHaveValue('ledge');
    expect(rules()).toEqual(['/w/scratch on Local', '/w/billing on Local']);
    expect(saved()).toEqual([]);
    act(() => d.releaseProjects());
    await waitFor(() => expect(target('/w/scratch')).toHaveValue('payment'));
    expect(rules()).toEqual(['/w/scratch on Local', '/w/billing on Local']);
    expect(saved()).toEqual(['Setting saved · /w/scratch → Payment Service']);
  });

  it('« Forget » sends the state without the rule, which goes once broadcast', async () => {
    const { d, user } = await open();
    d.holdProjects();
    await user.click(rule('/w/scratch on Local').getByRole('button', { name: 'Forget /w/scratch' }));
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    expect(setsOf(d)[0]!.projects).toEqual({ projects: STATE.projects, rules: [STATE.rules[1]] });
    expect(rules()).toEqual(['/w/scratch on Local', '/w/billing on Local']);
    expect(saved()).toEqual([]);
    act(() => d.releaseProjects());
    await waitFor(() => expect(rules()).toEqual(['/w/billing on Local']));
    expect(saved()).toEqual(['Setting saved · /w/scratch forgotten']);
  });

  it('the local daemon offline: the message shows under that rule, and nothing changes (Review Focus 3)', async () => {
    const { user } = await open(STATE, async ({ d, client }) => {
      await d.close();
      await waitFor(() => expect(client.fleet!.machines().find(m => m.id === 'local')?.ready).toBe(false));
    });
    await user.selectOptions(target('/w/scratch'), 'Payment Service');
    expect(rule('/w/scratch on Local').getByRole('alert')).toHaveTextContent('The local daemon is offline: nothing changed.');
    expect(rule('/w/billing on Local').queryByRole('alert')).toBeNull();
    expect(target('/w/scratch')).toHaveValue('ledge');
    await user.click(rule('/w/billing on Local').getByRole('button', { name: 'Forget /w/billing' }));
    // The refusal follows the rule last tried.
    expect(rule('/w/billing on Local').getByRole('alert')).toHaveTextContent('The local daemon is offline: nothing changed.');
    expect(rule('/w/scratch on Local').queryByRole('alert')).toBeNull();
    expect(rules()).toEqual(['/w/scratch on Local', '/w/billing on Local']);
    expect(saved()).toEqual([]);
  });

  it('a daemon that does not confirm: « did not confirm » under the rule, which stays; a late broadcast still ends it (Review Focus 3)', async () => {
    const { d } = await open();
    d.holdProjects();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(target('/w/scratch'), { target: { value: 'docs' } });
    act(() => { vi.advanceTimersByTime(UNCONFIRMED_MS); });
    vi.useRealTimers();
    expect(rule('/w/scratch on Local').getByRole('alert')).toHaveTextContent('The daemon did not confirm this change.');
    expect(target('/w/scratch')).toHaveValue('ledge');
    expect(saved()).toEqual([]);
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    act(() => d.releaseProjects());
    await waitFor(() => expect(target('/w/scratch')).toHaveValue('docs'));
    expect(rule('/w/scratch on Local').queryByRole('alert')).toBeNull();
    expect(saved()).toEqual(['Setting saved · /w/scratch → Docs']);
  });
});
