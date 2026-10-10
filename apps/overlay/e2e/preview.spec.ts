import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon } from './daemon';
import { overview, openList, restInside } from './scenarios';

/* The terminal preview ("Aperçu du terminal") shows what the daemon sends: the agent's recent conversation,
   scrolled to its latest line. French, as the user runs it. */
test.use({ lang: 'fr', viewport: { width: 1600, height: 1000 } });

/** What the daemon sends for a Claude Code pane: the conversation, without the input box (packages/ledge buildPreview). */
const conversation = [
  '❯ Lance les tests du overlay et corrige ce qui casse.',
  '',
  '● Bash(pnpm --filter overlay test)',
  '  ⎿  Test Files  19 passed (19)',
  '        Tests  229 passed (229)',
  '',
  ...Array.from({ length: 18 }, (_, i) => `● Étape ${i + 1} : vérification du composant SessionView et de son aperçu, ligne assez longue pour revenir à la ligne dans la colonne étroite du panneau.`),
  '',
  '● Tous les tests passent. Il reste à lancer pnpm test --filter overlay en e2e.',
  '',
  '✻ Brewed for 42s · done 1:12 PM'
];

test('the conversation preview opens on its latest line and follows updates', async ({ page }) => {
  const d = await fakeDaemon(page, overview());
  await ready(page, 4);
  // Sent right after the snapshot, as the daemon does for a client that connects late.
  d.preview('otto', conversation);
  await openList(page);
  await layer(page, 'list').getByRole('button', { name: 'harness-assistant, Otto, ouvrir' }).click();
  await expectMode(page, 'session');
  await restInside(page);

  const view = layer(page, 'session');
  // A pending request keeps the preview folded: expand it.
  const summary = view.getByText('Aperçu du terminal');
  await summary.click();
  const pre = view.locator('pre[data-terminal]');
  await expect(pre).toBeVisible();
  await expect(pre).toContainText('● Bash(pnpm --filter overlay test)');
  expect(await pre.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  expect(await pre.evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('thin');
  expect(await pre.evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
  // It overflows, and it sits on its last line: the latest agent text is in view.
  expect(await pre.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  const last = pre.getByText('✻ Brewed for 42s · done 1:12 PM');
  await expect(last).toBeInViewport();
  await expect.poll(() => pre.evaluate(el => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight))).toBeLessThanOrEqual(1);
  await expect(pre.getByText('● Tous les tests passent.', { exact: false })).toBeInViewport();

  // An update keeps it on the latest line.
  d.preview('otto', [...conversation, '', '● Nouvelle réponse de l’agent après la mise à jour.']);
  await expect(pre.getByText('● Nouvelle réponse de l’agent après la mise à jour.')).toBeInViewport();
});
