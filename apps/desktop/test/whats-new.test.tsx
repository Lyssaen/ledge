import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { AvailableUpdate } from '../src/update/bridge';

// The app runs Ledge 0.9.0, just updated from 0.7.0 (its notes kept at install); 0.9.1 waits on the server.
const up = vi.hoisted(() => ({ notes: '## Fixes\n- **Faster** start\n- `ledge who`\n\n<img src=x onerror="alert(1)"> <b>raw</b>', install: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock('../src/update/bridge', () => {
  up.install = vi.fn(async () => {});
  return {
    appVersion: async () => '0.9.0',
    relaunchApp: async () => {},
    checkForUpdate: async (): Promise<AvailableUpdate> => ({ version: '0.9.1', notes: up.notes, downloadAndInstall: up.install as AvailableUpdate['downloadAndInstall'] })
  };
});
const opened = vi.hoisted(() => [] as string[]);
vi.mock('../src/tauri/bridge', async importOriginal => ({ ...(await importOriginal<typeof import('../src/tauri/bridge')>()), openUrl: (u: string) => { opened.push(u); } }));

import { updater } from '../src/update/store';
import { keepNotes } from '../src/update/notes';
import { boot, closeDaemons } from './helpers';

beforeAll(async () => {
  localStorage.clear();
  localStorage.setItem('desktop.update.seen', '0.7.0');
  localStorage.setItem('desktop.update.from', '0.7.0');
  keepNotes('0.9.0', '- Detachable Atelier');
  await updater.start();
});
afterEach(async () => { await closeDaemons(); opened.length = 0; });

const dialog = (name: string | RegExp) => within(screen.getByRole('dialog', { name }));

describe('What’s new (#26)', () => {
  it('the first launch on a new version shows its notes once, with the releases skipped over', async () => {
    const { user, view } = await boot();
    const d = dialog('Ledge was updated to 0.9.0');
    expect(d.getByText('Detachable Atelier')).toBeInTheDocument();
    await user.click(d.getByRole('button', { name: /All releases/ }));
    expect(opened).toEqual(['https://github.com/Lyssaen/ledge/releases']);
    await user.click(d.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    view.unmount(); await closeDaemons();
    await boot();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Settings › About opens the installed version’s notes and its GitHub release', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>},{/Control}');
    await user.click(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: /^About/ }));
    await user.click(screen.getByRole('button', { name: 'What’s new' }));
    const d = dialog('What’s new in Ledge 0.9.0');
    expect(d.getByText('Detachable Atelier')).toBeInTheDocument();
    await user.click(d.getByRole('button', { name: /GitHub release/ }));
    expect(opened).toEqual(['https://github.com/Lyssaen/ledge/releases/tag/v0.9.0']);
  });

  it('an available update shows its notes before installing, as Markdown and never as HTML; Later installs nothing', async () => {
    const { user } = await boot();
    await user.keyboard('{Control>},{/Control}');
    const updates = within(await screen.findByRole('region', { name: 'Updates' }));
    await user.click(updates.getByRole('button', { name: 'Install' }));
    const d = dialog('What’s new in Ledge 0.9.1');
    expect(d.getByRole('heading', { name: 'Fixes' })).toBeInTheDocument();
    expect(d.getByText('Faster').tagName).toBe('STRONG');
    expect(d.getByText('ledge who').tagName).toBe('CODE');
    expect(screen.getByRole('dialog').querySelector('img, b')).toBeNull();
    await user.click(d.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(up.install).not.toHaveBeenCalled();
    await user.click(updates.getByRole('button', { name: 'Install' }));
    await user.click(dialog('What’s new in Ledge 0.9.1').getByRole('button', { name: 'Update' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(up.install).toHaveBeenCalledTimes(1);
  });
});
