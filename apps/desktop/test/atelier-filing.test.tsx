import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { projectOf } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { LangProvider } from '../src/i18n/lang';
import { fileSession, ruleFor, useFiling } from '../src/atelier/filing';
import { Toast, useToast } from '../src/shell/Toast';

const named = (name: string) => Object.assign(new Error(name), { name });
const projects: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };

describe('fileSession', () => {
  it('writes the folder rule, and names each refusal', () => {
    const fleet = { setProjects: vi.fn() };
    const kit = fakeSession('dev:kit', { machineId: 'dev', cwd: '/home/me/scratch/' });
    expect(fileSession(fleet, projects, kit, 'ledge')).toBe('sent');
    expect(fleet.setProjects).toHaveBeenCalledWith({ projects: projects.projects, rules: [{ machine: 'dev', path: '/home/me/scratch', project: 'ledge' }] });
    expect(ruleFor(fakeSession('kit', { cwd: '/tmp' }), 'ledge')).toEqual({ machine: 'local', path: '/tmp', project: 'ledge' });
    for (const [error, result] of [['DaemonOffline', 'offline'], ['DaemonOutdated', 'outdated'], ['ZodError', 'invalid']] as const) {
      fleet.setProjects.mockImplementationOnce(() => { throw named(error); });
      expect(fileSession(fleet, projects, kit, 'ledge')).toBe(result);
    }
    fleet.setProjects.mockClear();
    expect(fileSession(fleet, null, kit, 'ledge')).toBe('outdated');
    expect(fleet.setProjects).not.toHaveBeenCalled();
  });
});

describe('useFiling', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <LangProvider lang="en">{children}</LangProvider>;
  const kit = fakeSession('kit', { name: 'Kit', cwd: '/w/ledge/tools' });
  afterEach(() => vi.useRealTimers());

  it('an outdated daemon: says so in plain words, nothing is waited for, nothing is seated', () => {
    const notify = vi.fn();
    const fleet = { setProjects: vi.fn(() => { throw named('DaemonOutdated'); }) };
    const { result } = renderHook(() => useFiling({ fleet, projects, sessions: [kit], projectIdOf: () => null, notify }), { wrapper });
    act(() => result.current.file(kit, 'ledge'));
    expect(notify).toHaveBeenCalledWith('Kit could not be moved: update the local Ledge daemon, it does not know projects yet.');
    expect(result.current.seated).toBeNull();
  });

  it('sent: nothing is said until the broadcast seats the agent, then it is seated for 1.6 s, once', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const fleet = { setProjects: vi.fn() };
    const ruled: Projects = { ...projects, rules: [{ machine: 'local', path: '/w/ledge/tools', project: 'ledge' }] };
    const { result, rerender } = renderHook((p: Projects) => useFiling({ fleet, projects: p, sessions: [kit], projectIdOf: s => projectOf(s, p), notify }),
      { wrapper, initialProps: { ...projects, projects: [] } as Projects });
    act(() => result.current.file(kit, 'ledge'));
    expect(fleet.setProjects).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
    rerender(ruled);
    expect(notify).toHaveBeenCalledExactlyOnceWith('Kit joins the Ledge table. Ledge will remember this folder.');
    expect(result.current.seated).toBe('kit');
    act(() => { vi.advanceTimersByTime(1600); });
    expect(result.current.seated).toBeNull();
    rerender({ ...ruled });
    expect(notify).toHaveBeenCalledOnce();
  });

  it('a rule Ledge never confirms: after 8 s, says so in plain words; nothing moves, nothing is seated', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const fleet = { setProjects: vi.fn() };
    const { result, unmount } = renderHook(() => useFiling({ fleet, projects, sessions: [kit], projectIdOf: () => null, notify }), { wrapper });
    act(() => result.current.file(kit, 'ledge'));
    act(() => { vi.advanceTimersByTime(7999); });
    expect(notify).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(notify).toHaveBeenCalledExactlyOnceWith('Kit was not moved: Ledge did not confirm. Try again.');
    expect(result.current.seated).toBeNull();
    // Forgotten: nothing more is said later.
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(notify).toHaveBeenCalledOnce();
    // Unmounted while waiting: no timer outlives the hook.
    act(() => result.current.file(kit, 'ledge'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a broadcast within 8 s: the joined toast only, never the unconfirmed one', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const fleet = { setProjects: vi.fn() };
    const ruled: Projects = { ...projects, rules: [{ machine: 'local', path: '/w/ledge/tools', project: 'ledge' }] };
    const { result, rerender } = renderHook((p: Projects) => useFiling({ fleet, projects: p, sessions: [kit], projectIdOf: s => projectOf(s, p), notify }),
      { wrapper, initialProps: { ...projects, projects: [] } as Projects });
    act(() => result.current.file(kit, 'ledge'));
    act(() => { vi.advanceTimersByTime(5000); });
    rerender(ruled);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(notify).toHaveBeenCalledExactlyOnceWith('Kit joins the Ledge table. Ledge will remember this folder.');
  });

  it('the French unconfirmed message', () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const fr = ({ children }: { children: ReactNode }) => <LangProvider lang="fr">{children}</LangProvider>;
    const { result } = renderHook(() => useFiling({ fleet: { setProjects: vi.fn() }, projects, sessions: [kit], projectIdOf: () => null, notify }), { wrapper: fr });
    act(() => result.current.file(kit, 'ledge'));
    act(() => { vi.advanceTimersByTime(8000); });
    expect(notify).toHaveBeenCalledWith("Kit n'a pas été rangé : Ledge n'a pas confirmé. Réessayez.");
  });

  it('a target refuses a drag that did not start in the app', () => {
    const fleet = { setProjects: vi.fn() };
    const { result } = renderHook(() => useFiling({ fleet, projects, sessions: [kit], projectIdOf: () => null, notify: vi.fn() }), { wrapper });
    const preventDefault = vi.fn();
    const e = { preventDefault, dataTransfer: { getData: () => 'kit', dropEffect: '' }, currentTarget: document.body, relatedTarget: null } as never;
    act(() => { result.current.dropProps('ledge').onDragOver(e); result.current.dropProps('ledge').onDrop(e); });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(result.current.over).toBeNull();
    expect(fleet.setProjects).not.toHaveBeenCalled();
  });
});

describe('useToast', () => {
  afterEach(() => vi.useRealTimers());
  it('the live region is there before any notice, empty, and the notice appears inside it (so it is announced)', () => {
    const { rerender } = render(<Toast notice={null} />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();
    expect(document.querySelector('.toast')).toBeNull();
    rerender(<Toast notice="Kit joins the Ledge table." />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.querySelector('.toast')).toHaveTextContent('Kit joins the Ledge table.');
    rerender(<Toast notice={null} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });
  it('shows a notice for 6 s by default; a new one restarts the clock', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());
    act(() => result.current.notify('one'));
    expect(result.current.notice).toBe('one');
    act(() => { vi.advanceTimersByTime(5000); });
    act(() => result.current.notify('two'));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.notice).toBe('two');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.notice).toBeNull();
  });
});

/** jsdom loads no stylesheet: the declarations of the top-level rules naming `selector` in one of the app's sheets. */
function declarations(sheet: string, selector: string): string {
  const css = readFileSync(resolve(__dirname, '../src/styles', sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(m => m[1]!.split(',').map(x => x.trim().replace(/\s+/g, ' ')).includes(selector)).map(m => m[2]!.replace(/\s+/g, '')).join(';');
}

describe('the filing styles', () => {
  it('port the mockup: the menu anchor, the grip, the targets, the seat pop, the sidebar targets and the toast', () => {
    expect(declarations('atelier.css', '.assign-wrap')).toBe('position:relative;flex-shrink:0');
    expect(declarations('atelier.css', '.unassigned-card.is-dragged')).toBe('opacity:.4;border-style:dashed');
    expect(declarations('atelier.css', '.office-shell .drop-over .office-rug')).toContain('outline:2pxsolidvar(--sidebar-primary)');
    expect(declarations('atelier.css', '.just-seated')).toContain('animation:seat-pop');
    expect(declarations('sidebar.css', '.side-project.drop-over')).toContain('outline:1.5pxsolidvar(--sidebar-primary)');
    expect(declarations('sidebar.css', '.is-dragging .side-project:not(.drop-over)')).toBe('outline:1pxdashedvar(--input);outline-offset:-1px');
    expect(declarations('shell.css', '.toast')).toContain('position:fixed');
  });
  it('a long name in the drop hint is cut inside the label; a long task wraps on its sheet; a long menu scrolls', () => {
    const hint = declarations('atelier.css', '.drop-hint');
    for (const decl of ['min-width:0', 'overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap']) expect(hint).toContain(decl);
    // its flex parent is capped by the rug, and the label's names shrink too
    expect(declarations('atelier.css', '.office-shell .office-rug .room-heading')).toContain('max-width:calc(100%-28px)');
    expect(declarations('atelier.css', '.heading-names')).toContain('min-width:0');
    expect(declarations('atelier.css', '.task-sheet p')).toContain('overflow-wrap:anywhere');
    const menu = declarations('atelier.css', '.assign-menu');
    expect(menu).toContain('max-height:min(60vh,320px)');
    expect(menu).toContain('overflow:auto');
    expect(declarations('atelier.css', '.assign-menu button')).toContain('flex-shrink:0');
  });
});

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });

const projects3: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'pay', name: 'Payment Service Platform Migration Europe', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] },
    { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/docs' }] }
  ],
  rules: []
};
const DEFAULT: Session[] = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' }),
  fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' })
];

/** atelier.test.tsx's fleet: Otto (Ledge), Nova (Payment…), Kit in /tmp (no project), plus Docs, a project without agents. */
async function boot() {
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }]);
  d.projects(projects3);
  for (const s of DEFAULT) d.upsert(s);
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  render(<App client={client} />);
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent('3'));
  await side.findByRole('button', { name: /^Docs/ });
  await screen.findByRole('button', { name: /^Kit,/ });
  return { d, side, user: userEvent.setup() };
}

/** jsdom has no DataTransfer. */
const transfer = () => { const data: Record<string, string> = {}; return { setData: (k: string, v: string) => { data[k] = v; }, getData: (k: string) => data[k] ?? '', effectAllowed: '', dropEffect: '' }; };

describe('putting an agent away', () => {
  it('only the cards of No project are draggable, with their grip', async () => {
    await boot();
    const card = document.querySelector('.unassigned-card')!;
    expect(card).toHaveAttribute('draggable', 'true');
    expect(card).toHaveAttribute('title', 'Drag onto a table to move it there');
    expect(card.querySelector('.drag-grip')).not.toBeNull();
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(1);
  });

  it('dropping Kit on a table writes the rule; Kit sits there once the daemon broadcasts, once only', async () => {
    const { d } = await boot();
    const card = document.querySelector('.unassigned-card')!;
    const table = screen.getByRole('region', { name: 'Ledge table' });
    const dt = transfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(card).toHaveClass('is-dragged');
    expect(document.querySelector('.application')).toHaveClass('is-dragging');
    expect(within(table).getByText('Drop here')).toBeVisible();
    fireEvent.dragOver(table, { dataTransfer: dt });
    expect(table).toHaveClass('drop-over');
    expect(within(table).getByText('Release to seat Kit')).toBeVisible();
    fireEvent.drop(table, { dataTransfer: dt });
    expect(document.querySelector('.application')).not.toHaveClass('is-dragging');
    await waitFor(() => expect(d.received).toContainEqual({ type: 'projects.set', projects: { projects: projects3.projects, rules: [{ machine: 'local', path: '/tmp', project: 'ledge' }] } }));
    await waitFor(() => expect(within(table).getByRole('button', { name: /^Kit,/ })).toHaveClass('just-seated'));
    expect(screen.getAllByRole('button', { name: /^Kit,/ })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Kit joins the Ledge table. Ledge will remember this folder.');
  });

  it('a project of the sidebar is a target too, and says so while dragging', async () => {
    const { side } = await boot();
    const row = side.getByRole('button', { name: /^Payment Service/ });
    const dt = transfer();
    fireEvent.dragStart(document.querySelector('.unassigned-card')!, { dataTransfer: dt });
    expect(screen.getByText('Drop on a project to move Kit there.')).toBeVisible();
    fireEvent.dragOver(row, { dataTransfer: dt });
    expect(row).toHaveClass('drop-over');
    fireEvent.dragOver(side.getByRole('button', { name: /No project/ }), { dataTransfer: dt });
    expect(side.getByRole('button', { name: /No project/ })).not.toHaveClass('drop-over');
    fireEvent.drop(row, { dataTransfer: dt });
    expect(screen.queryByText('Drop on a project to move Kit there.')).toBeNull();
    await waitFor(() => expect(within(screen.getByRole('region', { name: /^Payment Service.* table$/ })).getByRole('button', { name: /^Kit,/ })).toBeVisible());
  });

  it('a drag that ends outside any target leaves everything as it was', async () => {
    const { d } = await boot();
    const card = document.querySelector('.unassigned-card')!;
    const dt = transfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.dragEnd(card, { dataTransfer: dt });
    expect(card).not.toHaveClass('is-dragged');
    expect(document.querySelector('.application')).not.toHaveClass('is-dragging');
    expect(d.received.some(m => m.type === 'projects.set')).toBe(false);
  });

  it('the dragged agent goes away mid-drag: the drag stops, and a later drop on a table files nothing', async () => {
    const { d } = await boot();
    const card = document.querySelector('.unassigned-card')!;
    const dt = transfer();
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(document.querySelector('.application')).toHaveClass('is-dragging');
    d.remove('kit');
    await waitFor(() => expect(document.querySelector('.application')).not.toHaveClass('is-dragging'));
    expect(screen.queryByText('Drop here')).toBeNull();
    expect(screen.queryByText('Drop on a project to move Kit there.')).toBeNull();
    const table = screen.getByRole('region', { name: 'Ledge table' });
    fireEvent.dragOver(table, { dataTransfer: dt });
    expect(table).not.toHaveClass('drop-over');
    fireEvent.drop(table, { dataTransfer: dt });
    await new Promise(r => setTimeout(r, 50));
    expect(d.received.some(m => m.type === 'projects.set')).toBe(false);
  });

  it('the dragged agent is now covered by a project (a repo): the drag stops', async () => {
    const { d } = await boot();
    fireEvent.dragStart(document.querySelector('.unassigned-card')!, { dataTransfer: transfer() });
    d.projects({ ...projects3, projects: projects3.projects.map(p => (p.id === 'docs' ? { ...p, repos: [...p.repos, { machine: 'local', path: '/tmp' }] } : p)) });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Docs table' })).getByRole('button', { name: /^Kit,/ })).toBeVisible());
    expect(document.querySelector('.application')).not.toHaveClass('is-dragging');
  });

  it('a dragend the card never hears (caught on the window) stops the drag; a drop from outside the app files nothing', async () => {
    const { d } = await boot();
    fireEvent.dragStart(document.querySelector('.unassigned-card')!, { dataTransfer: transfer() });
    expect(document.querySelector('.application')).toHaveClass('is-dragging');
    fireEvent.dragEnd(window);
    expect(document.querySelector('.application')).not.toHaveClass('is-dragging');
    const table = screen.getByRole('region', { name: 'Ledge table' });
    fireEvent.dragOver(table, { dataTransfer: transfer() });
    fireEvent.drop(table, { dataTransfer: transfer() });
    await new Promise(r => setTimeout(r, 50));
    expect(d.received.some(m => m.type === 'projects.set')).toBe(false);
  });

  it('a drop the window catches first still lets the table file the agent, then the drag is over', async () => {
    const { d } = await boot();
    const dt = transfer();
    fireEvent.dragStart(document.querySelector('.unassigned-card')!, { dataTransfer: dt });
    const table = screen.getByRole('region', { name: 'Ledge table' });
    fireEvent.dragOver(table, { dataTransfer: dt });
    fireEvent.drop(table, { dataTransfer: dt });
    await waitFor(() => expect(d.received).toContainEqual({ type: 'projects.set', projects: { projects: projects3.projects, rules: [{ machine: 'local', path: '/tmp', project: 'ledge' }] } }));
    expect(document.querySelector('.application')).not.toHaveClass('is-dragging');
  });

  it('Move to… files Kit; New project… opens the project dialog; Escape closes only the menu', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /No project/ }));            // filter « Sans projet »
    const zone = within(screen.getByRole('region', { name: 'No project' }));
    await user.click(zone.getByRole('button', { name: 'Move to…' }));
    expect(screen.getByRole('menuitem', { name: /^Ledge/ })).toHaveTextContent('ledge');
    expect(screen.getByRole('menuitem', { name: /New project…/ })).toHaveTextContent('From /tmp');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
    await user.click(zone.getByRole('button', { name: 'Move to…' }));
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(zone.getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('menuitem', { name: /New project…/ }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(zone.getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('menuitem', { name: /^Ledge/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'No project' })).toBeNull());      // the filter stays, the zone empties
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Remove the filter: show every project' })).toBeVisible();
    // An emptied « Sans projet » filter: Ledge's desk and the legend, no table, no crash.
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toBeVisible();
    expect(document.querySelector('.workspace-legend')).not.toBeNull();
    expect(screen.queryAllByRole('region', { name: / table$/ })).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Kit joins the Ledge table.');
  });

  it('with the local daemon down, Move to… says so in plain words and Kit stays', async () => {
    const { d, side, user } = await boot();
    await d.close();
    await waitFor(() => expect(side.getByRole('button', { name: /Local/ })).toHaveTextContent('offline'));
    const zone = within(screen.getByRole('region', { name: 'No project' }));
    await user.click(zone.getByRole('button', { name: 'Move to…' }));
    await user.click(screen.getByRole('menuitem', { name: /^Ledge/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Kit could not be moved: the local Ledge daemon is not reachable.');
    expect(zone.getByRole('button', { name: /^Kit,/ })).toBeVisible();
  });
});
