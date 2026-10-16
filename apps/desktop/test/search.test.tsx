import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { Projects } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });

const projects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'pay', name: 'Payment Service Platform Migration Europe', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] }
  ],
  rules: []
};

async function boot() {
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }]);
  d.projects(projects);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' }));
  d.upsert(fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' }));
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  render(<App client={client} />);
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent('3'));
  await side.findByRole('button', { name: /^Ledge/ });
  return { user: userEvent.setup() };
}

describe('the session search', () => {
  it('filters as you type, walks with arrows and opens with Enter', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('pay');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([expect.stringContaining('Nova')]);
    await user.clear(screen.getByRole('combobox')); await user.keyboard('{ArrowDown}{Enter}');
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when nothing matches', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>}k{/Control}zzz');
    expect(screen.getByText('No session matches this search.')).toBeVisible();
  });

  it('shows Alt n on the first nine main agents', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>}k{/Control}');
    // Every fake session's title starts with « Otto », so pick the option by its own name line.
    const option = (name: string) => screen.getAllByRole('option').find(o => o.querySelector('strong')?.textContent?.startsWith(name))!;
    expect(option('Otto')).toHaveTextContent('Alt 1');
    expect(option('Nova')).toHaveTextContent('Alt 2');
    expect(option('Kit')).toHaveTextContent('Alt 3');
  });

  it('arrows stay within the list, hover selects, a click opens', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>}k{/Control}{ArrowUp}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]!.id);
    await user.hover(screen.getAllByRole('option')[1]!);
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getAllByRole('option')[1]!);
    expect(within(screen.getByRole('banner')).getByText('Nova')).toBeVisible();
  });

  it('the shortcuts help lists the rows without Ctrl Alt N', async () => {
    const { user } = await boot();
    await user.keyboard('?');
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Open Ledge chat')).toBeVisible();
    expect(dialog.textContent).not.toContain('Ctrl Alt N');
  });
});
