import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider } from '../src/i18n/lang';
import { FolderBrowser } from '../src/launch/FolderBrowser';
import { answer, ask, BROWSER_START, childOf, crumbs, type Listing } from '../src/launch/folders';
import { fakeFleet } from './launch-helpers';

const listing = (path: string, entries: string[], extra: Partial<Listing> = {}): Listing =>
  ({ type: 'folder.listing', path, parent: path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/', entries, ...extra });

function setup(start = '/w', ready = true, f = fakeFleet()) {
  const onChoose = vi.fn(); const onClose = vi.fn();
  const view = render(<FolderBrowser fleet={f} machine="devbox" label="Devbox · SSH" ready={ready} start={start} onChoose={onChoose} onClose={onClose} />);
  const reply = (l: Listing, machine = 'devbox') => act(() => f.emit(machine, l));
  return { f, onChoose, onClose, view, reply };
}

describe('folders (pure)', () => {
  it('builds paths and the breadcrumb', () => {
    expect(childOf('/', 'w')).toBe('/w');
    expect(childOf('/w', 'ledge')).toBe('/w/ledge');
    expect(crumbs('/w/ledge')).toEqual([{ name: '/', path: '/' }, { name: 'w', path: '/w' }, { name: 'ledge', path: '/w/ledge' }]);
  });
  it('takes one request at a time and ignores a listing nobody asked for', () => {
    const asked = ask(BROWSER_START, 'list')!;
    expect(ask(asked, 'list')).toBeNull();
    expect(answer(BROWSER_START, listing('/w', [])).browser).toBe(BROWSER_START);
  });
  it('ignores a late listing for another path than the one asked', () => {
    const asked = ask(BROWSER_START, 'list', '/w/api')!;
    expect(answer(asked, listing('/w/old', ['x'])).browser).toBe(asked);
    expect(answer(asked, listing('/w/api', [])).browser).toMatchObject({ pending: null, shown: { path: '/w/api' } });
  });
  it('falls back to home when the first folder cannot be listed, keeping the reason', () => {
    const first = answer(ask(BROWSER_START, 'list')!, listing('/nope', [], { error: 'not found' }));
    expect(first.next).toEqual({ type: 'folder.list' });
    expect(first.browser).toMatchObject({ pending: 'fallback', error: 'not found', shown: null });
    expect(answer(first.browser, listing('/home/dev', ['w'])).browser).toMatchObject({ pending: null, error: 'not found', shown: { path: '/home/dev' } });
  });
});

describe('FolderBrowser', () => {
  it('lists the field\'s folder on the chosen machine, then walks down, up and along the breadcrumb', async () => {
    const { f, reply } = setup('  /w ');
    expect(f.sent).toEqual([{ machine: 'devbox', msg: { type: 'folder.list', path: '/w' } }]);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    reply(listing('/w', ['api', 'ledge']));
    expect(screen.getByRole('region', { name: 'Folders on Devbox · SSH' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open ledge' }));
    expect(f.sent.at(-1)).toEqual({ machine: 'devbox', msg: { type: 'folder.list', path: '/w/ledge' } });
    reply(listing('/w/ledge', []));
    expect(screen.getByText('No subfolders.')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Folder path' })).toHaveTextContent('/w/ledge');
    await userEvent.click(screen.getByRole('button', { name: 'Parent folder' }));
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.list', path: '/w' });
    reply(listing('/w', ['api', 'ledge']));
    await userEvent.click(screen.getByRole('button', { name: '/' }));
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.list', path: '/' });
  });
  it('opens on home when the field holds no accepted path', () => {
    const { f } = setup('w/relative');
    expect(f.sent).toEqual([{ machine: 'devbox', msg: { type: 'folder.list' } }]);
  });
  it('sends one request at a time: a click while waiting is ignored', async () => {
    const { f, reply } = setup();
    reply(listing('/w', ['api', 'ledge']));
    await userEvent.click(screen.getByRole('button', { name: 'Open api' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open ledge' }));
    expect(f.sent.map(s => s.msg)).toEqual([{ type: 'folder.list', path: '/w' }, { type: 'folder.list', path: '/w/api' }]);
    expect(screen.getByRole('button', { name: 'Choose this folder' })).toBeDisabled();
  });
  it('ignores another machine\'s listing and a listing nobody asked for', () => {
    const { reply } = setup();
    reply(listing('/elsewhere', ['x']), 'local');
    expect(screen.queryByRole('button', { name: 'Open x' })).toBeNull();
    reply(listing('/w', ['api']));
    reply(listing('/w', ['surprise']));
    expect(screen.queryByRole('button', { name: 'Open surprise' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open api' })).toBeInTheDocument();
  });
  it('falls back to home when the first folder cannot be listed', () => {
    const { f, reply } = setup('/nope');
    reply(listing('/nope', [], { error: 'no such folder' }));
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.list' });
    reply(listing('/home/dev', ['w']));
    expect(screen.getByRole('status')).toHaveTextContent('Could not: no such folder');
    expect(screen.getByRole('button', { name: 'Open w' })).toBeInTheDocument();
  });
  it('creates a folder in place, with Enter, and stays on the parent when it is refused', async () => {
    const { f, reply } = setup();
    reply(listing('/w', []));
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const name = screen.getByRole('textbox', { name: 'New folder name' });
    expect(name).toHaveFocus();
    await userEvent.type(name, 'bad/name{Enter}');
    expect(f.sent.at(-1)!.msg).toEqual({ type: 'folder.create', parent: '/w', name: 'bad/name' });
    reply(listing('/w', [], { error: 'invalid name' }));
    expect(screen.getByRole('status')).toHaveTextContent('Could not: invalid name');
    expect(screen.getByRole('textbox', { name: 'New folder name' })).toHaveValue('bad/name');
    await userEvent.clear(name);
    await userEvent.type(name, 'api');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    reply(listing('/w/api', []));
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('cannot choose a folder while a request is pending', async () => {
    const { reply } = setup();
    reply(listing('/w', []));
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'New folder name' }), 'api{Enter}');
    expect(screen.getByRole('button', { name: 'Choose this folder' })).toBeDisabled();
  });
  it('chooses the folder shown', async () => {
    const { onChoose, reply } = setup();
    reply(listing('/w', []));
    await userEvent.click(screen.getByRole('button', { name: 'Choose this folder' }));
    expect(onChoose).toHaveBeenCalledWith('/w');
  });
  it('Escape leaves the new folder name first, then the browser', async () => {
    const { onClose, reply } = setup();
    reply(listing('/w', []));
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Close' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('says so when the machine is not connected, and never waits forever', () => {
    setup('/w', true, fakeFleet(['devbox']));
    expect(screen.getByRole('status')).toHaveTextContent('Devbox · SSH is not connected: the folders cannot be listed.');
    expect(screen.queryByText('Loading…')).toBeNull();
  });
  it('a machine lost while a listing is pending stops the wait', () => {
    const f = fakeFleet();
    const { view } = setup('/w', true, f);
    view.rerender(<FolderBrowser fleet={f} machine="devbox" label="Devbox · SSH" ready={false} start="/w" onChoose={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('is not connected');
  });
  it('speaks French', () => {
    render(<LangProvider lang="fr"><FolderBrowser fleet={fakeFleet()} machine="devbox" label="Devbox · SSH" ready start="/w" onChoose={() => {}} onClose={() => {}} /></LangProvider>);
    expect(screen.getByRole('region', { name: 'Dossiers sur Devbox · SSH' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choisir ce dossier' })).toBeDisabled();
  });
});
