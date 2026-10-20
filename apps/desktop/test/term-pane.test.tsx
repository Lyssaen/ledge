import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, type JSX } from 'react';
import { daemonStore, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import type { PtyBackend, PtyEvents } from '../src/term/backend';
import type { TermSurface } from '../src/term/surface';
import { TermStore, agentTabId, type TermDeps } from '../src/term/store';
import { TermStoreContext } from '../src/term/useTerms';
import { agentMode } from '../src/term/mode';
import { TermPane } from '../src/session/TermPane';
import { tildeHome } from '../src/term/home';

const env = vi.hoisted(() => ({ backend: null as PtyBackend | null, opened: true }));
vi.mock('../src/term/backend', () => ({ ptyBackend: () => env.backend }));
vi.mock('../src/session/terminal', () => ({ openSessionTerminal: vi.fn(async () => env.opened) }));

type Open = { argv: string[]; on: PtyEvents; resolve(ok: boolean): void };
type FakeSurface = TermSurface & { written: (Uint8Array | string)[]; fits: number; focuses: number; disposed: boolean };

function fakeBackend() {
  const opens: Open[] = [];
  let hold = false;
  const backend: PtyBackend & { opens: Open[]; hold(on: boolean): void } = {
    opens,
    hold: on => { hold = on; },
    open: (argv, _size, on) => new Promise(res => {
      const o: Open = { argv, on, resolve: ok => res(ok ? { write: () => {}, resize: () => {}, close: () => {} } : null) };
      opens.push(o);
      if (!hold) o.resolve(true);
    })
  };
  return backend;
}

function fakeSurface(): FakeSurface {
  const host = document.createElement('div');
  host.setAttribute('data-terminal', '');
  const s: FakeSurface = {
    host, written: [], fits: 0, focuses: 0, disposed: false,
    write: b => { s.written.push(b); }, onInput: () => {}, onResize: () => {},
    size: () => ({ cols: 80, rows: 24 }), fit: () => { s.fits += 1; }, focus: () => { s.focuses += 1; },
    setReadOnly: () => {}, setTheme: () => {}, dispose: () => { s.disposed = true; }
  };
  return s;
}

const nova = fakeSession('nova', { name: 'Nova', cwd: '/w/pay' });
const mira = fakeSession('mira', { name: 'Mira', cwd: '/srv/app', machineId: 'build-01', machineName: 'build-01' });
const shellArgv = (id: string) => ['sh', '-l', id];
const isShell = (o: Open) => o.argv[0] === 'sh';
const tick = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

let backend: ReturnType<typeof fakeBackend>;
let store: TermStore;
let retry: ReturnType<typeof vi.fn>;
let agentCalls: [string, boolean][];
function makeStore(over: Partial<TermDeps> = {}) {
  agentCalls = [];
  store = new TermStore({
    backend: env.backend, surface: fakeSurface, shellArgv,
    agentArgv: (id, ro) => { agentCalls.push([id, ro]); return ['ledge', 'attach', id]; },
    shellPlace: id => (id === 'mira' ? { dir: '/srv/app', remote: true } : { dir: '~/soft/ledge', remote: false }),
    ...over
  });
}

const NO_MACHINES: readonly unknown[] = [];
/** What Workspace does around the pane (Task 7): it shows the agent tab while the pane is open. */
function Pane({ session, helper = null, maxed = false, on = {}, machines = NO_MACHINES }: { session: Session; helper?: { id: string; name: string } | null; maxed?: boolean; on?: Partial<Record<'notify' | 'onMax' | 'onClose' | 'onGoParent', () => void>>; machines?: readonly unknown[] }): JSX.Element {
  useLayoutEffect(() => { store.showAgent(session.id, agentMode(session, helper, env.backend !== null)); }, [session, helper]);
  const client = { send: () => {}, fleet: { retry, machines: () => machines, subscribe: () => () => {} } } as unknown as DaemonClient;
  return (
    <LangProvider lang="fr">
      <TermStoreContext.Provider value={store}>
        <TermPane client={client} session={session} helper={helper} notify={on.notify ?? (() => {})} maxed={maxed}
          onMax={on.onMax ?? (() => {})} onClose={on.onClose ?? (() => {})} onGoParent={on.onGoParent ?? (() => {})} />
      </TermStoreContext.Provider>
    </LangProvider>
  );
}
const surfaceOf = (tabId: string) => store.surface(tabId) as FakeSurface | undefined;
const footer = () => document.querySelector<HTMLElement>('.terminal-footer')!;
const preview = (id: string, lines: string[]) => act(() => { daemonStore.apply({ type: 'session.preview', id, lines }); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
  backend = fakeBackend(); env.backend = backend; env.opened = true; retry = vi.fn();
  makeStore();
});
afterEach(() => { vi.useRealTimers(); act(() => { daemonStore.reset(); }); });

it('heading: agent tab, shell tab, « + », machine chip, external, enlarge, close', async () => {
  const onClose = vi.fn(); const onMax = vi.fn();
  render(<Pane session={nova} on={{ onClose, onMax }} />);
  await tick();
  expect(screen.getByRole('tablist')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Nova · agent' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' })).toHaveAttribute('aria-selected', 'false');
  expect(screen.getByText('wsl')).toBeInTheDocument();
  for (const n of ['Nouveau shell', 'Ouvrir dans un terminal externe', 'Agrandir le terminal']) expect(screen.getByRole('button', { name: n })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Fermer Nova · agent' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Agrandir le terminal' }));
  expect(onMax).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Masquer le terminal' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('enlarged, the button reduces it again', () => {
  render(<Pane session={nova} maxed />);
  expect(screen.getByRole('button', { name: 'Réduire le terminal' })).toBeInTheDocument();
});

it('the agent tab mounts its own xterm in the body, once, and fits it', async () => {
  const { rerender } = render(<Pane session={nova} />);
  await tick();
  const s = surfaceOf(agentTabId('nova'))!;
  expect(document.querySelector('.terminal-pane')).toContainElement(s.host);
  expect(s.fits).toBeGreaterThan(0);
  rerender(<Pane session={nova} maxed />);
  expect(surfaceOf(agentTabId('nova'))).toBe(s);
  expect(document.querySelectorAll('[data-terminal]')).toHaveLength(1);
});

it('footer says attached, by ssh on a remote machine', async () => {
  const { unmount } = render(<Pane session={nova} />);
  await tick();
  expect(screen.getByText('Attaché')).toBeInTheDocument();
  expect(screen.getByText('tmux · ledge-nova')).toBeInTheDocument();
  expect(screen.getByText('Donner le clavier au terminal · Ctrl `')).toBeInTheDocument();
  unmount();
  render(<Pane session={mira} />);
  await tick();
  expect(screen.getByText('Attaché par SSH')).toBeInTheDocument();
  expect(screen.getByText('ssh · build-01')).toBeInTheDocument();
  expect(screen.getByText('ssh build-01 · tmux · ledge-mira')).toBeInTheDocument();
});

it('the keyboard hint follows the focus into the terminal and back', async () => {
  render(<Pane session={nova} />);
  await tick();
  const s = surfaceOf(agentTabId('nova'))!;
  const inner = document.createElement('textarea'); s.host.appendChild(inner);
  act(() => { inner.focus(); });
  expect(screen.getByText('Le clavier va au terminal · revenir au fil : Ctrl `')).toBeInTheDocument();
  act(() => { inner.blur(); });
  expect(screen.getByText('Donner le clavier au terminal · Ctrl `')).toBeInTheDocument();
});

it('a lost connection shows the countdown and « Reconnecter » retries now', async () => {
  render(<Pane session={mira} />);
  await tick();
  expect(backend.opens).toHaveLength(1);
  act(() => { backend.opens[0]!.on.exit(255); });
  expect(screen.getByText('Connexion à build-01 perdue. Nouvelle tentative dans 1 s (essai 1). Mira continue de travailler sur le serveur.')).toBeInTheDocument();
  expect(screen.getByText('Reconnexion…')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reconnecter' }));
  expect(backend.opens).toHaveLength(2);
  await tick();
  expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
  expect(screen.getByText('Attaché par SSH')).toBeInTheDocument();
});

it('the countdown ticks down while it waits', async () => {
  render(<Pane session={mira} />);
  await tick();
  act(() => { backend.opens[0]!.on.exit(255); });
  backend.hold(true);
  act(() => { vi.advanceTimersByTime(1000); });
  act(() => { backend.opens[1]!.on.exit(255); });
  expect(screen.getByText(/Nouvelle tentative dans 2 s \(essai 2\)/)).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText(/Nouvelle tentative dans 1 s \(essai 2\)/)).toBeInTheDocument();
});

it('a subagent sees its parent read-only, with « Aller à Nova »', async () => {
  const onGoParent = vi.fn();
  render(<Pane session={nova} helper={{ id: 'h1', name: 'Iris' }} on={{ onGoParent }} />);
  await tick();
  expect(agentCalls).toEqual([['nova', true]]);
  expect(screen.getByText('Iris est un sous-agent de Nova et n’a pas de terminal à lui : voici l’écran de Nova, en lecture seule.')).toBeInTheDocument();
  expect(screen.getByText('Lecture seule')).toBeInTheDocument();
  expect(screen.queryByText(/Donner le clavier/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Aller à Nova' }));
  expect(onGoParent).toHaveBeenCalledTimes(1);
});

it('offline: frozen preview lines, no input, « Réessayer »', async () => {
  const off = { ...nova, offline: true };
  render(<Pane session={off} />);
  preview('nova', ['$ npm test', 'ok']);
  await tick();
  expect(screen.getByText('$ npm test')).toBeInTheDocument();
  expect(screen.getByText('Hors ligne')).toBeInTheDocument();
  // The fleet does not say since when: no time rather than a wrong one.
  expect(screen.getByText('wsl ne répond plus. Dernière sortie conservée ; rien ne peut être tapé.')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●Hors lignewsl$/);
  expect(document.querySelector('[data-terminal]')).toBeNull();
  expect(backend.opens).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Ouvrir dans un terminal externe' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retry).toHaveBeenCalledWith('local');
});

it('offline after being attached: the last screen stays, frozen', async () => {
  const { rerender } = render(<Pane session={mira} />);
  await tick();
  const s = surfaceOf(agentTabId('mira'))!;
  rerender(<Pane session={{ ...mira, offline: true }} />);
  expect(document.querySelector('.terminal-pane')).toContainElement(s.host);
  expect(screen.getByText('build-01 ne répond plus. Dernière sortie conservée ; rien ne peut être tapé.')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●Hors lignebuild-01$/);
  expect(screen.queryByRole('button', { name: 'Ouvrir dans un terminal externe' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retry).toHaveBeenCalledWith('build-01');
});

it('launched outside Ledge: the preview and its banner; the shell tab still works', async () => {
  const outside = { ...nova, tmuxSession: null };
  render(<Pane session={outside} />);
  preview('nova', ['dernière ligne']);
  await tick();
  expect(screen.getByText('Nova a été lancée hors de Ledge : pas d’écran à rattacher. Voici ses dernières lignes, en lecture seule. Votre shell reste disponible.')).toBeInTheDocument();
  expect(screen.getByText('dernière ligne')).toBeInTheDocument();
  expect(screen.getByText('Aperçu · lecture seule')).toBeInTheDocument();
  expect(screen.getByText('aucune session tmux')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(backend.opens.filter(isShell)).toHaveLength(1);
  const s = surfaceOf('nova#shell-1')!;
  expect(s.written[0]).toBe('Shell ouvert dans le dossier de Nova : ~/soft/ledge\r\n');
  expect(footer()).toHaveTextContent(/^●Shellwsl/);
  await tick();
  act(() => { backend.opens[0]!.on.data(new Uint8Array([36])); });
  expect(s.written).toHaveLength(2);
  expect(document.querySelector('.terminal-pane')).toContainElement(s.host);
});

it('an ended session gets its own wording', async () => {
  render(<Pane session={{ ...nova, state: 'exited' }} />);
  await tick();
  expect(screen.getByText('Nova est terminée : voici ses dernières lignes, en lecture seule. Votre shell reste disponible.')).toBeInTheDocument();
  expect(screen.getByText('Aperçu · lecture seule')).toBeInTheDocument();
});

it('an ended shell offers « Rouvrir »; a lost ssh one says so', async () => {
  const { unmount } = render(<Pane session={nova} />);
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  await tick();
  act(() => { backend.opens.find(isShell)!.on.exit(0); });
  expect(screen.getByText('Shell terminé (code 0)')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●wsl$/);
  fireEvent.click(screen.getByRole('button', { name: 'Rouvrir' }));
  expect(backend.opens.filter(isShell)).toHaveLength(2);
  expect(screen.queryByText('Shell terminé (code 0)')).toBeNull();
  expect(surfaceOf('nova#shell-1')!.written.at(-1)).toBe('\r\nShell ouvert dans le dossier de Nova : ~/soft/ledge\r\n');
  unmount();
  render(<Pane session={mira} />);
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · /srv/app' }));
  expect(surfaceOf('mira#shell-1')!.written[0]).toBe('Shell sur build-01, dans le dossier de Mira : /srv/app\r\n');
  expect(footer()).toHaveTextContent(/^●Shellssh build-01/);
  await tick();
  act(() => { backend.opens.filter(isShell).at(-1)!.on.exit(255); });
  expect(screen.getByText('Shell terminé : connexion perdue')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Rouvrir' })).toBeInTheDocument();
});

it('a folder that cannot open says so in its tab', async () => {
  makeStore({ shellArgv: () => null });
  render(<Pane session={nova} />);
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(screen.getByText('Ce dossier ne peut pas être ouvert dans un shell.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Rouvrir' })).toBeNull();
  expect(backend.opens.filter(isShell)).toHaveLength(0);
});

it('« + » opens another shell beside the first; its tab closes', async () => {
  render(<Pane session={nova} />);
  await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau shell' }));
  expect(screen.getByRole('tab', { name: 'Shell 2 · ~/soft/ledge' })).toHaveAttribute('aria-selected', 'true');
  expect(backend.opens.filter(isShell)).toHaveLength(1);
  expect(surfaceOf('nova#shell-2')!.written[0]).toBe('Shell ouvert dans le dossier de Nova : ~/soft/ledge\r\n');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer Shell 2 · ~/soft/ledge' }));
  expect(screen.queryByRole('tab', { name: 'Shell 2 · ~/soft/ledge' })).toBeNull();
  expect(screen.getByRole('tab', { name: 'Nova · agent' })).toHaveAttribute('aria-selected', 'true');
});

it('a tab clicked, or a shell just added, takes the keyboard: no second click in the screen', async () => {
  render(<Pane session={nova} />);
  await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Nouveau shell' }));
  expect(surfaceOf('nova#shell-2')!.focuses).toBe(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(surfaceOf('nova#shell-1')!.focuses).toBe(1);
  // The tab already shown: its screen takes the keyboard again.
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(surfaceOf('nova#shell-1')!.focuses).toBe(2);
  expect(surfaceOf('nova#shell-2')!.focuses).toBe(1);
});

it('the external terminal that cannot open says so', async () => {
  env.opened = false;
  const notify = vi.fn();
  render(<Pane session={nova} on={{ notify }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir dans un terminal externe' }));
  await tick();
  expect(notify).toHaveBeenCalledWith('Le terminal de Nova n’a pas pu s’ouvrir.');
});

it('with no screen to attach, the agent tab shows the preview read-only, with no banner', async () => {
  makeStore({ agentArgv: () => null });
  render(<Pane session={nova} />);
  preview('nova', ['sortie']);
  await tick();
  expect(screen.getByText('sortie')).toBeInTheDocument();
  expect(screen.getByText('Lecture seule')).toBeInTheDocument();
  expect(screen.queryByText(/hors de Ledge/)).toBeNull();
  expect(document.querySelector('[data-terminal]')).toBeNull();
});

it('the first attach shows the screen at once, not the preview', async () => {
  backend.hold(true);
  render(<Pane session={nova} />);
  preview('nova', ['sortie']);
  await tick();
  expect(store.link('nova').state).toBe('off');
  expect(screen.getByText('Connexion…')).toBeInTheDocument();
  expect(screen.queryByText('sortie')).toBeNull();
  expect(document.querySelector('.terminal-pane')).toContainElement(surfaceOf(agentTabId('nova'))!.host);
});

it('the browser build keeps the read-only preview', async () => {
  env.backend = null;
  makeStore();
  render(<Pane session={nova} />);
  preview('nova', ['sortie']);
  await tick();
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
  expect(screen.getByText('sortie')).toBeInTheDocument();
  expect(screen.getByText('Lecture seule')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nouveau shell' })).toBeNull();
});

const mounted = () => document.querySelectorAll('.terminal-pane [data-terminal]');

it('back from a shell to the preview, no xterm stays behind; the shell comes back when its tab is shown again', async () => {
  render(<Pane session={{ ...nova, tmuxSession: null }} />);
  preview('nova', ['dernière ligne']);
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  await tick();
  const s = surfaceOf('nova#shell-1')!;
  expect(mounted()).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Nova · agent' }));
  expect(mounted()).toHaveLength(0);
  expect(screen.getByText('dernière ligne')).toBeInTheDocument();
  expect(s.disposed).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(surfaceOf('nova#shell-1')).toBe(s);
  expect(document.querySelector('.terminal-pane')).toContainElement(s.host);
  expect(mounted()).toHaveLength(1);
});

it('a shell that cannot open does not leave the agent\'s screen under its banner; the agent comes back on its tab', async () => {
  makeStore({ shellArgv: () => null });
  render(<Pane session={nova} />);
  await tick();
  const agent = surfaceOf(agentTabId('nova'))!;
  expect(mounted()).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  expect(screen.getByText('Ce dossier ne peut pas être ouvert dans un shell.')).toBeInTheDocument();
  expect(mounted()).toHaveLength(0);
  expect(agent.disposed).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: 'Nova · agent' }));
  expect(surfaceOf(agentTabId('nova'))).toBe(agent);
  expect(document.querySelector('.terminal-pane')).toContainElement(agent.host);
  expect(mounted()).toHaveLength(1);
});

it('a local agent screen that drops says it came detached, and « Reconnecter » retries now', async () => {
  render(<Pane session={nova} />);
  await tick();
  act(() => { backend.opens[0]!.on.exit(1); });
  expect(screen.getByText('L’écran de Nova s’est détaché. Nouvelle tentative dans 1 s (essai 1).')).toBeInTheDocument();
  expect(screen.queryByText(/Connexion à/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reconnecter' }));
  expect(backend.opens).toHaveLength(2);
});

it('a shell that ended without a code says so plainly', async () => {
  render(<Pane session={nova} />);
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  await tick();
  act(() => { backend.opens.find(isShell)!.on.exit(null); });
  expect(screen.getByText('Shell terminé')).toBeInTheDocument();
  expect(screen.queryByText(/code null/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Rouvrir' })).toBeInTheDocument();
});

it('the home shortens to ~ on whole segments only, and a path is left as is without a known home', () => {
  expect(tildeHome('/home/u/soft/ledge', '/home/u')).toBe('~/soft/ledge');
  expect(tildeHome('/home/u', '/home/u/')).toBe('~');
  expect(tildeHome('/home/u2/soft', '/home/u')).toBe('/home/u2/soft');
  expect(tildeHome('/srv/app', '/home/u')).toBe('/srv/app');
  expect(tildeHome('/home/u/soft', undefined)).toBe('/home/u/soft');
  expect(tildeHome('/home/u/soft', '/')).toBe('/home/u/soft');
});

it("the shell's label and first line name the folder from the machine's home; the tab keeps the real folder", async () => {
  makeStore({ shellPlace: () => ({ dir: '/home/u/soft/ledge', remote: false }) });
  const machines = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true, home: '/home/u' } }];
  render(<Pane session={nova} machines={machines} />);
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · ~/soft/ledge' }));
  await tick();
  expect(surfaceOf('nova#shell-1')!.written[0]).toBe('Shell ouvert dans le dossier de Nova : ~/soft/ledge\r\n');
  expect(store.tabs('nova')[1]).toMatchObject({ dir: '/home/u/soft/ledge' });
});

it("an older daemon gives no home: the shell's label and first line show the raw folder", async () => {
  makeStore({ shellPlace: () => ({ dir: '/home/u/soft/ledge', remote: false }) });
  const machines = [{ id: 'local', daemon: { version: '1', install: 'npm', systemd: true } }];
  render(<Pane session={nova} machines={machines} />);
  await tick();
  fireEvent.click(screen.getByRole('tab', { name: 'Shell · /home/u/soft/ledge' }));
  await tick();
  expect(surfaceOf('nova#shell-1')!.written[0]).toBe('Shell ouvert dans le dossier de Nova : /home/u/soft/ledge\r\n');
});
