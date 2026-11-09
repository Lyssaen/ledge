import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { loadComposer } from '../../src/launch/lazy';
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { PROJECTS } from '../helpers';

/** Lot 4, task 4: the Projects view's header (its « + N » removed on 2026-11-09) and the palette's « Nouvelle session » line (R8, R9). */
type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); });
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });

async function mount({ ide = true }: { ide?: boolean } = {}) {
  await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde(), loadComposer()]);
  if (ide) saveIdeEnabled(true);
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }]);
  d.projects(PROJECTS);
  d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' }));
  d.upsert(fakeSession('nova', { name: 'Nova', cwd: '/w/ledge', state: 'working' }));
  d.thread('otto', []); d.thread('nova', []);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
  await side.findByRole('button', { name: /^Otto/ });
  return { d, side, user: userEvent.setup() };
}

const dialog = () => screen.queryByRole('dialog', { name: 'Nouvelle session' });
// The IDE's palette (lot 10) or, switch off, « Aller à une session ».
const PALETTE = /^(Palette|Aller à une session)$/;
const palette = () => screen.getByRole('dialog', { name: PALETTE });
const options = () => within(screen.getByRole('listbox', { name: /^(Résultats|Sessions)$/ })).getAllByRole('option');
const NEW = /^Nouvelle session/;

describe('the Projects view’s « + N » header (R9)', () => {
  it('a « PROJETS » header, without « + N » (the user, 2026-11-09): N still opens the modal', async () => {
    const { side, user } = await mount();
    const head = document.querySelector('.ide-ex-h')!;
    expect(head).not.toBeNull();
    expect(within(head as HTMLElement).getByText('Projets')).toBeVisible();
    expect(within(head as HTMLElement).queryByRole('button')).toBeNull();
    void side;
    await user.keyboard('n');
    const form = await screen.findByRole('dialog', { name: 'Nouvelle session' });
    expect(form.querySelector('.launch-modal')).not.toBeNull();
  });

  it('switch off: no header', async () => {
    await mount({ ide: false });
    expect(document.querySelector('.ide-ex-h')).toBeNull();
  });
});

describe('the palette’s « Nouvelle session » line (R8, the lot 10 palette)', () => {
  it('empty search, nothing waiting: it is the first option', async () => {
    const { user } = await mount();
    await user.keyboard('{Control>}k{/Control}');
    palette();
    expect(options()[0]).toHaveAccessibleName(NEW);
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(options().length).toBeGreaterThan(1);
  });

  it('« nouv » (and « NOUVELLE ») keeps it; « > » shows the commands, it first; « otto » drops it', async () => {
    const { user } = await mount();
    await user.keyboard('{Control>}k{/Control}');
    const input = within(palette()).getByRole('combobox');
    await user.type(input, 'nouv');
    expect(options()[0]).toHaveAccessibleName(NEW);
    await user.clear(input); await user.type(input, 'NOUVÉLLE');
    expect(options()[0]).toHaveAccessibleName(NEW);
    await user.clear(input); await user.type(input, '>');
    expect(options()[0]).toHaveAccessibleName(NEW);
    expect(screen.queryByRole('option', { name: /Otto/ })).toBeNull();
    await user.clear(input); await user.type(input, 'otto');
    expect(screen.queryByRole('option', { name: NEW })).toBeNull();
    expect(options()[0]).toHaveTextContent('Otto');
  });

  it('↑ ↓ reach it; Enter opens the launch modal in place of the palette', async () => {
    const { user } = await mount();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    await screen.findByRole('dialog', { name: 'Nouvelle session' });
    expect(screen.queryByRole('dialog', { name: PALETTE })).toBeNull();
    expect(dialog()!.querySelector('.launch-modal')).not.toBeNull();
  });

  it('a click on it does the same', async () => {
    const { user } = await mount();
    await user.keyboard('{Control>}k{/Control}');
    await user.click(screen.getByRole('option', { name: NEW }));
    await waitFor(() => expect(dialog()!.querySelector('.launch-modal')).not.toBeNull());
  });

  it('switch off: never a « Nouvelle session » line', async () => {
    const { user } = await mount({ ide: false });
    await user.keyboard('{Control>}k{/Control}');
    palette();
    expect(screen.queryByRole('option', { name: NEW })).toBeNull();
    await user.type(within(palette()).getByRole('combobox'), '>');
    expect(screen.queryByRole('option', { name: NEW })).toBeNull();
  });
});
