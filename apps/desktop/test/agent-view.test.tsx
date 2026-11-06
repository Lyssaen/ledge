import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useLayoutEffect, type JSX } from 'react';
import { daemonStore, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import type { PtyBackend } from '../src/term/backend';
import { TermStore, agentTabId, type TermDeps } from '../src/term/store';
import { TermStoreContext } from '../src/term/useTerms';
import { agentMode } from '../src/term/mode';
import { AgentView, useAgent } from '../src/session/AgentView';
import { focusAgentView } from '../src/session/agentFocus';
import { fakeBackend, fakeSurface, type FakeSurface } from './term-fakes';
import { TabPlaceContext } from '../src/workspace/tabPlace';

const env = vi.hoisted(() => ({ backend: null as PtyBackend | null }));
vi.mock('../src/term/backend', () => ({ ptyBackend: () => env.backend }));

// The Terminal view (Fil | Terminal v3): the agent's own screen, alone under the session's heading.
const nova = fakeSession('nova', { name: 'Nova', cwd: '/w/pay' });
const mira = fakeSession('mira', { name: 'Mira', cwd: '/srv/app', machineId: 'build-01', machineName: 'build-01' });
const tick = async () => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

let backend: ReturnType<typeof fakeBackend>;
let store: TermStore;
let retry: ReturnType<typeof vi.fn>;
let agentCalls: [string, boolean][];
function makeStore(over: Partial<TermDeps> = {}) {
  agentCalls = [];
  store = new TermStore({
    backend: env.backend, surface: fakeSurface, shellArgv: id => ['sh', '-l', id],
    agentArgv: (id, ro) => { agentCalls.push([id, ro]); return ['ledge', 'attach', id]; },
    shellPlace: () => ({ dir: '~/soft/ledge', remote: false }),
    ...over
  });
}

const NO_HOLDERS: ReadonlyMap<string, string> = new Map();
/** What Workspace does around the view: the agent's screen is attached while the Terminal view shows it. */
function Inner({ session, helper, on, client }: { session: Session; helper: { id: string; name: string } | null; on: Partial<Record<'notify' | 'onGoParent' | 'onOpenShell', () => void>>; client: DaemonClient }): JSX.Element {
  useLayoutEffect(() => { store.showAgent(session.id, agentMode(session, helper, env.backend !== null)); }, [session, helper]);
  const agent = useAgent(session, helper);
  return <AgentView client={client} session={session} helper={helper} agent={agent} notify={on.notify ?? (() => {})} onGoParent={on.onGoParent ?? (() => {})} onOpenShell={on.onOpenShell ?? (() => {})} />;
}
function View({ session, helper = null, on = {}, holders = NO_HOLDERS, release = () => {} }: { session: Session; helper?: { id: string; name: string } | null; on?: Partial<Record<'notify' | 'onGoParent' | 'onOpenShell', () => void>>; holders?: ReadonlyMap<string, string>; release?: (id: string) => void }): JSX.Element {
  const client = { send: () => {}, fleet: { retry, machines: () => [], subscribe: () => () => {}, terminalHolders: () => holders, releaseTerminal: release } } as unknown as DaemonClient;
  return (
    <LangProvider lang="fr">
      <TermStoreContext.Provider value={store}><Inner session={session} helper={helper} on={on} client={client} /></TermStoreContext.Provider>
    </LangProvider>
  );
}
const surfaceOf = (tabId: string) => store.surface(tabId) as FakeSurface | undefined;
const footer = () => document.querySelector<HTMLElement>('.terminal-footer')!;
const preview = (id: string, lines: string[]) => act(() => { daemonStore.apply({ type: 'session.preview', id, lines }); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
  backend = fakeBackend(); env.backend = backend; retry = vi.fn();
  makeStore();
});
afterEach(() => { vi.useRealTimers(); act(() => { daemonStore.reset(); }); });

it('the agent screen mounts its own xterm, once, and fits it; no tab, no shell here', async () => {
  const { rerender } = render(<View session={nova} />);
  await tick();
  const s = surfaceOf(agentTabId('nova'))!;
  expect(document.querySelector('.agent-view')).toContainElement(s.host);
  expect(s.fits).toBeGreaterThan(0);
  rerender(<View session={{ ...nova }} />);
  expect(surfaceOf(agentTabId('nova'))).toBe(s);
  expect(document.querySelectorAll('[data-terminal]')).toHaveLength(1);
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
  expect(screen.getByRole('region', { name: 'Terminal' })).toHaveAttribute('data-typeable', 'true');
});

it('footer says attached, by ssh on a remote machine', async () => {
  const { unmount } = render(<View session={nova} />);
  await tick();
  expect(screen.getByText('Attaché')).toBeInTheDocument();
  expect(screen.getByText('tmux · ledge-nova')).toBeInTheDocument();
  expect(screen.getByText('Donner le clavier au terminal · Ctrl `')).toBeInTheDocument();
  unmount();
  render(<View session={mira} />);
  await tick();
  expect(screen.getByText('Attaché par SSH')).toBeInTheDocument();
  expect(screen.getByText('ssh build-01 · tmux · ledge-mira')).toBeInTheDocument();
});

it('the keyboard hint follows the focus into the screen and back', async () => {
  render(<View session={nova} />);
  await tick();
  const s = surfaceOf(agentTabId('nova'))!;
  const inner = document.createElement('textarea'); s.host.appendChild(inner);
  act(() => { inner.focus(); });
  expect(screen.getByText('Le clavier va au terminal · revenir au fil : Ctrl `')).toHaveClass('footkey');
  act(() => { inner.blur(); });
  expect(screen.getByText('Donner le clavier au terminal · Ctrl `')).toBeInTheDocument();
});

it('Ctrl + ² hands the keyboard to a live screen, else to the banner\'s button, never to a read-only screen', async () => {
  const { unmount } = render(<View session={nova} />);
  await tick();
  focusAgentView(store, 'nova');
  expect(surfaceOf(agentTabId('nova'))!.focuses).toBe(1);
  unmount();
  render(<View session={nova} helper={{ id: 'h1', name: 'Iris' }} />);
  await tick();
  focusAgentView(store, 'nova');
  expect(screen.getByRole('button', { name: 'Aller à Nova' })).toHaveFocus();
  expect(surfaceOf(agentTabId('nova'))!.focuses).toBe(1);
});

it('a lost connection shows the countdown and « Reconnecter » retries now; the Terminal tab\'s dot waits', async () => {
  render(<View session={mira} />);
  await tick();
  expect(backend.opens).toHaveLength(1);
  act(() => { backend.opens[0]!.on.exit(255); });
  expect(screen.getByText('Connexion à build-01 perdue. Nouvelle tentative dans 1 s (essai 1). Mira continue de travailler sur le serveur.')).toBeInTheDocument();
  expect(screen.getByText('Reconnexion…')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Terminal' })).toHaveAttribute('data-typeable', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Reconnecter' }));
  expect(backend.opens).toHaveLength(2);
  await tick();
  expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
  expect(screen.getByText('Attaché par SSH')).toBeInTheDocument();
});

it('the countdown ticks down while it waits', async () => {
  render(<View session={mira} />);
  await tick();
  act(() => { backend.opens[0]!.on.exit(255); });
  backend.hold(true);
  act(() => { vi.advanceTimersByTime(1000); });
  act(() => { backend.opens[1]!.on.exit(255); });
  expect(screen.getByText(/Nouvelle tentative dans 2 s \(essai 2\)/)).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText(/Nouvelle tentative dans 1 s \(essai 2\)/)).toBeInTheDocument();
});

it('a local agent screen that drops says it came detached', async () => {
  render(<View session={nova} />);
  await tick();
  act(() => { backend.opens[0]!.on.exit(1); });
  expect(screen.getByText('L’écran de Nova s’est détaché. Nouvelle tentative dans 1 s (essai 1).')).toBeInTheDocument();
  expect(screen.queryByText(/Connexion à/)).toBeNull();
});

it('a subagent sees its parent read-only, with « Aller à Nova »', async () => {
  const onGoParent = vi.fn();
  render(<View session={nova} helper={{ id: 'h1', name: 'Iris' }} on={{ onGoParent }} />);
  await tick();
  expect(agentCalls).toEqual([['nova', true]]);
  expect(screen.getByText('Iris est un sous-agent de Nova et n’a pas de terminal à lui : voici l’écran de Nova, en lecture seule.')).toBeInTheDocument();
  expect(screen.getByText('Lecture seule')).toBeInTheDocument();
  expect(screen.queryByText(/Donner le clavier/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Aller à Nova' }));
  expect(onGoParent).toHaveBeenCalledTimes(1);
});

it('offline: frozen preview lines, no input, « Réessayer »', async () => {
  render(<View session={{ ...nova, offline: true }} />);
  preview('nova', ['$ npm test', 'ok']);
  await tick();
  expect(screen.getByText('$ npm test')).toBeInTheDocument();
  // The fleet does not say since when: no time rather than a wrong one.
  expect(screen.getByText('wsl ne répond plus. Dernière sortie conservée ; rien ne peut être tapé.')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●Hors lignewsl$/);
  expect(document.querySelector('[data-terminal]')).toBeNull();
  expect(backend.opens).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retry).toHaveBeenCalledWith('local');
});

it('offline after being attached: the last screen stays, frozen', async () => {
  const { rerender } = render(<View session={mira} />);
  await tick();
  const s = surfaceOf(agentTabId('mira'))!;
  rerender(<View session={{ ...mira, offline: true }} />);
  expect(document.querySelector('.agent-view')).toContainElement(s.host);
  expect(screen.getByText('build-01 ne répond plus. Dernière sortie conservée ; rien ne peut être tapé.')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●Hors lignebuild-01$/);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(retry).toHaveBeenCalledWith('build-01');
});

it('launched outside Ledge, or ended: the preview and its banner (the shells are in the panel now)', async () => {
  const { unmount } = render(<View session={{ ...nova, tmuxSession: null }} />);
  preview('nova', ['dernière ligne']);
  await tick();
  expect(screen.getByText('Nova a été lancée hors de Ledge : pas d’écran à rattacher. Voici ses dernières lignes, en lecture seule.')).toBeInTheDocument();
  expect(screen.getByText('dernière ligne')).toBeInTheDocument();
  expect(screen.getByText('Aperçu · lecture seule')).toBeInTheDocument();
  expect(screen.getByText('aucune session tmux')).toBeInTheDocument();
  unmount();
  render(<View session={{ ...nova, state: 'exited' }} />);
  await tick();
  expect(screen.getByText('Nova est terminée : voici ses dernières lignes, en lecture seule.')).toBeInTheDocument();
});

it('an OMP session has no agent screen: its own text, « Ouvrir un shell », nothing attached', async () => {
  const onOpenShell = vi.fn();
  const pim = fakeSession('pim', { name: 'Pim', tool: 'omp', backend: 'omp-rpc' } as Partial<Session>);
  render(<View session={pim} on={{ onOpenShell }} />);
  await tick();
  expect(screen.getByText('Ledge pilote Pim directement : il n’a pas d’écran d’agent.')).toBeInTheDocument();
  expect(screen.getByText('Son travail se lit dans le fil. Vous pouvez ouvrir un shell dans son dossier, dans le panneau de droite.')).toBeInTheDocument();
  expect(footer()).toHaveTextContent(/^●Pas d’écran d’agent$/);
  expect(backend.opens).toHaveLength(0);
  focusAgentView(store, 'pim');
  expect(screen.getByRole('button', { name: 'Ouvrir un shell' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un shell' }));
  expect(onOpenShell).toHaveBeenCalledTimes(1);
});

it('with no screen to attach, the preview read-only, with no banner', async () => {
  makeStore({ agentArgv: () => null });
  render(<View session={nova} />);
  preview('nova', ['sortie']);
  await tick();
  expect(screen.getByText('sortie')).toBeInTheDocument();
  expect(screen.getByText('Lecture seule')).toBeInTheDocument();
  expect(screen.queryByText(/hors de Ledge/)).toBeNull();
  expect(document.querySelector('[data-terminal]')).toBeNull();
});

it('the first attach shows the screen at once, not the preview', async () => {
  backend.hold(true);
  render(<View session={nova} />);
  preview('nova', ['sortie']);
  await tick();
  expect(store.link('nova').state).toBe('off');
  expect(screen.getByText('Connexion…')).toBeInTheDocument();
  expect(screen.queryByText('sortie')).toBeNull();
  expect(document.querySelector('.agent-view')).toContainElement(surfaceOf(agentTabId('nova'))!.host);
});

it('the browser build keeps the read-only preview', async () => {
  env.backend = null;
  makeStore();
  render(<View session={nova} />);
  preview('nova', ['sortie']);
  await tick();
  expect(screen.getByText('sortie')).toBeInTheDocument();
  expect(screen.getByText('Lecture seule')).toBeInTheDocument();
});

it('says when a phone types into the agent\'s terminal, and takes the hand back', async () => {
  const release = vi.fn();
  render(<View session={nova} holders={new Map([[nova.id, 'iPhone · Safari']])} release={release} />);
  await tick();
  expect(screen.getByText('iPhone · Safari au clavier : il tape dans le terminal de Nova.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reprendre la main' }));
  expect(release).toHaveBeenCalledWith(nova.id);
});

/** Two IDE tabs of the same session (R2): their views, each in its tab place, with nothing shown until the test says. */
function TwoTabs({ session, other = session }: { session: Session; other?: Session }): JSX.Element {
  const client = { send: () => {}, fleet: { retry, machines: () => [], subscribe: () => () => {}, terminalHolders: () => NO_HOLDERS, releaseTerminal: () => {} } } as unknown as DaemonClient;
  const Tab = ({ k, s }: { k: string; s: Session }) => {
    const agent = useAgent(s, null);
    return (
      <TabPlaceContext.Provider value={{ key: k, group: `g-${k}`, visible: true, active: k === 't1' }}>
        <div data-tab={k}><AgentView client={client} session={s} helper={null} agent={agent} notify={() => {}} onGoParent={() => {}} onOpenShell={() => {}} /></div>
      </TabPlaceContext.Provider>
    );
  };
  return <LangProvider lang="fr"><TermStoreContext.Provider value={store}><Tab k="t1" s={session} /><Tab k="t2" s={other} /></TermStoreContext.Provider></LangProvider>;
}

it('R2: the same session in two tabs: the tab holding its screen draws it, the other says where it is and brings it back', async () => {
  render(<TwoTabs session={nova} />);
  act(() => { store.showAgent('nova', { kind: 'live' }, 't1'); });
  await tick();
  const s = surfaceOf(agentTabId('nova'))!;
  const tab = (k: string) => document.querySelector<HTMLElement>(`[data-tab="${k}"]`)!;
  expect(tab('t1')).toContainElement(s.host);
  expect(tab('t2')).toHaveTextContent('Terminal affiché dans l’autre groupe');
  expect(tab('t2').querySelector('.agent-view')).toHaveAttribute('data-typeable', 'false');
  expect(tab('t1')).not.toHaveTextContent('Terminal affiché dans l’autre groupe');
  // Its footer: the dot and the pane's name, no empty state slot.
  const foot = tab('t2').querySelector('.terminal-footer')!;
  expect([...foot.children].map(c => c.className)).toEqual(['term-dot off', 'mono']);
  expect([...foot.children].every(c => c.textContent !== '')).toBe(true);
  fireEvent.click(within(tab('t2')).getByRole('button', { name: 'Afficher ici' }));
  await tick();
  expect(store.viewerOf('nova')).toBe('t2');
  expect(tab('t2')).toContainElement(s.host);
  expect(tab('t1')).toHaveTextContent('Terminal affiché dans l’autre groupe');
  expect(backend.opens).toHaveLength(1);
});

it('the keyboard goes to the asked session\'s screen when two are drawn, and to the tab holding it when one session is drawn twice', async () => {
  const pay = fakeSession('pay', { name: 'Pay', cwd: '/w/pay' });
  const { unmount } = render(<TwoTabs session={nova} other={pay} />);
  act(() => { store.showAgent('nova', { kind: 'live' }, 't1'); store.showAgent('pay', { kind: 'live' }, 't2'); });
  await tick();
  focusAgentView(store, 'pay');
  expect(surfaceOf(agentTabId('pay'))!.focuses).toBe(1);
  expect(surfaceOf(agentTabId('nova'))!.focuses).toBe(0);
  unmount();
  render(<TwoTabs session={nova} />);
  act(() => { store.showAgent('nova', { kind: 'live' }, 't2'); });
  await tick();
  // Neither tab in a dockview group here: the one that holds the screen takes the keyboard.
  focusAgentView(store, 'nova');
  expect(surfaceOf(agentTabId('nova'))!.focuses).toBe(1);
});
