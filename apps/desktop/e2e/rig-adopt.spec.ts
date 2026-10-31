import type { OpenRigStatus, Rig, RigRepo } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';

const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
const repo = (name: string, extra: Partial<RigRepo> = {}): RigRepo => ({ path: `/home/u/.ledge/rigs/factory/${name}`, name, modified: 0, ...extra });
// factory works in a space off any project and found three repositories; only ledge has changes.
const FACTORY: Rig = { id: 'r-factory', name: 'factory', machine: 'local', cwd: '/home/u/.ledge/rigs/factory', projectId: null, offProject: true, lifecycle: 'running', kernel: false,
  seats: [{ ref: 'build@factory', address: '@build', name: 'build', runtime: 'claude-code', state: 'working' }],
  repos: [repo('ledge', { branch: 'feat/rigs', how: 'cloned', by: 'build', modified: 9, remote: 'git@x:ledge.git' }), repo('notes', { how: 'opened', by: 'advisor' }), repo('sketch', { how: 'created', by: 'design' })] };

test('an off-project rig: Ledge proposes the project, « File in Ledge » files it', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, rigs: [FACTORY], openrig: RUNNING });
  await page.goto('/');
  const home = page.locator('section.ledge-home');
  await home.getByRole('tab', { name: 'Rigs · 1' }).click();
  const card = home.getByRole('article', { name: 'factory' });
  await expect(card).toContainText('off project');
  await expect(card).toContainText('Repositories found · 3');
  await expect(card).toContainText('ledge ⎇ feat/rigs · cloned by build · 9 modified files');
  await expect(card).toContainText('sketch · created by design · no remote repository yet');
  await expect(card).toContainText('I suggest filing factory in Ledge: it is the only modified repository. I move nothing without you.');

  await card.getByRole('button', { name: 'File in Ledge' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.adopt')).toEqual([expect.objectContaining({ rigId: 'r-factory', projectId: 'ledge', machine: 'local' })]);
  await expect(card).toContainText('in Ledge');
  await expect(card).not.toContainText('off project');
  await expect(card).not.toContainText('I suggest filing');
  await expect(page.locator('section[aria-label="Rigs"]').getByRole('treeitem', { name: /factory/ })).not.toContainText('off project');
});

test('« File in a project… » lists the projects with the proposed one selected', async ({ page }) => {
  const daemon = await fakeDaemon(page, [], { projects: twoProjects, rigs: [FACTORY], openrig: RUNNING });
  await page.goto('/');
  const home = page.locator('section.ledge-home');
  await home.getByRole('tab', { name: 'Rigs · 1' }).click();
  await home.getByRole('article', { name: 'factory' }).getByRole('button', { name: 'File in a project…' }).click();
  const dialog = page.getByRole('dialog', { name: 'File factory in a project' });
  await expect(dialog.getByRole('radio', { name: 'Ledge' })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Website' }).check();
  await expect(dialog).toContainText('its plaque will say “in Website”');
  await dialog.getByRole('button', { name: 'File', exact: true }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'rig.adopt')).toEqual([expect.objectContaining({ projectId: 'website' })]);
  await expect(dialog).toHaveCount(0);
  await expect(home.getByRole('article', { name: 'factory' })).toContainText('in Website');
});
