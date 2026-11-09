import type { SlashCommand } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { ideReady } from './ide';
import { fleet } from './thread';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

const COMMANDS: SlashCommand[] = [
  { name: 'code-review', aliases: ['review'], source: 'builtin', argumentHint: '[low|medium|high|xhigh|max] [--fix] [<pr#>]', description: 'Review the current diff, or a PR number/branch/path target, for correctness bugs' },
  { name: 'review-pr', source: 'project', argumentHint: '<pr#>', description: 'Review a GitHub PR against our checklist' },
  { name: 'security-review', source: 'builtin', description: 'Complete a security review of the pending changes on the current branch' },
  { name: 'compact', source: 'builtin', argumentHint: '<optional custom summarization instructions>', description: 'Free up context by summarizing the conversation so far' },
  { name: 'usage', aliases: ['cost', 'stats'], source: 'builtin', description: 'Show session cost, plan usage', blocked: 'panel' }
];

test('« / » in the reply lists the agent\'s commands, filters them, completes one and sends it', async ({ page }) => {
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, commands: COMMANDS });
  await page.goto('/'); await ideReady(page);
  await page.getByRole('tree').getByRole('button', { name: /^Nova/ }).click();
  const field = page.getByRole('textbox', { name: 'Reply to the agent' });
  await field.click(); await field.pressSequentially('/rev');
  const list = page.getByRole('listbox', { name: 'Claude Code commands' });
  await expect(list.getByRole('option')).toHaveCount(3);
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  if (process.env.LEDGE_SHOT) await page.screenshot({ path: `${process.env.LEDGE_SHOT}-list.png` });
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('/code-review ');
  await expect(page.locator('.slash-ghost')).toBeVisible();
  if (process.env.LEDGE_SHOT) await page.locator('.session-reply').screenshot({ path: `${process.env.LEDGE_SHOT}-done.png` });
  await field.pressSequentially('high');
  await page.keyboard.press('Enter');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.reply')).toEqual([{ type: 'session.reply', id: 'nova', text: '/code-review high' }]);
});
