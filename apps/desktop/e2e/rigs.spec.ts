import type { Escalation, OpenRigStatus, Rig, RigSeat, SessionRig } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects, openAtelier } from './daemon';

const AT = new Date(Date.now() - 4 * 60_000).toISOString();
const rigOf = (seat: string): SessionRig => ({ machine: 'local', rigId: 'r-factory', rigName: 'factory', seat: `${seat}@factory`, pod: 'dev', member: seat });
const seat = (name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });

// Otto works alone on Ledge; build and orch-lead are factory's seats, paired with their Ledge sessions (raw ids: the fleet qualifies them).
const otto = session('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const buildSeat = session('build', { name: 'build', cwd: '/w/ledge', state: 'working', topic: 'Resume after reboot', rig: rigOf('build') });
const orchLead = session('orch-lead', { name: 'orch-lead', cwd: '/w/ledge', state: 'idle', topic: 'Lead the rig', rig: rigOf('orch-lead') });
const FACTORY: Rig = { id: 'r-factory', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('build', { sessionId: 'build' }), seat('orch-lead', { sessionId: 'orch-lead', state: 'idle' })] };
const KERNEL: Rig = { id: 'r-kernel', name: 'openrig-kernel', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: true, repos: [],
  seats: [seat('operator', { ref: 'operator@kernel' }), seat('queue', { ref: 'queue@kernel', state: 'idle' }), seat('advisor-lead', { ref: 'advisor-lead@kernel', state: 'idle' })] };
const ESC: Escalation = { id: 'q1', source: 'rig', machine: 'local', rigId: 'r-factory', from: 'orch-lead@factory', intent: 'decision', summary: 'JSON or SQLite?', questions: [], createdAt: AT, state: 'pending' };
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.3.0' };

test('sidebar: Ledge line, standalone projects, rigs and kernel', async ({ page }) => {
  await fakeDaemon(page, [otto, buildSeat, orchLead], { projects: twoProjects, rigs: [FACTORY, KERNEL], escalations: [ESC], openrig: RUNNING });
  await page.goto('/'); await openAtelier(page);
  await expect(page.getByRole('button', { name: /Ledge\..*A decision is waiting for you · factory/ })).toBeVisible();
  await expect(page.getByRole('tree').getByRole('button', { name: /^build/ })).toHaveCount(1); // under Rigs, not under Projects
  await expect(page.locator('section[aria-label="Projects"]').getByText('build')).toHaveCount(0);
  await expect(page.locator('section[aria-label="Projects"]').getByRole('button', { name: /^Otto/ })).toBeVisible();
  const rigs = page.locator('section[aria-label="Rigs"]');
  await expect(rigs.getByRole('treeitem', { name: /factory/ })).toContainText('rig · 2');
  await expect(rigs.getByRole('treeitem', { name: /OpenRig kernel/ })).toContainText('kernel');
  await page.keyboard.press('/');
  await expect(page.locator('section.ledge-home')).toBeVisible();
  await page.getByRole('button', { name: 'Launch a rig' }).click();
  await expect(page.getByRole('dialog', { name: 'New rig' })).toBeVisible();
  await page.getByRole('dialog', { name: 'New rig' }).getByRole('button', { name: 'Close' }).last().click(); // the title bar's × is « Close » too
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a rig pushed then removed by the daemon comes and goes; its seat returns to Projects', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto, buildSeat], { projects: twoProjects, rigs: [], openrig: RUNNING });
  await page.goto('/'); await openAtelier(page);
  const projects = page.locator('section[aria-label="Projects"]');
  await expect(projects.getByRole('button', { name: /^build/ })).toBeVisible();
  daemon.pushRig({ ...FACTORY, seats: [seat('build', { sessionId: 'build' })] });
  await expect(page.locator('section[aria-label="Rigs"]').getByRole('button', { name: /^build/ })).toBeVisible();
  await expect(projects.getByRole('button', { name: /^build/ })).toHaveCount(0);
  daemon.removeRig('local', 'r-factory');
  await expect(page.locator('section[aria-label="Rigs"]').getByRole('treeitem', { name: /factory/ })).toHaveCount(0);
  await expect(projects.getByRole('button', { name: /^build/ })).toBeVisible();
});

test('without OpenRig the Rigs section invites to install it', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, openrig: { machine: 'local', state: 'absent', install: 'npm i -g @openrig/cli' } });
  await page.goto('/'); await openAtelier(page);
  const rigs = page.locator('section[aria-label="Rigs"]');
  await expect(rigs).toContainText('OpenRig is not installed');
  await expect(rigs).toContainText('npm i -g @openrig/cli');
  await expect(rigs.getByRole('button', { name: 'Launch a rig' })).toBeVisible();
  // The sidebar never acts on a rig by itself.
  expect(daemon.received.some(m => m.type === 'rig.act')).toBe(false);
});

test('in the rail (< 850 px) seats and the kernel hide; a rig keeps its swatch, as a project does', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 760 });
  await fakeDaemon(page, [otto, buildSeat, orchLead], { projects: twoProjects, rigs: [FACTORY, KERNEL], openrig: RUNNING });
  await page.goto('/');
  const rigs = page.locator('section[aria-label="Rigs"]');
  // The rail hides the row's name (as a project's), so the row is found by its class.
  await expect(rigs.locator('.st-rig .side-swatch')).toBeVisible();
  await expect(rigs.locator('.st-rig .st-main')).toBeHidden();
  await expect(rigs.getByRole('button', { name: /^build/ })).toBeHidden();
  await expect(rigs.locator('.st-kernel')).toBeHidden();
});

test('atelier: a double-click on factory shows its room alone; an exchange bubbles on its table; removed, the atelier comes back whole', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // design is a placeholder seat (no Ledge session): drawn, inert.
  const factory: Rig = { ...FACTORY, seats: [...FACTORY.seats, seat('design', { state: 'ready' })] };
  const daemon = await fakeDaemon(page, [otto, buildSeat, orchLead], { projects: twoProjects, rigs: [factory, KERNEL], openrig: RUNNING });
  await page.goto('/'); await openAtelier(page);
  const atelier = page.locator('.office-shell');
  await expect(atelier.locator('[data-room="local/r-factory"]')).toBeVisible();
  await expect(atelier.locator('[data-room="local/r-factory"] .room-plaque')).toContainText('rig · 3 seats');
  await page.locator('section[aria-label="Rigs"]').getByRole('button', { name: 'factory rig · 3' }).dblclick();
  await expect(page.locator('.project-filter[data-filter="rig"]')).toContainText('factory');
  await expect(atelier.locator('[data-room]')).toHaveCount(1);
  const room = atelier.locator('[data-room="local/r-factory"]');
  // The placeholder: no session page, no menu.
  const ghost = room.locator('.agent-seat.seat-ghost');
  await expect(ghost).toContainText('design');
  await expect(ghost).not.toHaveAttribute('data-agent');
  await expect(room.getByRole('button', { name: /design/ })).toHaveCount(0);
  daemon.exchange({ id: 'x1', machine: 'local', rigId: 'r-factory', from: 'build@factory', to: '@orch-lead', kind: 'message', text: 'Candidat prêt', at: new Date().toISOString() });
  const bubble = atelier.locator('.exchange-bubble', { hasText: 'Candidat prêt' });
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('to orch-lead');
  await expect(bubble).toHaveCount(0, { timeout: 8000 });
  daemon.removeRig('local', 'r-factory');
  await expect(atelier.locator('[data-room="local/r-factory"]')).toHaveCount(0);
  await expect(page.locator('.project-filter[data-filter="rig"]')).toHaveCount(0);
  await expect(atelier.locator('[data-room]').first()).toBeVisible();
  expect(errors).toEqual([]);
});
