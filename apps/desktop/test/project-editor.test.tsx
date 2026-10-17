import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import type { ClientMessage, Projects, RepoInfo } from '@ledge/protocol';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';
import { ProjectSwatch } from '../src/projects/ProjectSwatch';
import { useProjectSave } from '../src/projects/useProjectSave';

afterEach(async () => {
  vi.useRealTimers();
  await closeDaemons();
  localStorage.clear();
});

type ProjectsSet = Extract<ClientMessage, { type: 'projects.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is ProjectsSet => m.type === 'projects.set');
const ctrlEnter = (user: UserEvent) => user.keyboard('{Control>}{Enter}{/Control}');
const named = (name: string) => Object.assign(new Error(name), { name });
const tick = () => new Promise(r => setTimeout(r, 50));

/** The app on the mock daemon, Local's home /home/me holding the Git repository paper (main) and the folder notes; then the projects « + ». */
async function openNew(opts: Parameters<typeof boot>[0] = {}) {
  const env = await boot(opts);
  env.d.options.home = '/home/me';
  env.d.folders.set('/home/me', { entries: ['paper', 'notes'], repos: [{ name: 'paper', branch: 'main' }] });
  await env.user.click(env.side.getByRole('button', { name: 'New project' }));
  const dialog = within(screen.getByRole('dialog', { name: 'New project' }));
  return { ...env, dialog, name: dialog.getByRole('textbox', { name: 'Name' }) };
}

describe('the project editor: a new project from the sidebar', () => {
  it('« + »: the name has the focus and the folder browser is open; Ctrl ↵ without a name names the problem; Create sends the project and waits', async () => {
    const { d, user, dialog, name } = await openNew();
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('maxLength', '60');
    expect(name).toHaveAttribute('placeholder', 'E.g. Paper Rendering');
    expect(dialog.getByRole('textbox', { name: /^Description/ })).toHaveAttribute('maxLength', '120');
    const list = within(await dialog.findByRole('list', { name: 'Contents of /home/me on Local' }));
    expect(dialog.getByText('Working repositories · 0')).toBeVisible();
    // The browser is open: no « No repository yet », no « Add a repository ».
    expect(document.querySelector('p.pe-empty')).toBeNull();
    expect(dialog.queryByRole('button', { name: 'Add a repository' })).toBeNull();
    // The first colour no project uses (PROJECTS: blue, green, amber).
    expect(dialog.getAllByRole('radio').filter(r => r.getAttribute('name') === 'pe-color').map(r => r.getAttribute('aria-label')))
      .toEqual(['Blue', 'Green', 'Amber', 'Violet', 'Teal', 'Pink', 'Red', 'Slate']);
    expect(dialog.getByRole('radio', { name: 'Violet' })).toBeChecked();

    await ctrlEnter(user);
    expect(dialog.getByRole('alert')).toHaveTextContent('Give the project a name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(document.querySelector('.pe .composer-missing')).toHaveTextContent('Give the project a name');
    await tick();
    expect(setsOf(d)).toEqual([]);

    d.holdProjects();
    await user.type(name, 'Paper Rendering');
    expect(dialog.queryByRole('alert')).toBeNull();
    await user.click(list.getByRole('button', { name: 'Add paper (Local)' }));
    const row = dialog.getByRole('button', { name: 'Remove paper (Local)' }).closest('li')!;
    expect(within(row).getByText('⎇ main')).toHaveAttribute('title', 'Default branch detected');
    expect(row.querySelector('code')).toHaveTextContent('/home/me/paper');
    expect(row.querySelector('.pe-machine')).toHaveTextContent('Local');
    expect(dialog.getByText('Working repositories · 1')).toBeVisible();
    expect(document.querySelector('.pe .composer-preview')!.textContent).toBe('Paper Rendering1 repository on Local · the table appears with the first session');

    await user.click(dialog.getByRole('button', { name: /^Create the project/ }));
    expect(dialog.getByRole('button', { name: /^Saving…/ })).toBeVisible();
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    const sent = setsOf(d)[0]!.projects;
    expect(sent.projects.slice(0, 3)).toEqual(PROJECTS.projects);
    expect(sent.projects[3]).toEqual({ id: 'paper-rendering', name: 'Paper Rendering', color: 'violet', description: '', repos: [{ machine: 'local', path: '/home/me/paper' }] });
    // One send at a time: a second Ctrl ↵ while saving sends nothing.
    await ctrlEnter(user);
    await tick();
    expect(setsOf(d)).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
  });

  it('the broadcast that holds it closes the editor, says so, and the project appears in the sidebar', async () => {
    const { side, user, dialog, name } = await openNew();
    await user.type(name, 'Paper Rendering');
    await user.click(dialog.getByRole('button', { name: /^Create the project/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Project Paper Rendering created. It appears in the sidebar; its table opens with the first session.');
    expect(side.getByRole('button', { name: /^Paper Rendering/ })).toBeVisible();
  });

  it('a daemon that never confirms: 8 s later the editor says so, and the values stay', async () => {
    const { d, side, dialog, name } = await openNew();
    fireEvent.change(name, { target: { value: 'Paper Rendering' } });
    d.holdProjects();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(dialog.getByRole('button', { name: /^Create the project/ }));
    expect(dialog.getByRole('button', { name: /^Saving…/ })).toBeVisible();
    act(() => { vi.advanceTimersByTime(7999); });
    expect(dialog.queryByRole('alert')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    const alert = dialog.getByRole('alert');
    expect(alert).toHaveTextContent('The daemon did not confirm the save.');
    expect(alert.tagName).toBe('P');
    expect(alert).toHaveClass('composer-missing');
    expect(name).toHaveValue('Paper Rendering');
    expect(dialog.getByRole('radio', { name: 'Violet' })).toBeChecked();
    expect(dialog.getByRole('button', { name: /^Create the project/ })).toBeVisible();
    vi.useRealTimers();
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
    expect(side.queryByRole('button', { name: /^Paper Rendering/ })).toBeNull();
  });

  it('the local daemon offline: the editor says nothing was saved, and nothing is sent', async () => {
    const { d, side, user } = await boot();
    await d.close();
    await waitFor(() => expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('offline'));
    await user.click(side.getByRole('button', { name: 'New project' }));
    const dialog = within(screen.getByRole('dialog', { name: 'New project' }));
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Paper Rendering');
    await user.click(dialog.getByRole('button', { name: /^Create the project/ }));
    expect(dialog.getByRole('alert')).toHaveTextContent('The local daemon is offline: nothing was saved.');
    expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Paper Rendering');
    expect(setsOf(d)).toEqual([]);
  });
});

describe('the project editor: editing a project', () => {
  /** Ledge's repositories: its own folder (main by default), a plain folder, one gone, one on Dev SSH (offline). Docs has /w/docs (no Git).
   *  (The protocol refuses a repository in two projects, so a shared one never comes from the daemon: only a draft can hold one.) */
  const EDITED: Projects = {
    projects: [
      { id: 'ledge', name: 'Ledge', color: 'blue', description: 'Agents at work', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/w/notes' }, { machine: 'local', path: '/w/gone' }, { machine: 'dev', path: '/srv/ledge' }] },
      { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/docs' }] }
    ],
    rules: []
  };
  const INFOS = new Map<string, RepoInfo>([
    ['/w/notes', { path: '/w/notes', exists: true, branch: null }],
    ['/w/docs', { path: '/w/docs', exists: true, branch: null }],
    ['/w/gone', { path: '/w/gone', exists: false, branch: null }]
  ]);
  async function editLedge(projects: Projects = EDITED) {
    const env = await boot({ projects, repoInfo: INFOS });
    await env.user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
    await env.user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit Ledge' }));
    return { ...env, dialog };
  }
  const rowOf = (dialog: ReturnType<typeof within>, name: string, machine: string) => dialog.getByRole('button', { name: `Remove ${name} (${machine})` }).closest('li')!;

  it('« Edit project » from a table: its repositories with their branch, « not found », « offline »; a rename keeps the id', async () => {
    const { d, side, user, dialog } = await editLedge();
    const name = dialog.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Ledge');
    expect(name).toHaveFocus();
    expect(dialog.getByRole('textbox', { name: /^Description/ })).toHaveValue('Agents at work');
    expect(dialog.getByRole('radio', { name: 'Blue' })).toBeChecked();
    expect(dialog.getByText('Working repositories · 4')).toBeVisible();
    // The browser stays closed for a project that has repositories.
    expect(dialog.queryByRole('radiogroup', { name: 'Machine to browse' })).toBeNull();
    expect(dialog.getByRole('button', { name: 'Add a repository' })).toBeVisible();
    // The saved repositories' branches come from repos.inspect on their machine (Local only: Dev SSH is offline).
    expect(await within(rowOf(dialog, 'ledge', 'Local')).findByText('⎇ main')).toHaveAttribute('title', 'Default branch detected');
    expect(d.received.filter(m => m.type === 'repos.inspect')).toEqual([expect.objectContaining({ paths: ['/w/ledge', '/w/notes', '/w/gone'] })]);   // (the fleet routes it to Local, machineId dropped)
    expect(within(rowOf(dialog, 'notes', 'Local')).getByText('Folder without Git')).toBeVisible();
    expect(within(rowOf(dialog, 'gone', 'Local')).getByText('not found')).toHaveClass('set-warn');
    const remote = rowOf(dialog, 'ledge', 'Dev SSH');
    expect(within(remote).getByText('offline')).toBeVisible();
    expect(remote.querySelector('.machine-dot.off')).not.toBeNull();
    expect(remote).not.toHaveTextContent('⎇');
    expect(dialog.queryByText(/^Also in/)).toBeNull();
    expect(document.querySelector('.pe .composer-preview')!.textContent).toBe('Ledge4 repositories on Local, Dev SSH');
    // Mode edit: « Save », no « Create ».
    expect(dialog.queryByRole('button', { name: /^Create the project/ })).toBeNull();

    await user.clear(name);
    await user.type(name, 'Ledge Desktop');
    await user.click(dialog.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setsOf(d)).toHaveLength(1);
    expect(setsOf(d)[0]!.projects.projects[0]).toEqual({ ...EDITED.projects[0]!, name: 'Ledge Desktop' });
    expect(setsOf(d)[0]!.projects.projects[1]).toEqual(EDITED.projects[1]);
    expect(screen.getByRole('status')).toHaveTextContent('Ledge Desktop saved.');
    expect(side.getByRole('button', { name: /^Ledge Desktop/ })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Ledge Desktop table' })).toBeVisible();
  });

  it('« Remove » takes a repository out of the draft; saving sends the list without it', async () => {
    const { d, user, dialog } = await editLedge();
    await user.click(dialog.getByRole('button', { name: 'Remove gone (Local)' }));
    expect(dialog.getByText('Working repositories · 3')).toBeVisible();
    await user.click(dialog.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setsOf(d)[0]!.projects.projects[0]!.repos).toEqual([{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/w/notes' }, { machine: 'dev', path: '/srv/ledge' }]);
  });

  it('a repository another project has: its row says so as an error, Save names the problem, nothing is sent, the values stay', async () => {
    const { d, user, dialog } = await editLedge();
    await user.click(dialog.getByRole('button', { name: 'Add a repository' }));
    await user.type(dialog.getByRole('textbox', { name: 'Path on Local' }), '/w/docs{Enter}');
    const docs = (await dialog.findByRole('button', { name: 'Remove docs (Local)' })).closest('li')!;
    expect(within(docs).getByText('This repository is already in Docs')).toHaveClass('set-error');
    expect(within(docs).getByText('Folder without Git')).toBeVisible();
    expect(dialog.getByText('Working repositories · 5')).toBeVisible();
    await user.click(dialog.getByRole('button', { name: /^Save/ }));
    const alert = dialog.getByRole('alert');
    expect(alert).toHaveTextContent('This repository is already in Docs');
    expect(alert).toHaveClass('composer-missing');
    expect(dialog.getByRole('button', { name: 'Remove docs (Local)' })).toBeVisible();
    await tick();
    expect(setsOf(d)).toEqual([]);
    // Removing it lifts the problem: Save goes through.
    await user.click(dialog.getByRole('button', { name: 'Remove docs (Local)' }));
    await user.click(dialog.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setsOf(d)).toHaveLength(1);
  });

  it('a new project from the browser: a folder Docs has shows the problem; Create sends nothing', async () => {
    const { d, user, dialog, name } = await openNew({ projects: { ...PROJECTS, projects: PROJECTS.projects.map(p => (p.id === 'docs' ? { ...p, repos: [{ machine: 'local', path: '/home/me/paper' }] } : p)) } });
    await user.type(name, 'Paper Rendering');
    await user.click(await dialog.findByRole('button', { name: 'Add paper (Local)' }));
    expect(within(dialog.getByRole('button', { name: 'Remove paper (Local)' }).closest('li')!).getByText('This repository is already in Docs')).toHaveClass('set-error');
    await user.click(dialog.getByRole('button', { name: /^Create the project/ }));
    expect(dialog.getByRole('alert')).toHaveTextContent('This repository is already in Docs');
    await tick();
    expect(setsOf(d)).toEqual([]);
  });

  it('a project deleted elsewhere meanwhile: « Save » says so, and nothing is sent', async () => {
    const { d, side, user, dialog } = await editLedge(PROJECTS);
    d.projects({ ...PROJECTS, projects: PROJECTS.projects.filter(p => p.id !== 'ledge') });
    await waitFor(() => expect(side.queryByRole('button', { name: /^Ledge/ })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Edit Ledge' })).toBeVisible();
    await user.click(dialog.getByRole('button', { name: /^Save/ }));
    expect(dialog.getByRole('alert')).toHaveTextContent('This project was deleted meanwhile');
    await tick();
    expect(setsOf(d)).toEqual([]);
    expect(screen.getByRole('dialog', { name: 'Edit Ledge' })).toBeVisible();
  });

  it('a name another project uses is refused before anything is sent', async () => {
    const { d, user, dialog } = await editLedge(PROJECTS);
    const name = dialog.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'docs');
    await ctrlEnter(user);
    expect(dialog.getByRole('alert')).toHaveTextContent('This name is already used by another project');
    await tick();
    expect(setsOf(d)).toEqual([]);
  });
});

describe('the project editor: « Move to › New project… »', () => {
  it('the agent\'s folder and « Also file » are prefilled; once saved, the agent sits at the new table and the notice says so', async () => {
    const { d, user } = await boot();
    const zone = within(screen.getByRole('region', { name: 'No project' }));
    await user.click(zone.getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('menuitem', { name: /New project…/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'New project' }));
    const row = dialog.getByRole('button', { name: 'Remove tmp (Local)' }).closest('li')!;
    expect(row.querySelector('code')).toHaveTextContent('/tmp');
    expect(dialog.getByText('Working repositories · 1')).toBeVisible();
    expect(dialog.queryByRole('radiogroup', { name: 'Machine to browse' })).toBeNull();
    expect(dialog.getByText('Also file')).toBeVisible();
    const kit = dialog.getByRole('checkbox', { name: 'Kit' });
    expect(kit).toBeChecked();
    expect(kit.closest('label')!.querySelector('[role=img]')).not.toBeNull();
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Scratch');
    await user.click(dialog.getByRole('button', { name: /^Create the project/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const sent = setsOf(d)[0]!.projects;
    expect(sent.projects.at(-1)).toEqual({ id: 'scratch', name: 'Scratch', color: 'violet', description: '', repos: [{ machine: 'local', path: '/tmp' }] });
    expect(sent.rules).toEqual([{ machine: 'local', path: '/tmp', project: 'scratch' }]);
    expect(screen.getByRole('status')).toHaveTextContent('Project Scratch created. Kit join its table.');
    expect(within(screen.getByRole('region', { name: 'Scratch table' })).getByRole('button', { name: /^Kit,/ })).toBeVisible();
  });

  it('an agent unchecked from « Also file » is not filed', async () => {
    const { d, user } = await boot();
    await user.click(within(screen.getByRole('region', { name: 'No project' })).getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('menuitem', { name: /New project…/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'New project' }));
    await user.click(dialog.getByRole('checkbox', { name: 'Kit' }));
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Scratch');
    await user.click(dialog.getByRole('button', { name: /^Create the project/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(setsOf(d)[0]!.projects.rules).toEqual([]);
  });
});

describe('ProjectSwatch', () => {
  it('a project\'s swatch has its colour; « No project » has the dashed one (filter-none)', async () => {
    render(<ProjectSwatch project={{ color: 'green' }} />);
    const swatch = document.querySelector('i.side-swatch') as HTMLElement;
    expect(swatch.style.background).toBe('rgb(16, 185, 129)');
    render(<ProjectSwatch project={null} />);
    expect(document.querySelector('i.filter-none')).not.toBeNull();
  });

  it('in the app: the sidebar\'s project swatch, and the top bar\'s « No project » filter', async () => {
    const { side, user } = await boot();
    const swatch = side.getByRole('button', { name: /^Ledge/ }).querySelector('.side-swatch') as HTMLElement;
    expect(swatch.style.background).toBe('rgb(59, 130, 246)');
    await user.click(side.getByRole('button', { name: /No project/ }));
    expect(within(screen.getByRole('banner')).getByText('No project').closest('.project-filter')!.querySelector('i.filter-none')).not.toBeNull();
  });
});

describe('useProjectSave', () => {
  const state: Projects = { projects: [], rules: [] };
  const next: Projects = { projects: [{ id: 'a', name: 'A', color: 'blue', description: '', repos: [] }], rules: [] };
  const holds = (p: Projects) => p.projects.some(x => x.id === 'a');

  it('names each refusal; one send at a time; a broadcast after reset is ignored', () => {
    const fleet = { setProjects: vi.fn() };
    const onDone = vi.fn();
    const { result, rerender } = renderHook((p: Projects) => useProjectSave(fleet, p), { initialProps: state });
    for (const [error, reason] of [['DaemonOffline', 'offline'], ['DaemonOutdated', 'outdated'], ['ZodError', 'invalid']] as const) {
      fleet.setProjects.mockImplementationOnce(() => { throw named(error); });
      act(() => result.current.send(next, holds, onDone));
      expect(result.current.state).toEqual({ status: 'refused', reason });
    }
    fleet.setProjects.mockClear();
    act(() => result.current.send(next, holds, onDone));
    act(() => result.current.send(next, holds, onDone));
    expect(fleet.setProjects).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual({ status: 'saving' });
    rerender({ ...state });                                   // a broadcast without it: still waiting
    expect(onDone).not.toHaveBeenCalled();
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ status: 'idle' });
    rerender(next);
    expect(onDone).not.toHaveBeenCalled();
    act(() => result.current.send(next, holds, onDone));
    rerender({ ...next });
    expect(onDone).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('unmounted while waiting: no timer outlives it', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useProjectSave({ setProjects: vi.fn() }, state));
    act(() => result.current.send(next, holds, vi.fn()));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
