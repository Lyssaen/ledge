import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { Projects, Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';
import { saveReduced } from '../src/motionPreferences';

/** jsdom loads no stylesheet: the declarations of the top-level rules naming `selector` in one of the app's sheets. */
function declarations(sheet: string, selector: string): string {
  const css = readFileSync(resolve(__dirname, '../src/styles', sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(m => m[1]!.split(',').map(x => x.trim().replace(/\s+/g, ' ')).includes(selector)).map(m => m[2]!.replace(/\s+/g, '')).join(';');
}

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); vi.unstubAllEnvs(); saveReduced(false); for (const d of daemons.splice(0)) await d.close(); });

const projects: Projects = {
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

/** The shell tests' fleet: Otto (Ledge), Nova (Payment…), Kit (no project), plus Docs, a project without agents. */
async function boot({ sessions = DEFAULT }: { sessions?: Session[] } = {}) {
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }]);
  d.projects(projects);
  for (const s of sessions) d.upsert(s);
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  const view = render(<App client={client} />);
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(sessions.length)));
  await side.findByRole('button', { name: /^Docs/ });
  if (sessions.length > 0) await screen.findByRole('button', { name: new RegExp(`^${sessions[0]!.name},`) });
  return { d, side, view, client, user: userEvent.setup() };
}

describe('the atelier', () => {
  it("Ledge's desk, a table per project with agents, and Sans projet", async () => {
    await boot();
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm watching over 3 agents.");
    expect(screen.getByRole('region', { name: 'Ledge table' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Payment Service Platform Migration Europe table' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Docs table' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'No project' })).getByRole('button', { name: /^Kit,/ })).toBeVisible();
    expect(screen.queryByText('This screen is coming soon.')).toBeNull();
  });
  it("Ledge's desk toggles the chat", async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Talk to Ledge' }));
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm listening.");
  });
  it("no agent at all: only Ledge's desk", async () => {
    await boot({ sessions: [] });
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveTextContent("I'm watching over 0 agents.");
    expect(screen.queryAllByRole('region', { name: / table$/ })).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
  });
  it('a filter shows its table; a project without agents proposes New session; No project shows the zone only', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Ledge/ }));
    expect(screen.getAllByRole('region', { name: / table$/ }).map(r => r.getAttribute('aria-label'))).toEqual(['Ledge table']);
    expect(screen.queryByRole('region', { name: 'No project' })).toBeNull();
    await user.click(side.getByRole('button', { name: /^Docs/ }));
    expect(screen.getByRole('heading', { name: 'No agent at the Docs table' })).toBeVisible();
    await user.click(within(document.querySelector<HTMLElement>('.empty-project')!).getByRole('button', { name: 'New session' }));
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(side.getByRole('button', { name: /No project/ }));
    expect(screen.queryAllByRole('region', { name: / table$/ })).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'No project' })).toBeVisible();
  });
  it('J / K walk the agents shown, Enter opens the chosen one', async () => {
    const { user } = await boot();
    await user.keyboard('j'); expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveFocus();
    await user.keyboard('j'); expect(screen.getByRole('button', { name: /^Nova,/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}'); expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveClass('keyboard-selected');
    await user.keyboard('k'); expect(screen.getByRole('button', { name: /^Kit,/ })).toHaveFocus();       // wraps
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();
  });
  it("an offline machine's agent is greyed, its bot frozen, and it still opens", async () => {
    const { d, user } = await boot();
    d.upsert(fakeSession('rio', { name: 'Rio', cwd: '/w/ledge', state: 'working', offline: true }));
    const rio = await screen.findByRole('button', { name: /^Rio,/ });
    expect(rio).toHaveClass('seat-offline');
    expect(within(rio).getByText('Offline')).toBeVisible();
    await user.click(rio);
    expect(within(screen.getByRole('banner')).getByText('Rio')).toBeVisible();
  });
  it('freezing the animations pauses the atelier', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('button', { name: 'Freeze animations' }));
    expect(document.querySelector('.office-shell')).toHaveClass('office-paused');
  });

  // Beyond the brief: the review ledger's carried items.
  it('the tables, the desk and the zone sit inside .office-shell (the label rules are scoped there); the legend outside', async () => {
    await boot();
    const shell = document.querySelector<HTMLElement>('.overview-scroll.atelier > .office-shell')!;
    expect(shell).not.toBeNull();
    for (const name of ['Ledge table', 'Payment Service Platform Migration Europe table', 'No project']) expect(shell).toContainElement(screen.getByRole('region', { name }));
    expect(shell).toContainElement(screen.getByRole('button', { name: 'Talk to Ledge' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'view-panel-atelier');
    expect(panel).toHaveAttribute('aria-labelledby', 'view-tab-atelier');
    const legend = document.querySelector<HTMLElement>('.workspace-legend')!;
    expect(panel).toContainElement(legend);
    expect(shell).not.toContainElement(legend);
    expect(legend).toHaveTextContent('A small bot is a subagent.');
  });
  it("the app's own reduced-motion setting stills the atelier's plants, not only the OS one", async () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');          // the suite forces reduced motion; look at the app setting alone
    await boot();
    const shell = document.querySelector('.office-shell')!;
    expect(shell).not.toHaveClass('office-reduced');
    expect(shell).not.toHaveClass('office-paused');
    saveReduced(true);
    await waitFor(() => expect(shell).toHaveClass('office-reduced'));
    expect(declarations('atelier.css', '.office-reduced .plants *')).toContain('animation:none!important');
  });
  it('a long agent or machine name never grows a seat: one line with an ellipsis, the full name in the label and the title', async () => {
    const long = 'Archibald-Maximilian-Theodore-the-Third';
    const { d } = await boot();
    d.upsert(fakeSession('arch', { name: long, cwd: '/w/ledge', state: 'working' }));
    const seat = await screen.findByRole('button', { name: new RegExp(`^${long},`) });
    expect(within(seat).getByText(long)).toHaveAttribute('title', long);
    const machine = seat.querySelector('.seat-machine')!;
    expect(machine.textContent).not.toBe('');
    expect(machine).toHaveAttribute('title', machine.textContent);
    for (const selector of ['.seat-name', '.office-shell .agent-seat .seat-machine']) {
      const rule = declarations('atelier.css', selector);
      for (const decl of ['overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap']) expect(rule).toContain(decl);
    }
    expect(declarations('atelier.css', '.office-shell .agent-seat .seat-machine')).toContain('max-width:100%');
    expect(declarations('atelier.css', '.seat-name')).toContain('min-width:0');
    // The name shrinks inside a row capped at the seat's width; the « Alt n » hint keeps its size.
    for (const decl of ['display:flex', 'max-width:100%']) expect(declarations('atelier.css', '.agent-seat>strong')).toContain(decl);
    expect(declarations('atelier.css', '.agent-seat .seat-shortcut')).toContain('flex-shrink:0');
  });
  it('Enter on a focused button keeps its own action: the chosen agent is not opened', async () => {
    const { user } = await boot();
    await user.keyboard('j');
    expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveClass('keyboard-selected');
    screen.getByRole('button', { name: 'Talk to Ledge' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
    expect(within(screen.getByRole('banner')).queryByText('Otto')).toBeNull();
  });
  it('Enter with the focus on the floor opens the chosen agent', async () => {
    const { user } = await boot();
    await user.keyboard('j');
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Enter}');
    expect(within(screen.getByRole('banner')).getByText('Otto')).toBeVisible();
  });
  it('J / K leave the view tabs and an open menu alone', async () => {
    const { user } = await boot();
    screen.getByRole('tab', { name: 'Atelier' }).focus();
    await user.keyboard('j');
    expect(screen.getByRole('tab', { name: 'Atelier' })).toHaveFocus();
    expect(document.querySelector('.keyboard-selected')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions of project Ledge' }));
    const first = within(screen.getByRole('menu')).getAllByRole('menuitem')[0]!;
    expect(first).toHaveFocus();
    await user.keyboard('k');
    expect(first).toHaveFocus();
    expect(document.querySelector('.keyboard-selected')).toBeNull();
  });
  it('the choice falls back to nothing when the agent leaves the walk', async () => {
    const { side, user } = await boot();
    await user.keyboard('j');
    expect(screen.getByRole('button', { name: /^Otto,/ })).toHaveClass('keyboard-selected');
    await user.click(side.getByRole('button', { name: /^Payment Service Platform/ }));     // Otto is no longer shown
    await user.click(side.getByRole('button', { name: /Atelier/ }));
    expect(screen.getByRole('button', { name: /^Otto,/ })).not.toHaveClass('keyboard-selected');
    expect(document.querySelector('.keyboard-selected')).toBeNull();
  });
  it('Sans projet: a card per agent with its task, machine and folder, its badge, and a click opens it', async () => {
    const { user } = await boot();
    const zone = screen.getByRole('region', { name: 'No project' });
    expect(zone).toHaveTextContent('Ledge links these sessions to no project.');
    const kit = within(zone).getByRole('button', { name: /^Kit,/ });
    expect(kit).toHaveClass('unassigned-open');
    expect(kit.dataset.agent).toMatch(/kit$/);           // the fleet's id for Kit
    expect(kit).toHaveTextContent('Alt 3');
    expect(kit.querySelector('code')).toHaveTextContent(/ · \/tmp$/);
    expect(within(zone).getByText('Question')).toHaveAttribute('data-badge', 'question');
    await user.click(kit);
    expect(within(screen.getByRole('banner')).getByText('Kit')).toBeVisible();
  });
  it('the empty table names the folders of its repositories', async () => {
    const { side, user } = await boot();
    await user.click(side.getByRole('button', { name: /^Docs/ }));
    expect(document.querySelector('.empty-project')).toHaveTextContent('The table will appear as soon as a session starts in docs.');
  });
  it('the List view is still pending', async () => {
    const { user } = await boot();
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(screen.getByRole('region', { name: 'List' })).toBeVisible();
    expect(document.querySelector('.office-shell')).toBeNull();
  });
});
