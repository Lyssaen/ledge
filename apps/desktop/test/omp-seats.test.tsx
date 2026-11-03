import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { RigGroups } from '../src/shell/sidebar/RigGroups';
import type { SidebarOpenRig } from '../src/openrig/sidebarState';
import { terminalShown } from '../src/session/prefs';
import { boot, closeDaemons } from './helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

/** docs/mockups/ledge-openrig-omp.html: OMP seats of OpenRig under their rig, their page on their terminal, a stopped one greyed. */
const omp = (id: string, name: string, rig: string, role: string, extra: Partial<Session> = {}): Session =>
  fakeSession(id, { name, tool: 'omp', cwd: `/w/${rig}`, project: rig, title: `${name} · ${role}`, state: 'idle', source: 'rig', tmuxSession: `${role.replace('.', '-')}@${rig}`,
    rig: { seat: `${role.replace('.', '-')}@${rig}`, name: rig, role }, ...extra });
const IVO = omp('rig-ivo', 'Ivo', 'dev-omp', 'dev.agent', { state: 'working' });
const PIA = omp('rig-pia', 'Pia', 'dev-omp', 'review.reviewer');
const TOM = omp('rig-tom', 'Tom', 'split-omp', 'split.splitter', { state: 'exited', exitedAt: '2026-11-03T09:00:00.000Z' });
const ANA = omp('rig-ana', 'Ana', 'split-omp', 'analysis.analyst');
const LU = fakeSession('rig-lu', { name: 'Lu', cwd: '/w/ledge', state: 'exited', source: 'rig', rig: { seat: 'pilot-lead@ledge-dev', name: 'ledge-dev', role: 'pilot.lead' } });

const openrig = (): SidebarOpenRig => ({ installed: true, daemonUp: true, kernelState: () => 'ready', labelOf: m => m, canStart: true, installedOn: null, starting: false, failed: null, start: vi.fn() });
function mount(sessions: readonly Session[], lang: 'fr' | 'en' = 'fr') {
  render(<LangProvider lang={lang}><aside className="st"><RigGroups sessions={sessions} current={null} paused dispatch={vi.fn()} openrig={openrig()} dense={false} onToggleDense={vi.fn()} /></aside></LangProvider>);
}
const rowOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('[role="treeitem"]') as HTMLElement;

describe('OMP seats in the sidebar', () => {
  it('a running OMP seat is a seat row like the others: its mascot, its name, « rôle · omp », counted while it works', () => {
    mount([IVO, PIA]);
    expect(rowOf('Ivo')).toHaveTextContent('dev · omp');
    expect(rowOf('Pia')).toHaveTextContent('review.reviewer · omp');
    expect(rowOf('Ivo').querySelector('.bot')).toHaveAttribute('data-tool', 'omp');
    expect(rowOf('Ivo')).not.toHaveClass('off');
    const head = screen.getByRole('button', { name: /^dev-omp/ }).closest('[role="treeitem"]')!;
    expect(head.querySelector('.t-work')).toHaveTextContent('1');
  });

  it('a stopped OMP seat stays under its rig, greyed « arrêté », its mascot frozen, out of the rig’s count', () => {
    mount([ANA, TOM, { ...ANA, id: 'rig-sol', name: 'Sol', state: 'working', rig: { ...ANA.rig!, seat: 'review-reviewer@split-omp', role: 'review.reviewer' } }]);
    const tom = rowOf('Tom');
    expect(tom).toHaveClass('off');
    expect(tom.querySelector('.st-time')).toHaveTextContent('arrêté');
    expect(tom.querySelector('.bot')).toHaveAttribute('data-frozen', 'true');
    expect(tom.querySelector('.bot')).toHaveAttribute('data-state', 'done');
    const head = screen.getByRole('button', { name: /^split-omp/ }).closest('[role="treeitem"]')!;
    expect(head.querySelector('.t-work')).toHaveTextContent('1');
    cleanup();
    mount([ANA, TOM], 'en');
    expect(rowOf('Tom').querySelector('.st-time')).toHaveTextContent('stopped');
  });

  it('a stopped Claude seat still leaves the list, and so does an archived OMP seat', () => {
    mount([ANA, LU, { ...TOM, archivedAt: '2026-11-03T09:30:00.000Z' }]);
    expect(screen.queryByRole('button', { name: /^Lu/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Tom/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^ledge-dev/ })).toBeNull();
  });
});

describe('whether the terminal shows beside a session', () => {
  it('the preference, for any session but an OMP seat of OpenRig', () => {
    const claude = fakeSession('a');
    expect(terminalShown(claude, false, null)).toBe(false);
    expect(terminalShown(claude, true, null)).toBe(true);
    expect(terminalShown(null, true, null)).toBe(true);
    // An OMP session Ledge launched itself (omp-rpc) is not a seat.
    expect(terminalShown({ ...IVO, source: 'launcher', backend: 'omp-rpc' }, false, null)).toBe(false);
  });

  it('a running OMP seat opens on its terminal until it is closed on it; a stopped one has none', () => {
    expect(terminalShown(IVO, false, null)).toBe(true);
    expect(terminalShown(IVO, false, 'rig-ivo')).toBe(false);
    expect(terminalShown(IVO, true, 'rig-ivo')).toBe(true);
    expect(terminalShown(IVO, false, 'rig-pia')).toBe(true);
    expect(terminalShown(TOM, true, null)).toBe(false);
    expect(terminalShown({ ...PIA, archivedAt: '2026-11-03T09:30:00.000Z' }, true, null)).toBe(false);
  });
});

describe('an OMP seat’s page', () => {
  it('running: no thread nor reply, a line that says why, and its terminal open beside it; closed, it stays closed on it', async () => {
    const { d, side, user } = await boot({ sessions: [IVO, PIA], projects: { projects: [] } as never });
    d.preview('rig-ivo', ['you > Story ST7-412']);
    await user.click(side.getByRole('button', { name: /^Ivo/ }));
    await waitFor(() => expect(document.querySelector('.seat-note')).toHaveTextContent('No thread for this seat. Ledge does not read the conversation of an OMP seat launched by OpenRig. Its terminal is open alongside: what you type there is sent to it.'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('tablist', { name: /Thread|Fil/ })).toBeNull();
    expect(screen.getByRole('banner').querySelector('.crumb-task')).toHaveTextContent(/^dev\.agent$/);
    expect(screen.getByRole('banner').querySelector('[data-badge]')).toHaveAttribute('data-badge', 'working');
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    // The test build has no PTY: the pane shows the seat's screen as the daemon last read it.
    expect(await term.findByText('you > Story ST7-412')).toBeVisible();
    expect(screen.getByRole('banner').querySelector('[aria-pressed="true"]')).not.toBeNull();
    await user.click(term.getByRole('button', { name: 'Hide the terminal' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull());
    await user.click(side.getByRole('button', { name: /^Pia/ }));
    expect(await screen.findByRole('region', { name: 'Terminal' })).toBeVisible();
    await user.click(side.getByRole('button', { name: /^Ivo/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull());
  });

  it('stopped: no terminal, a line that says it is gone, and the OpenRig page one click away', async () => {
    const { side, user } = await boot({ sessions: [ANA, TOM], projects: { projects: [] } as never });
    await user.click(side.getByRole('button', { name: /^Tom/ }));
    await waitFor(() => expect(document.querySelector('.seat-note')).toHaveTextContent('Seat stopped. Its terminal is gone: the OpenRig page shows its rig.'));
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    await user.keyboard('o');
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    // The top bar: « Stopped », the seat's role after its name, the terminal toggle in its place but disabled.
    const banner = within(screen.getByRole('banner'));
    expect(screen.getByRole('banner').querySelector('[data-badge]')).toHaveTextContent('Stopped');
    expect(screen.getByRole('banner').querySelector('.crumb-task')).toHaveTextContent(/^split\.splitter$/);
    const toggle = banner.getByRole('button', { name: 'Seat stopped: no terminal' });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await user.click(toggle);
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open the OpenRig page' }));
    await waitFor(() => expect(document.querySelector('.or-page')).not.toBeNull());
    expect(document.querySelector('.seat-note')).toBeNull();
  });
});
