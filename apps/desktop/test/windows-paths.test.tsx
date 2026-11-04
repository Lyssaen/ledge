import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { DaemonClient } from '@ledge/fleet';
import { createMockDaemon } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { FolderPicker } from '../src/projects/FolderPicker';
import { answers } from '../src/launch/useLaunch';
import { tildeHome } from '../src/term/home';
import { repoKey } from '../src/projects/draft';
import { nameOf, relativeTo } from '../src/session/changedFiles';

// Native Windows (spec 2026-11-03 §1): a project folder is `C:\Users\po\work`, browsed, typed in any spelling, and found
// again in the session the daemon launches there.
type MockDaemon = Awaited<ReturnType<typeof createMockDaemon>>;
const opened: { d: MockDaemon; client: DaemonClient }[] = [];
afterEach(async () => { for (const { d, client } of opened.splice(0)) { client.close(); await d.close(); } });

async function setup() {
  const d = await createMockDaemon();
  d.options.home = 'C:\\Users\\po';
  d.machines([{ id: 'local', label: 'Local' }]);
  d.folders.set('C:\\Users\\po', { entries: ['work'] });
  d.folders.set('C:\\Users\\po\\work', { entries: [] });
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  opened.push({ d, client });
  client.connect();
  await waitFor(() => expect(client.fleet!.machines().find(m => m.id === 'local')?.ready).toBe(true));
  const onAdd = vi.fn();
  render(<FolderPicker client={client} machines={client.fleet!.machines()} taken={() => false} owner={() => null} onAdd={onAdd} />);
  const list = within(await screen.findByRole('list', { name: 'Contents of C:\\Users\\po on Local' }));
  return { d, onAdd, list, user: userEvent.setup() };
}

describe('Windows folders in Desktop', () => {
  it('the picker lists and adds a Windows folder', async () => {
    const { onAdd, list, user } = await setup();
    const crumbs = within(screen.getByRole('navigation', { name: 'Current folder' }));
    expect(crumbs.getAllByRole('button').map(b => b.textContent)).toEqual(['C:', 'Users', 'po']);
    await user.click(list.getByRole('button', { name: 'Add work (Local)' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ machine: 'local', path: 'C:\\Users\\po\\work' }));
  });

  it('a typed Windows path is accepted in any spelling and stored normalized', async () => {
    const { onAdd, user } = await setup();
    await user.type(screen.getByRole('textbox', { name: 'Path on Local' }), 'c:/users/po/work/{Enter}');
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ machine: 'local', path: 'C:\\users\\po\\work' })));
  });

  it('a new folder with a Windows-invalid name is refused in the picker', async () => {
    const { d, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    await user.type(screen.getByRole('textbox', { name: 'Name of the new folder in C:\\Users\\po on Local' }), 'a:b{Enter}');
    expect(screen.getByRole('alert')).toBeVisible();
    expect(d.received.filter(m => m.type === 'folder.create')).toEqual([]);
  });

  it('a launch in another spelling of its folder is answered', () => {
    const msg = { type: 'session.launch' as const, tool: 'claude' as const, cwd: 'C:\\Users\\po\\work' };
    expect(answers(msg, 'local:a1', [{ id: 'local:a1', tool: 'claude', cwd: 'c:/users/po/work/' }])).toBe(true);
    expect(answers(msg, 'local:a1', [{ id: 'local:a1', tool: 'claude', cwd: 'C:\\Users\\po\\workshop' }])).toBe(false);
  });

  it('home is shortened on Windows', () => {
    expect(tildeHome('C:\\Users\\po\\work', 'C:\\Users\\po')).toBe('~\\work');
    expect(tildeHome('/home/po/w', '/home/po')).toBe('~/w');
  });

  it('one Windows folder is one repository in the editor, whatever its spelling', () => {
    expect(repoKey('local', 'C:\\Users\\po\\work')).toBe(repoKey('local', 'c:/users/po/work/'));
    expect(repoKey('local', '/w/a')).not.toBe(repoKey('local', '/w/A'));
  });

  it('changed files read Windows paths: their name, and their place under the session folder', () => {
    expect(nameOf('C:\\Users\\po\\work\\src\\app.ts')).toBe('app.ts');
    expect(relativeTo('C:\\Users\\po\\work\\src\\app.ts', 'c:\\users\\po\\work')).toBe('src\\app.ts');
    expect(relativeTo('/w/a/b.ts', '/w/a')).toBe('b.ts');
  });
});
