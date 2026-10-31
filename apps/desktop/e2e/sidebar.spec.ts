import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects, openAtelier } from './daemon';

/** Same capability the manage spec uses: archive, restore, resume and delete are allowed. */
const CAN = { version: '0.7.0', install: 'npm' as const, systemd: true, archive: true };

// listSessions-like: Otto is live, Bix has finished, both filed under Ledge. hideDone (the default) keeps Bix behind « +1 finished ».
const otto = session('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const bix = session('bix', { name: 'Bix', cwd: '/w/ledge', state: 'exited', topic: 'Reread the pull request' });

test('open Otto from the tree, show Bix from +N finished and archive him, reread him in Archives', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto, bix], { projects: twoProjects, daemon: CAN });
  await page.goto('/'); await openAtelier(page);
  await expect(page.getByRole('tree', { name: /Projects, branches and sessions/ })).toBeVisible();
  await page.getByRole('tree').getByRole('button', { name: /^Otto/ }).click();
  await expect(page.getByRole('banner').getByText('Otto')).toBeVisible();
  await page.getByRole('button', { name: /\+1 finished/ }).click();
  // The row's archive icon only shows on hover; E on the focused row is the same action.
  await page.getByRole('tree').getByRole('button', { name: /^Bix/ }).focus();
  await page.keyboard.press('e');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.archive')).toEqual([{ type: 'session.archive', id: 'bix' }]);
  // The fake daemon records the message; the fleet only files Bix once it broadcasts archivedAt, as manage.spec does.
  daemon.upsert({ ...bix, archivedAt: new Date().toISOString() });
  await page.getByRole('button', { name: /Archives/ }).click();
  await page.getByRole('button', { name: /Reread Bix/ }).click();
  // The toast region is always a status (« Bix is archived. »). The banner is the one that names the archived session.
  await expect(page.getByRole('status').filter({ hasText: /Archived session/ })).toContainText(/Archived session/);
});

// `ledge ask`: a session's decision lands in « Your turn » with its question and options; answering sends ask.answer, and the card leaves.
test('an ask from the fake daemon shows in Your turn and is answered', async ({ page }) => {
  const at = new Date().toISOString();
  const daemon = await fakeDaemon(page, [otto], { projects: twoProjects, asks: [{ id: 'a1b2c34', from: 'otto', fromName: 'Otto', question: 'Which database?', options: 'A or B (I recommend B)', at, state: 'open' }] });
  await page.goto('/'); await openAtelier(page);
  const yours = page.getByRole('region', { name: 'Your turn' });
  const card = yours.locator('[data-ask="a1b2c34"]');
  await expect(card).toContainText('Decision');
  await expect(card).toContainText('from Otto');
  await expect(card).toContainText('Which database?');
  await expect(card).toContainText('A or B (I recommend B)');
  // « Your turn » counts it (Ledge's line counts what Ledge raised, OpenRig spec §8.1).
  await expect(yours.locator('.st-badge')).toHaveText('1');
  await expect(card.getByRole('button', { name: 'Answer' })).toBeDisabled();
  await card.getByPlaceholder('Your answer…').fill('B');
  await card.getByRole('button', { name: 'Answer' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'ask.answer')).toEqual([{ type: 'ask.answer', rid: expect.any(String), id: 'a1b2c34', text: 'B' }]);
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your turn' })).toHaveCount(0);
});
