import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../../src/fleet/useFleet';
import { App } from '../../src/App';
import { loadWorkspace } from '../../src/session/lazy';
import { loadSettings } from '../../src/settings/lazy';
import { loadHome, loadChat } from '../../src/chat/lazy';
import { loadIde } from '../../src/ide/lazy';
import { LangProvider } from '../../src/i18n/lang';
import { fr } from '../../src/i18n/fr';
import { TabMenu } from '../../src/ide/TabMenu';
import { Toast, useToast } from '../../src/shell/Toast';
import { WorkspaceSection } from '../../src/settings/WorkspaceSection';
import type { SettingsContext } from '../../src/settings/SettingsPage';
import { editorTarget, loadEditor, noticeFor, openSessionInEditor, resetEditorsForTests } from '../../src/ide/openIn';
import { saveIdeEnabled } from '../../src/workspace/prefs';
import { PROJECTS, seedAtelier } from '../helpers';
import type { EditorOutcome, EditorsInstalled } from '../../src/tauri/bridge';

/** « Ouvrir dans… » (IDE lot 11): docs/mockups/ledge-ide-interactive.html (v26) and docs/mockups/ledge-ide-open-in.html (its 9 states). */

type Win = { __ledgeEditors?: EditorsInstalled; __ledgeOpenInEditor?: (a: { editor: string; path: string; ssh?: string }) => EditorOutcome };
const win = window as unknown as Win;
beforeEach(() => { localStorage.clear(); localStorage.setItem('desktop.lang', 'fr'); resetEditorsForTests(); });
afterEach(() => { cleanup(); delete win.__ledgeEditors; delete win.__ledgeOpenInEditor; });

const c = fr.ide.openIn;

describe('where a session\'s worktree is, for the editor', () => {
  const machines = [{ id: 'local', label: 'Local' }, { id: 'srv', label: 'srv-build', ssh: 'srv-build' }, { id: 'bare', label: 'Bare' }];
  it('a local session: its working folder in WSL, else where it started', () => {
    expect(editorTarget(fakeSession('a', { cwd: '/w/ledge', workdir: '/w/ledge-worktrees/a-b' }), machines)).toEqual({ path: '/w/ledge-worktrees/a-b' });
    expect(editorTarget(fakeSession('a', { cwd: '/w/ledge' }), machines)).toEqual({ path: '/w/ledge' });
  });
  it('a remote session: the machine\'s SSH alias; none when the machine is unknown or has no alias', () => {
    expect(editorTarget(fakeSession('srv:a', { cwd: '/srv/app', machineId: 'srv' }), machines)).toEqual({ path: '/srv/app', ssh: 'srv-build' });
    expect(editorTarget(fakeSession('x:a', { cwd: '/srv/app', machineId: 'gone' }), machines)).toBeNull();
    expect(editorTarget(fakeSession('bare:a', { cwd: '/srv/app', machineId: 'bare' }), machines)).toBeNull();
  });
});

describe('what Ledge shows once the editor answered (planche states 1, 2, 4, 7)', () => {
  it('nothing on success', () => { expect(noticeFor({ kind: 'opened' }, 'cursor', c)).toBeNull(); });
  it('the editor missing, and Zed on a WSL folder: a toast with the Settings button', () => {
    expect(noticeFor({ kind: 'missing' }, 'cursor', c)).toEqual({ text: 'Cursor n’est pas installé sur ce PC : choisissez un autre éditeur.', settings: true });
    expect(noticeFor({ kind: 'zedWsl' }, 'zed', c)).toEqual({ text: 'Zed n’ouvre pas les dossiers WSL : choisissez Cursor ou VS Code.', settings: true });
  });
  it('a failed launch says why, without a button; an unknown reason reads as « the program won\'t start »', () => {
    expect(noticeFor({ kind: 'failed', reason: 'exe' }, 'cursor', c)).toEqual({ text: 'Cursor n’a pas pu s’ouvrir : le programme ne démarre pas.', settings: false });
    expect(noticeFor({ kind: 'failed', reason: 'distro' }, 'vscode', c)!.text).toBe('VS Code n’a pas pu s’ouvrir : la distribution WSL ne répond pas.');
    expect(noticeFor({ kind: 'failed', reason: 'path' }, 'cursor', c)!.text).toBe('Cursor n’a pas pu s’ouvrir : WSL ne peut pas recevoir ce chemin.');
    expect(noticeFor({ kind: 'failed', reason: 'other' } as unknown as EditorOutcome, 'zed', c)!.text).toBe('Zed n’a pas pu s’ouvrir : le programme ne démarre pas.');
  });
  it('a session whose machine is no longer listed says so, without asking the editor', async () => {
    const open = vi.fn();
    win.__ledgeOpenInEditor = open;
    const n = await openSessionInEditor(fakeSession('gone:a', { cwd: '/srv/app', machineId: 'gone' }), [{ id: 'local', label: 'Local' }], 'cursor', c);
    expect(n).toEqual({ text: 'Cursor n’a pas pu s’ouvrir : la machine de cette session ne fait plus partie de vos machines.', settings: false });
    expect(open).not.toHaveBeenCalled();
  });
});

describe('the tab\'s menu', () => {
  const show = (extra = {}) => {
    const fns = { onSplit: vi.fn(), onClose: vi.fn(), onCloseOthers: vi.fn(), onDismiss: vi.fn(), onView: vi.fn() };
    render(<LangProvider lang="fr"><TabMenu at={{ x: 10, y: 10 }} tab={{ kind: 'session', ref: 'local:otto' }} name="Otto" terminal={false} others={false}
      session={fakeSession('local:otto', { name: 'Otto' })} {...fns} {...extra} /></LangProvider>);
    return within(screen.getByRole('menu', { name: /Otto/ }));
  };
  it('« Ouvrir dans Cursor » right after the view toggle, before the separator, and it opens', async () => {
    const open = vi.fn();
    const menu = show({ editor: { name: 'Cursor', open } });
    expect(menu.getAllByRole('menuitem').map(i => i.textContent?.replace(/Ctrl.*$/, '').trim())).toEqual(['Basculer sur le terminal', 'Ouvrir dans Cursor', 'Diviser à droite', 'Fermer l’onglet']);
    await userEvent.click(menu.getByRole('menuitem', { name: 'Ouvrir dans Cursor' }));
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('absent without an editor (a tab that is not a session\'s)', () => {
    expect(show().queryByRole('menuitem', { name: /Ouvrir dans Cursor/ })).toBeNull();
  });
});

describe('Settings › Workspace › « Ouvrir dans… » (states 3 and 5)', () => {
  const view = (saved = vi.fn()) => render(<LangProvider lang="fr"><WorkspaceSection ctx={{ saved, client: {} } as unknown as SettingsContext} /></LangProvider>);
  const group = () => within(screen.getByRole('radiogroup', { name: 'Ouvrir dans…' }));
  it('Cursor by default; « pas les dossiers WSL » after Zed always; « non installé » after what this PC lacks, once known', async () => {
    win.__ledgeEditors = { cursor: false, vscode: true, zed: false };
    view();
    expect((group().getByRole('radio', { name: /^Cursor/ }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(group().getByText('non installé')).toBeTruthy());
    const notes = [...document.querySelectorAll('.set-radio-note')].map(n => [n.parentElement!.textContent, n.textContent]);
    expect(notes).toEqual([['Cursornon installé', 'non installé'], ['Zednon installé · pas les dossiers WSL', 'non installé · pas les dossiers WSL']]);
  });
  it('a detection that failed is asked again when Settings opens again', async () => {
    // No answer from the native side (outside Tauri, nothing faked): nothing shows.
    view();
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('.set-radio-note')).toHaveLength(1);
    cleanup();
    win.__ledgeEditors = { cursor: false, vscode: true, zed: true };
    view();
    await waitFor(() => expect(group().getByText('non installé')).toBeTruthy());
    // Known now: a later opening shows it at once, without asking again.
    cleanup();
    win.__ledgeEditors = { cursor: true, vscode: true, zed: true };
    view();
    expect(group().getByText('non installé')).toBeTruthy();
  });
  it('choosing VS Code keeps it, says so, and the menus read it', async () => {
    const saved = vi.fn();
    view(saved);
    await userEvent.click(group().getByRole('radio', { name: /^VS Code/ }));
    expect(saved).toHaveBeenLastCalledWith('Ouvrir dans… : VS Code');
    expect(loadEditor()).toBe('vscode');
  });
});

describe('the toast\'s « Réglages » button', () => {
  function Host({ onRun }: { onRun(): void }) {
    const toast = useToast();
    (Host as unknown as { api: typeof toast }).api = toast;
    return <><button type="button" onClick={() => toast.notify('Cursor n’est pas installé…', { label: 'Réglages', run: onRun, undo: false })}>go</button><Toast notice={toast.notice} action={toast.action} onAction={toast.act} /></>;
  }
  it('shows no Ctrl Z and does not answer it; a click runs it', async () => {
    const run = vi.fn();
    render(<Host onRun={run} />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    const button = screen.getByRole('button', { name: 'Réglages' });
    expect(button.querySelector('kbd')).toBeNull();
    expect(button.getAttribute('aria-keyshortcuts')).toBeNull();
    const api = (Host as unknown as { api: ReturnType<typeof useToast> }).api;
    let undone = true;
    act(() => { undone = api.undo(); });
    expect(undone).toBe(false);
    expect(run).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Réglages' }));
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('an undo action still answers Ctrl Z', () => {
    const run = vi.fn();
    const { result } = renderHook(() => useToast());
    act(() => result.current.notify('x', { label: 'Annuler', run }));
    act(() => { expect(result.current.undo()).toBe(true); });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('in the app: the explorer\'s menu opens the session in the editor', () => {
  const daemons: Awaited<ReturnType<typeof createMockDaemon>>[] = [];
  afterEach(async () => { for (const d of daemons.splice(0)) await d.close(); saveIdeEnabled(false); localStorage.clear(); });
  async function mount() {
    await Promise.all([loadWorkspace(), loadSettings(), loadHome(), loadChat(), loadIde()]);
    seedAtelier();
    saveIdeEnabled(true);
    const d = await createMockDaemon(); daemons.push(d);
    d.machines([{ id: 'local', label: 'Local' }]);
    d.projects(PROJECTS);
    d.upsert(fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', workdir: '/w/ledge-worktrees/otto-x', state: 'working' }));
    render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
    const side = within(await screen.findByRole('complementary', { name: 'Barre latérale' }));
    const tree = within(await side.findByRole('tree', { name: 'Projets, branches et sessions' }));
    return { otto: await tree.findByRole('button', { name: /^Otto/ }), user: userEvent.setup() };
  }
  const entry = () => within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Ouvrir dans Cursor' });

  it('last entry; opens the worktree in Cursor and shows nothing on success', async () => {
    const calls: unknown[] = [];
    win.__ledgeOpenInEditor = a => { calls.push(a); return { kind: 'opened' }; };
    const { otto, user } = await mount();
    fireEvent.contextMenu(otto);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.getAttribute('aria-label'));
    expect(items.indexOf('Ouvrir dans Cursor')).toBe(3);
    await user.click(entry());
    await waitFor(() => expect(calls).toEqual([{ editor: 'cursor', path: '/w/ledge-worktrees/otto-x' }]));
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('Cursor missing: the toast, and « Réglages » opens Settings › Workspace', async () => {
    win.__ledgeOpenInEditor = () => ({ kind: 'missing' });
    const { otto, user } = await mount();
    fireEvent.contextMenu(otto);
    await user.click(entry());
    expect(await screen.findByText('Cursor n’est pas installé sur ce PC : choisissez un autre éditeur.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Réglages' }));
    expect(await screen.findByRole('radiogroup', { name: 'Ouvrir dans…' })).toBeTruthy();
  });

  it('a failed launch: the toast with its reason, no button', async () => {
    win.__ledgeOpenInEditor = () => ({ kind: 'failed', reason: 'distro' });
    const { otto, user } = await mount();
    fireEvent.contextMenu(otto);
    await user.click(entry());
    expect(await screen.findByText('Cursor n’a pas pu s’ouvrir : la distribution WSL ne répond pas.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Réglages' })).toBeNull();
  });
});
