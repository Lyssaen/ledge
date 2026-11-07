import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { daemonStore, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import type { PtyBackend } from '../src/term/backend';
import { TermStore, agentTabId, changesTabId, type TermDeps } from '../src/term/store';
import { TermStoreContext } from '../src/term/useTerms';
import { RightPanel } from '../src/session/RightPanel';
import { tildeHome } from '../src/term/home';
import { fakeBackend, fakeSurface, type FakeSurface, type Open } from './term-fakes';

const env = vi.hoisted(() => ({ backend: null as PtyBackend | null }));
vi.mock('../src/term/backend', () => ({ ptyBackend: () => env.backend }));

// The right panel (Fil | Terminal v3): « ± Modifications » first and fixed, then the shells, then « + ».
const nova = fakeSession('nova', { name: 'Nova', cwd: '/w/pay' });
const mira = fakeSession('mira', { name: 'Mira', cwd: '/srv/app', machineId: 'build-01', machineName: 'build-01' });
const shellArgv = (id: string) => ['sh', '-l', id];
const isShell = (o: Open) => o.argv[0] === 'sh';
const tick = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

let backend: ReturnType<typeof fakeBackend>;
let store: TermStore;
function makeStore(over: Partial<TermDeps> = {}) {
  store = new TermStore({
    backend: env.backend, surface: fakeSurface, shellArgv, agentArgv: id => ['ledge', 'attach', id],
    shellPlace: id => (id === 'mira' ? { dir: '/srv/app', remote: true } : { dir: '~/soft/ledge', remote: false }),
    ...over
  });
}

const NO_MACHINES: readonly unknown[] = [];
function Panel({ session, maxed = false, count = 3, on = {}, machines = NO_MACHINES }: { session: Session; maxed?: boolean; count?: number | null; on?: Partial<Record<'onMax' | 'onClose', () => void>>; machines?: readonly unknown[] }): JSX.Element {
  const client = { send: () => {}, fleet: { machines: () => machines, subscribe: () => () => {} } } as unknown as DaemonClient;
  return (
    <LangProvider lang="fr">
      <TermStoreContext.Provider value={store}>
        <RightPanel client={client} session={session} changes={<p>Le contenu de Modifications</p>} count={count} maxed={maxed}
          onMax={on.onMax ?? (() => {})} onClose={on.onClose ?? (() => {})} />
      </TermStoreContext.Provider>
    </LangProvider>
  );
}
const surfaceOf = (tabId: string) => store.surface(tabId) as FakeSurface | undefined;
const footer = () => document.querySelector<HTMLElement>('.terminal-footer')!;
const mounted = () => document.querySelectorAll('.right-panel [data-terminal]');
const plus = () => fireEvent.click(screen.getByRole('button', { name: 'Nouveau shell' }));

beforeEach(() => { backend = fakeBackend(); env.backend = backend; makeStore(); });
afterEach(() => { act(() => { daemonStore.reset(); }); });

it('opens on Modifications with its count and « + »; no agent tab; enlarge and hide', () => {
  const onClose = vi.fn(); const onMax = vi.fn();
  render(<Panel session={nova} on={{ onClose, onMax }} />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(1);
  expect(tabs[0]).toHaveAccessibleName('Modifications 3');
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Le contenu de Modifications')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Fermer Modifications/ })).toBeNull();
  expect(screen.queryByText('wsl')).toBeNull();                                    // the chip is a shell's
  expect(screen.queryByRole('tab', { name: /agent/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir le panneau' }));
  expect(onMax).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Masquer le panneau' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(backend.opens).toHaveLength(0);
});

it('enlarged, the button reduces it again; before the thread is there the tab gives no count', () => {
  render(<Panel session={nova} maxed count={null} />);
  expect(screen.getByRole('button', { name: 'Réduire le panneau' })).toBeInTheDocument();
  expect(screen.getByRole('tab')).toHaveAccessibleName('Modifications');
});

it('« + » opens a shell in the session\'s folder, the keyboard in it; its tab closes back to Modifications', async () => {
  render(<Panel session={nova} />);
  plus();
  expect(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Modifications 3' })).toHaveAttribute('aria-selected', 'false');
  expect(backend.opens.filter(isShell)).toHaveLength(1);
  const s = surfaceOf('nova#shell-1')!;
  expect(s.written[0]).toBe('Shell ouvert dans le dossier de Nova : ~/soft/ledge\r\n');
  expect(s.focuses).toBe(1);
  expect(document.querySelector('.right-panel')).toContainElement(s.host);
  expect(screen.getByText('wsl', { selector: '.term-chip' })).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●Shellwsl$/);
  await tick();
  plus();
  expect(screen.getByRole('tab', { name: 'Shell 2 · ~/soft/ledge' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer Shell 2 · ~/soft/ledge' }));
  expect(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer Shell · ~/soft/ledge' }));
  expect(screen.getByRole('tab', { name: 'Modifications 3' })).toHaveAttribute('aria-selected', 'true');
  expect(mounted()).toHaveLength(0);
});

it('a tab clicked takes the keyboard: no second click in the screen; Modifications and back keeps the shell', async () => {
  render(<Panel session={nova} />);
  plus(); plus();
  // Each shell took the keyboard as it opened.
  expect(surfaceOf('nova#shell-1')!.focuses).toBe(1);
  expect(surfaceOf('nova#shell-2')!.focuses).toBe(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(surfaceOf('nova#shell-1')!.focuses).toBe(2);
  // The tab already shown: its screen takes the keyboard again.
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(surfaceOf('nova#shell-1')!.focuses).toBe(3);
  const s = surfaceOf('nova#shell-1')!;
  fireEvent.click(screen.getByRole('tab', { name: 'Modifications 3' }));
  expect(store.active('nova')).toBe(changesTabId('nova'));
  expect(mounted()).toHaveLength(0);
  expect(s.disposed).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(surfaceOf('nova#shell-1')).toBe(s);
  expect(mounted()).toHaveLength(1);
});

it('the panel reopens on the tab last used', () => {
  const { unmount } = render(<Panel session={nova} />);
  plus();
  unmount();
  render(<Panel session={nova} />);
  expect(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' })).toHaveAttribute('aria-selected', 'true');
});

it('an ended shell offers « Rouvrir »; a remote one runs over ssh, and a lost one says so', async () => {
  const { unmount } = render(<Panel session={nova} />);
  plus();
  await tick();
  act(() => { backend.opens.find(isShell)!.on.exit(0); });
  expect(screen.getByText('Shell terminé (code 0)')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●wsl$/);
  fireEvent.click(screen.getByRole('button', { name: 'Rouvrir' }));
  expect(backend.opens.filter(isShell)).toHaveLength(2);
  expect(screen.queryByText('Shell terminé (code 0)')).toBeNull();
  expect(surfaceOf('nova#shell-1')!.written.at(-1)).toBe('\r\nShell ouvert dans le dossier de Nova : ~/soft/ledge\r\n');
  unmount();
  render(<Panel session={mira} />);
  plus();
  expect(surfaceOf('mira#shell-1')!.written[0]).toBe('Shell sur build-01, dans le dossier de Mira : /srv/app\r\n');
  expect(screen.getByText('ssh · build-01')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●Shellssh build-01/);
  await tick();
  act(() => { backend.opens.filter(isShell).at(-1)!.on.exit(255); });
  expect(screen.getByText('Shell terminé : connexion perdue')).toBeInTheDocument();
});

it('a shell that ended without a code says so plainly', async () => {
  render(<Panel session={nova} />);
  plus();
  await tick();
  act(() => { backend.opens.find(isShell)!.on.exit(null); });
  expect(screen.getByText('Shell terminé')).toBeInTheDocument();
  expect(screen.queryByText(/code null/)).toBeNull();
});

it('a folder that cannot open says so in its tab; no xterm stays behind', () => {
  makeStore({ shellArgv: () => null });
  render(<Panel session={nova} />);
  plus();
  expect(screen.getByText('Ce dossier ne peut pas être ouvert dans un shell.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Rouvrir' })).toBeNull();
  expect(backend.opens.filter(isShell)).toHaveLength(0);
  expect(mounted()).toHaveLength(0);
});

it('the agent\'s screen is never drawn in the panel', async () => {
  store.showAgent('nova', { kind: 'live' }); await tick();
  render(<Panel session={nova} />);
  plus();
  expect(document.querySelector('.right-panel')).not.toContainElement(surfaceOf(agentTabId('nova'))!.host);
});

it('the home shortens to ~ on whole segments only, and a path is left as is without a known home', () => {
  expect(tildeHome('/home/u/soft/ledge', '/home/u')).toBe('~/soft/ledge');
  expect(tildeHome('/home/u', '/home/u/')).toBe('~');
  expect(tildeHome('/home/u2/soft', '/home/u')).toBe('/home/u2/soft');
  expect(tildeHome('/srv/app', '/home/u')).toBe('/srv/app');
  expect(tildeHome('/home/u/soft', undefined)).toBe('/home/u/soft');
  expect(tildeHome('/home/u/soft', '/')).toBe('/home/u/soft');
});

it("the shell's label and first line name the folder from the machine's home; the tab keeps the real folder", () => {
  makeStore({ shellPlace: () => ({ dir: '/home/u/soft/ledge', remote: false }) });
  const machines = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true, home: '/home/u' } }];
  render(<Panel session={nova} machines={machines} />);
  plus();
  expect(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' })).toBeInTheDocument();
  expect(surfaceOf('nova#shell-1')!.written[0]).toBe('Shell ouvert dans le dossier de Nova : ~/soft/ledge\r\n');
  expect(store.tabs('nova')[0]).toMatchObject({ dir: '/home/u/soft/ledge' });
});

it("an older daemon gives no home: the shell's label and first line show the raw folder", () => {
  makeStore({ shellPlace: () => ({ dir: '/home/u/soft/ledge', remote: false }) });
  const machines = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true } }];
  render(<Panel session={nova} machines={machines} />);
  plus();
  expect(screen.getByRole('tab', { name: 'Shell · /home/u/soft/ledge' })).toBeInTheDocument();
  expect(surfaceOf('nova#shell-1')!.written[0]).toBe('Shell ouvert dans le dossier de Nova : /home/u/soft/ledge\r\n');
});

it('tells the store its shell is shown while mounted, and not any more once unmounted', async () => {
  const shown = vi.spyOn(store, 'setShown');
  const { unmount } = render(<Panel session={nova} />);
  plus();
  await tick();
  expect(shown).toHaveBeenCalledWith('nova#shell-1', true);
  unmount();
  expect(shown).toHaveBeenLastCalledWith('nova#shell-1', false);
});
