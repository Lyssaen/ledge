import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

const CAN = { version: '0.13.0', install: 'npm' as const, systemd: true, archive: true, models: true, modelSwitch: true };
const efforts = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const codex = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'Latest workhorse model for coding and everyday work.', efforts, defaultEffort: 'medium', isDefault: true },
  { id: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Frontier intelligence for the most demanding work.', efforts, defaultEffort: 'medium' },
  { id: 'gpt-6-luna', label: 'GPT-6-Luna', description: 'Fast and affordable model for easier tasks.', efforts: efforts.slice(0, 5), defaultEffort: 'medium' }
];

test('a live session changes model (#58 lot 2): the chip in the reply bar, the list above it, Schedule while the agent works', async ({ page }) => {
  const iris = session('iris', { name: 'Iris', tool: 'codex', project: 'ledge', cwd: '/w/ledge', state: 'working', model: 'gpt-6.1-sol', effort: 'medium' });
  const daemon = await fakeDaemon(page, [iris], { projects: twoProjects, daemon: CAN, models: { codex } });
  await page.goto('/');
  await page.getByRole('button', { name: /^Iris,/ }).click();
  const chip = page.getByRole('button', { name: /^Model and effort : / });
  await expect(chip).toHaveAccessibleName('Model and effort : GPT-6.1-Sol · Medium');
  await chip.click();
  const menu = page.getByRole('dialog', { name: 'Model and effort' });
  await menu.getByRole('option', { name: /GPT-6-Astra/ }).click();
  await menu.getByRole('button', { name: 'More effort' }).click();
  await page.screenshot({ path: test.info().outputPath('session-model.png') });
  await menu.getByRole('button', { name: 'Schedule' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.model')).toEqual([{ type: 'session.model', id: 'iris', model: 'gpt-6-astra', effort: 'high' }]);
  daemon.upsert({ ...iris, modelNext: { model: 'gpt-6-astra', effort: 'high' } });
  await expect(chip).toHaveAccessibleName('Model and effort : GPT-6-Astra · High (next turn)');
  await page.locator('.session-reply').screenshot({ path: test.info().outputPath('session-model-next.png') });
});
