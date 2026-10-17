import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ClientMessage, Project, Projects, Session } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, LOCAL_AND_NAS, type MockDaemon } from './helpers';
import { LangProvider } from '../src/i18n/lang';
import { MESSAGES } from '../src/i18n/messages';
import { ProjectDialog } from '../src/projects/ProjectDialog';
import { initialNav, navReducer } from '../src/nav/state';

afterEach(async () => {
  vi.restoreAllMocks();
  await closeDaemons();
  localStorage.clear();
});

type ProjectsSet = Extract<ClientMessage, { type: 'projects.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is ProjectsSet => m.type === 'projects.set');
const named = (name: string) => Object.assign(new Error(name), { name });
const tick = () => new Promise(r => setTimeout(r, 50));

/** Ledge holds /w/ledge (Otto) and remembers /w/scratch (Bix): two agents at its table, one rule. Payment Service has Nova, Docs nobody; Kit has no project. */
const LEDGE: Project = { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] };
const PAYMENT: Project = { id: 'payment', name: 'Payment Service', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] };
const DOCS: Project = { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/docs' }] };
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

/** The app on the Atelier, then the Ledge table's « Edit project », then « Delete the project ». */
async function deleteLedge(opts: Parameters<typeof boot>[0] = {}) {
  const env = await boot({ sessions: SESSIONS, projects: STATE, ...opts });
  await env.user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
  await env.user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  await env.user.click(within(screen.getByRole('dialog', { name: 'Edit Ledge' })).getByRole('button', { name: 'Delete the project' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Delete Ledge' }));
  return { ...env, dialog };
}
const items = () => [...document.querySelectorAll('.pe-delete li')].map(li => li.textContent);

describe('deleting a project', () => {
  it('to « No project »: says its 2 agents and the forgotten rule; sends the state without it; once broadcast, its agents have no project', async () => {
    const { d, side, user, dialog } = await deleteLedge();
    const alert = dialog.getByRole('alert');
    expect(alert).toHaveClass('pe-delete');
    expect(alert.tagName).toBe('DIV');
    expect(alert.querySelector('p')).toHaveTextContent('Ledge disappears from the sidebar and the atelier. Its repositories stay untouched on your machines.');
    expect(alert.querySelector('p strong')).toHaveTextContent(/^Ledge$/);
    expect(items()).toEqual(['2 agents (Bix, Otto) will move to « No project ».', '1 remembered folder will be forgotten.']);
    const move = within(dialog.getByRole('group', { name: 'Its agents' }));
    expect(move.getByRole('radio', { name: 'No project' })).toBeChecked();
    expect(move.getByRole('radio', { name: 'Move to…' })).not.toBeChecked();
    expect(move.getByRole('radio', { name: 'Move to…' })).toBeEnabled();
    expect(dialog.queryByRole('combobox', { name: 'Target project' })).toBeNull();
    // The edit view is gone: no name field, no « Save ».
    expect(dialog.queryByRole('textbox', { name: 'Name' })).toBeNull();
    expect(dialog.queryByRole('button', { name: /^Save/ })).toBeNull();

    // « Cancel » goes back to editing, and « Delete the project » comes back to this view.
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    const edit = within(screen.getByRole('dialog', { name: 'Edit Ledge' }));
    expect(edit.getByRole('textbox', { name: 'Name' })).toHaveValue('Ledge');
    await user.click(edit.getByRole('button', { name: 'Delete the project' }));
    expect(screen.getByRole('dialog', { name: 'Delete Ledge' })).toBeVisible();

    d.holdProjects();
    await user.click(dialog.getByRole('button', { name: 'Delete Ledge' }));
    expect(dialog.getByRole('button', { name: 'Saving…' })).toBeVisible();
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    expect(setsOf(d)[0]!.projects).toEqual({ projects: [PAYMENT, DOCS], rules: [{ machine: 'local', path: '/w/billing', project: 'payment' }] });
    // Nothing optimistic: until the broadcast, Ledge is still there and the dialog still open.
    await tick();
    expect(side.getByRole('button', { name: /^Ledge/ })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Delete Ledge' })).toBeVisible();
    expect(items()).toEqual(['2 agents (Bix, Otto) will move to « No project ».', '1 remembered folder will be forgotten.']);

    d.releaseProjects();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Ledge deleted. 2 agents move to « No project ».');
    expect(side.queryByRole('button', { name: /^Ledge/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ledge table' })).toBeNull();
    const none = within(screen.getByRole('region', { name: 'No project' }));
    for (const n of ['Otto', 'Bix', 'Kit']) expect(none.getByRole('button', { name: new RegExp(`^${n},`) })).toBeVisible();
  });

  it('« Move to… » Payment Service: its repositories and its rule go there, and so do its agents', async () => {
    const { d, user, dialog } = await deleteLedge();
    await user.click(dialog.getByRole('radio', { name: 'Move to…' }));
    const target = dialog.getByRole('combobox', { name: 'Target project' });
    expect(within(target).getAllByRole('option').map(o => o.textContent)).toEqual(['Payment Service', 'Docs']);
    expect(target).toHaveValue('payment');
    expect(items()).toEqual(['2 agents (Bix, Otto) will join Payment Service.', '1 remembered folder will point to that project.']);
    expect(document.querySelector('.pe-delete li strong')).toHaveTextContent(/^Payment Service$/);
    expect(dialog.queryByRole('button', { name: 'Delete Ledge' })).toBeNull();

    // Another target, then back to Payment Service.
    await user.selectOptions(target, 'Docs');
    expect(items()[0]).toBe('2 agents (Bix, Otto) will join Docs.');
    await user.selectOptions(target, 'Payment Service');

    await user.click(dialog.getByRole('button', { name: 'Move and delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setsOf(d)).toHaveLength(1);
    expect(setsOf(d)[0]!.projects).toEqual({
      projects: [{ ...PAYMENT, repos: [...PAYMENT.repos, ...LEDGE.repos] }, DOCS],
      rules: [{ machine: 'local', path: '/w/scratch', project: 'payment' }, { machine: 'local', path: '/w/billing', project: 'payment' }]
    });
    expect(screen.getByRole('status')).toHaveTextContent('Ledge deleted. 2 agents join Payment Service.');
    const table = within(screen.getByRole('region', { name: 'Payment Service table' }));
    for (const n of ['Otto', 'Bix', 'Nova']) expect(table.getByRole('button', { name: new RegExp(`^${n},`) })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'No project' })).queryByRole('button', { name: /^Otto,/ })).toBeNull();
  });

  it('a refusal (the local daemon offline) is said in the dialog, which stays on the deletion', async () => {
    const env = await boot({ sessions: SESSIONS, projects: STATE });
    vi.spyOn(env.client.fleet!, 'setProjects').mockImplementation(() => { throw named('DaemonOffline'); });
    await env.user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
    await env.user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    await env.user.click(screen.getByRole('button', { name: 'Delete the project' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete Ledge' }));
    await env.user.click(dialog.getByRole('button', { name: 'Delete Ledge' }));
    expect(dialog.getAllByRole('alert').map(a => a.textContent)).toContain('The local daemon is offline: nothing was saved.');
    expect(dialog.getByRole('button', { name: 'Delete Ledge' })).toBeVisible();
    expect(env.side.getByRole('button', { name: /^Ledge/ })).toBeVisible();
  });

  it('the project the overview is filtered on: the filter goes back to All, the view stays', async () => {
    const env = await boot({ sessions: SESSIONS, projects: STATE });
    const top = within(screen.getByRole('banner'));
    await env.user.click(env.side.getByRole('button', { name: /^Ledge/ }));
    expect(top.getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
    await env.user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
    await env.user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    await env.user.click(screen.getByRole('button', { name: 'Delete the project' }));
    await env.user.click(within(screen.getByRole('dialog', { name: 'Delete Ledge' })).getByRole('button', { name: 'Delete Ledge' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(top.queryByRole('button', { name: 'Remove the filter: show every project' })).toBeNull();
    expect(top.getByRole('tab', { name: 'Atelier' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Payment Service table' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'No project' })).getByRole('button', { name: /^Otto,/ })).toBeVisible();
  });

  it('the project of the session page open, filtered on it: the page stays open, the agent has no project, the filter is All', async () => {
    // Ledge has no repository on Local (only on NAS): Otto sits at its table through the rule, and the New session form offers « Edit the project ».
    const projects: Projects = { projects: [{ ...LEDGE, repos: [{ machine: 'nas', path: '/srv/ledge' }] }, PAYMENT], rules: [{ machine: 'local', path: '/w/ledge', project: 'ledge' }] };
    const env = await boot({ sessions: SESSIONS, projects, machines: LOCAL_AND_NAS });
    await env.user.click(env.side.getByRole('button', { name: /^Ledge/ }));
    await env.user.click(screen.getByRole('button', { name: /^Otto,/ }));
    await waitFor(() => expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:otto'));
    await env.user.click(screen.getByRole('button', { name: /New session here/ }));
    const form = within(await screen.findByRole('dialog', { name: 'New session' }));
    await env.user.click(form.getByRole('button', { name: 'Edit the project' }));
    await env.user.click(within(screen.getByRole('dialog', { name: 'Edit Ledge' })).getByRole('button', { name: 'Delete the project' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete Ledge' }));
    expect(items()).toEqual(['1 agent (Otto) will move to « No project ».', '1 remembered folder will be forgotten.']);
    await env.user.click(dialog.getByRole('button', { name: 'Delete Ledge' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Ledge deleted. 1 agent moves to « No project ».');
    // The page stays on Otto, now without project; Escape goes back to the overview, on All.
    expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:otto');
    await env.user.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('.session-page')).toBeNull());
    const top = within(screen.getByRole('banner'));
    expect(top.queryByRole('button', { name: 'Remove the filter: show every project' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'No project' })).getByRole('button', { name: /^Otto,/ })).toBeVisible();
  });

  it('the only project: « Move to… » is disabled; more than four agents are named four, then « … »; no rule', async () => {
    const sessions = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'].map(n => fakeSession(n.toLowerCase(), { name: n, cwd: '/w/ledge', state: 'working' }));
    const { dialog } = await deleteLedge({ sessions, projects: { projects: [LEDGE], rules: [] } });
    expect(dialog.getByRole('radio', { name: 'Move to…' })).toBeDisabled();
    expect(dialog.getByRole('radio', { name: 'Move to…' }).closest('label')).toHaveClass('disabled');
    expect(dialog.getByRole('radio', { name: 'No project' })).toBeChecked();
    expect(items()).toEqual(['5 agents (Ana, Bo, Cy, Di…) will move to « No project ».', '0 remembered folders will be forgotten.']);
  });

  it('no agent at the table says so (the dialog alone: a table without agent has no menu)', async () => {
    const nova = SESSIONS.filter(s => s.name === 'Nova');
    render(<LangProvider lang="en"><ProjectDialog edit="ledge" projects={{ ...STATE, rules: [] }} sessions={nova} machines={[]} client={{} as DaemonClient} fleet={{ setProjects: vi.fn() }}
      projectIdOf={s => (s.cwd === '/w/pay' ? 'payment' : null)} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} /></LangProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete the project' }));
    expect(within(screen.getByRole('dialog', { name: 'Delete Ledge' })).getByRole('alert')).toBeVisible();
    expect(items()).toEqual(['No agent at this table.', '0 remembered folders will be forgotten.']);
  });
});

describe('the deletion copy', () => {
  it('fr agrees in number with the agents and the folders; en with the agents', () => {
    const fr = MESSAGES.fr.projects.delete;
    const en = MESSAGES.en.projects.delete;
    expect(fr.lead('Ledge')).toBe('Ledge disparaît de la barre latérale et de l’atelier. Ses dépôts restent intacts sur vos machines.');
    expect(`${fr.agents(1, 'Otto')} ${fr.toNone(1)}`).toBe('1 agent (Otto) passera dans « Sans projet ».');
    expect(`${fr.agents(2, 'Otto, Bix')} ${fr.toNone(2)}`).toBe('2 agents (Otto, Bix) passeront dans « Sans projet ».');
    expect(fr.toProject(1, 'Docs')).toBe('rejoindra Docs.');
    expect(fr.toProject(2, 'Docs')).toBe('rejoindront Docs.');
    expect(`${fr.rules(1)} ${fr.rulesForget(1)}`).toBe('1 dossier mémorisé sera oublié.');
    expect(`${fr.rules(3)} ${fr.rulesForget(3)}`).toBe('3 dossiers mémorisés seront oubliés.');
    expect(`${fr.rules(1)} ${fr.rulesMove(1)}`).toBe('1 dossier mémorisé pointera vers ce projet.');
    expect(`${fr.rules(2)} ${fr.rulesMove(2)}`).toBe('2 dossiers mémorisés pointeront vers ce projet.');
    expect(fr.noAgents).toBe('Aucun agent à cette table.');
    expect([fr.their, fr.none, fr.moveTo, fr.target, fr.confirm('Ledge'), fr.moveAndDelete]).toEqual(['Ses agents', 'Sans projet', 'Déplacer vers…', 'Projet de destination', 'Supprimer Ledge', 'Déplacer et supprimer']);
    expect(fr.done('Ledge') + fr.doneMoved(1, 'Docs')).toBe('Ledge supprimé. 1 agent rejoint Docs.');
    expect(fr.done('Ledge') + fr.doneMoved(2, 'Docs')).toBe('Ledge supprimé. 2 agents rejoignent Docs.');
    expect(fr.done('Ledge') + fr.doneNone(1)).toBe('Ledge supprimé. 1 agent passe dans « Sans projet ».');
    expect(fr.done('Ledge') + fr.doneNone(2)).toBe('Ledge supprimé. 2 agents passent dans « Sans projet ».');
    expect(en.done('Ledge') + en.doneMoved(1, 'Docs')).toBe('Ledge deleted. 1 agent joins Docs.');
    expect(en.done('Ledge') + en.doneMoved(2, 'Docs')).toBe('Ledge deleted. 2 agents join Docs.');
    expect([en.their, en.none, en.moveTo, en.target, en.confirm('Ledge'), en.moveAndDelete]).toEqual(['Its agents', 'No project', 'Move to…', 'Target project', 'Delete Ledge', 'Move and delete']);
  });
});

describe('the filter nav action', () => {
  it('sets the overview filter and keeps the view', () => {
    const s = navReducer(navReducer(initialNav({ view: 'atelier', helpers: true, paused: false }), { type: 'view', view: 'list' }), { type: 'home', project: 'ledge', view: 'list' });
    expect(navReducer(s, { type: 'filter', project: 'all' }).place).toEqual({ kind: 'overview', view: 'list', project: 'all' });
  });
  it('on a session page, sets its filter without leaving it', () => {
    const s = navReducer(navReducer(initialNav({ view: 'atelier', helpers: true, paused: false }), { type: 'home', project: 'ledge' }), { type: 'open', id: 'local:otto', helper: 'h1' });
    const r = navReducer(s, { type: 'filter', project: 'all' });
    expect(r.place).toEqual({ kind: 'session', id: 'local:otto', helper: 'h1', view: 'atelier', project: 'all' });
    expect(navReducer(r, { type: 'escape' }).place).toEqual({ kind: 'overview', view: 'atelier', project: 'all' });
  });
  it('in Settings, sets the filter of the place behind; the same filter returns the same state', () => {
    const s = navReducer(navReducer(initialNav({ view: 'atelier', helpers: true, paused: false }), { type: 'home', project: 'ledge' }), { type: 'settings' });
    expect(navReducer(s, { type: 'filter', project: 'all' }).place).toEqual({ kind: 'settings', section: 'general', back: { kind: 'overview', view: 'atelier', project: 'all' } });
    expect(navReducer(s, { type: 'filter', project: 'ledge' })).toBe(s);
  });
});
