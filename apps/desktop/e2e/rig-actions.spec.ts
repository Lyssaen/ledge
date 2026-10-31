import type { OpenRigStatus, Rig, RigSeat, SessionRig } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

const seat = (rig: string, name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@${rig}`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const rigOf = (name: string): SessionRig => ({ machine: 'local', rigId: 'r-starter', rigName: 'starter', seat: `${name}@starter`, pod: 'dev', member: name });
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
// factory launches: orch-lead is ready, design waits for the user's trust in its folder; the goal is not given yet.
const FACTORY: Rig = { id: 'r-factory', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'launching', kernel: false, repos: [],
  seats: [seat('factory', 'orch-lead', { address: '@lead', state: 'ready' }), seat('factory', 'design', { state: 'trust' })],
  launch: { planId: 'p1', goal: 'Resume rigs after a reboot', lead: 'orch-lead@factory', startedAt: new Date().toISOString() } };
// starter runs; its dev-build seat is paired with a Ledge session.
const devBuild = session('dev-build', { name: 'dev-build', cwd: '/w/ledge', state: 'working', topic: 'Fix the notch', source: 'hook_only', rig: rigOf('dev-build') });
const STARTER: Rig = { id: 'r-starter', name: 'starter', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('starter', 'dev-build', { sessionId: 'dev-build' }), seat('starter', 'dev-review', { state: 'ready' })] };

test('a launching rig, then a running one: cancel the launch, stop only one seat, never a session.kill', async ({ page }) => {
  const daemon = await fakeDaemon(page, [devBuild], { projects: twoProjects, rigs: [FACTORY, STARTER], openrig: RUNNING });
  await page.goto('/');
  const home = page.locator('section.ledge-home');
  await home.getByRole('tab', { name: 'Rigs · 2' }).click();

  const factory = home.getByRole('article', { name: 'factory' });
  await expect(factory).toContainText('rig · starting');
  await expect(factory).toContainText('1/2 ready');
  await expect(factory).toContainText('The goal waits: I give it to orch-lead as soon as the 2 seats are ready.');
  await expect(factory).toContainText('design waits for you to trust the folder, I don’t answer in its place.');
  await expect(factory.locator('[data-seat="design@factory"]').getByRole('button', { name: 'Open the prompt' })).toBeVisible();
  await factory.getByRole('button', { name: 'Cancel the launch' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.act')).toEqual([expect.objectContaining({ verb: 'down', rigId: 'r-factory', machine: 'local' })]);

  const starter = home.getByRole('article', { name: 'starter' });
  await starter.locator('[data-seat="dev-build@starter"]').getByRole('button', { name: 'Actions of dev-build' }).click();
  await page.getByRole('menuitem', { name: 'Stop…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Stop starter?' });
  await expect(dialog).toContainText('Its 2 seats stop. OpenRig keeps a snapshot to resume it. The files stay.');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Only this seat' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.act').length).toBe(2);
  expect(daemon.received.filter(m => m.type === 'rig.act')[1]).toMatchObject({ verb: 'stop', rigId: 'r-starter', seatRef: 'dev-build@starter', machine: 'local' });

  // The paired session's own menu (its page's « … »): the rig's gestures, never End, Archive or Delete.
  await page.getByRole('tree').getByRole('button', { name: /^dev-build/ }).click();
  await page.getByRole('banner').getByRole('button', { name: /dev-build/ }).last().click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Restart this seat' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'End' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Archive/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Hand over' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.act').length).toBe(3);
  expect(daemon.received.filter(m => m.type === 'rig.act')[2]).toMatchObject({ verb: 'handover', seatRef: 'dev-build@starter' });

  expect(daemon.received.filter(m => m.type === 'session.kill' || m.type === 'session.close' || m.type === 'session.archive' || m.type === 'session.delete')).toEqual([]);
});
