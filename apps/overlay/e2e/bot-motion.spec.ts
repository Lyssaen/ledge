import { test, expect, layer, ready, expectMode } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList, restInside, perm } from './scenarios';

// Exercise the shipped SVG/CSS in the real overlay, including the cascade and SVG transforms.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ledge.reducedMotion', 'false'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('tool signatures share the hop phase, entry signatures follow anticipation, theme and names preserve layers', async ({ page }) => {
  const bots = [session('a', { tool: 'claude' }), session('b', { tool: 'codex', name: 'Nova' }), session('c', { tool: 'cursor', name: 'Pim' })];
  const daemon = await fakeDaemon(page, bots);
  await ready(page, 3);
  await openList(page);
  await restInside(page);
  const list = layer(page, 'list');
  const actual = list.locator('.bot');
  await expect(actual).toHaveCount(3);
  const phases = await actual.evaluateAll(els => els.map(el => {
    const hop = getComputedStyle(el.querySelector('.hop')!);
    const signature = getComputedStyle(el.querySelector('.signature')!);
    return [hop.animationDuration, hop.animationDelay, signature.animationDuration, signature.animationDelay];
  }));
  phases.forEach(([duration, phase, signatureDuration, signaturePhase]) => {
    expect(signatureDuration).toBe(duration);
    expect(signaturePhase).toBe(phase);
  });
  expect(new Set(phases.map(p => p[1])).size).toBeGreaterThan(1);
  await actual.evaluateAll(els => els.forEach(el => (el as unknown as { originalShell: Element }).originalShell = el.querySelector('.shell')!));
  await page.screenshot({ path: '/tmp/ledge-bot-motion-dark.png' });
  daemon.upsert({ ...bots[0]!, name: 'Renamed' });
  await page.keyboard.press('Control+Alt+t');
  await expect(actual.first()).toHaveAttribute('data-material', 'pebble');
  expect(await actual.evaluateAll(els => els.every(el => (el as unknown as { originalShell: Element }).originalShell === el.querySelector('.shell')))).toBe(true);
  expect(await actual.evaluateAll(els => els.map(el => [getComputedStyle(el.querySelector('.hop')!).animationDuration, getComputedStyle(el.querySelector('.hop')!).animationDelay]))).toEqual(phases.map(p => p.slice(0, 2)));
  // Make all bots idle, then start them: capture the entry animations before their 480 ms cleanup.
  bots.forEach(b => daemon.upsert({ ...b, state: 'idle' }));
  await expect(actual.first()).toHaveAttribute('data-state', 'idle');
  bots.forEach(b => daemon.upsert({ ...b, state: 'working' }));
  await expect(actual.first()).toHaveAttribute('data-transition', 'working');
  const entries = await actual.evaluateAll(els => els.map(el => {
    const signature = getComputedStyle(el.querySelector('.signature')!);
    const antenna = getComputedStyle(el.querySelector('.antenna-group')!);
    return [signature.animationName, signature.animationDuration, signature.animationDelay, antenna.animationName];
  }));
  entries.forEach(e => expect(e).toEqual(['bot-entry-signature', '0.48s', '0s', 'bot-entry-antenna']));
  // Freeze the CSS entry at landing for Claude, at the summit for Codex/Cursor.
  const angles = await actual.evaluateAll(els => els.map(el => {
    const signature = el.querySelector('.signature')!;
    signature.getAnimations().forEach(a => { a.pause(); a.currentTime = el.getAttribute('data-tool') === 'claude' ? 336 : 211.2; });
    const matrix = new DOMMatrix(getComputedStyle(signature).transform);
    return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  }));
  angles.forEach((a, i) => expect(a).toBeCloseTo([5, 5, 7][i]!, 0));
  await page.screenshot({ path: '/tmp/ledge-bot-motion-list.png' });
});

test('small waiting bots are still; OS reduced motion stops full bots and selection still works', async ({ page }) => {
  await fakeDaemon(page, [session('a', { ...perm, helpers: [{ id: 'h1', kind: 'review', task: 'Review changes', state: 'waiting_permission' }] })]);
  await ready(page, 1);
  await openList(page);
  await restInside(page);
  await layer(page, 'list').locator('.bot').click();
  await expectMode(page, 'session');
  const small = layer(page, 'session').locator('.bot[data-simplified="true"]');
  await expect(small).toHaveAttribute('width', '20');
  await expect(small).toHaveAttribute('data-detailed', 'false');
  await expect(small).toHaveCSS('animation-name', 'none');
  await expect(small.locator('.signature')).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await expectMode(page, 'list');
  const bot = layer(page, 'list').locator('.bot');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(bot).toHaveAttribute('data-reduced', 'true');
  await expect(bot.locator('.body')).toHaveCSS('animation-name', 'none');
  await bot.click();
  await expectMode(page, 'session');
});

test('question leads with the head, done closes in two stages, error settles and the halo hides the shadow', async ({ page }) => {
  const daemon = await fakeDaemon(page, [session('a')]);
  await ready(page, 1);
  await openList(page);
  const bot = layer(page, 'list').locator('.bot');
  await expect(bot.locator('.ground')).toHaveCSS('opacity', '0');
  expect(await bot.locator('.ground').evaluate(el => el.getAnimations().length)).toBe(0);
  daemon.upsert(session('a', { state: 'waiting_input' }));
  await expect(bot).toHaveAttribute('data-transition', 'question');
  const early = await bot.evaluate(el => {
    for (const target of ['.arrival', '.gaze']) el.querySelector(target)!.getAnimations().forEach(a => { a.pause(); a.currentTime = 100; });
    return [getComputedStyle(el.querySelector('.arrival')!).transform, getComputedStyle(el.querySelector('.gaze')!).transform];
  });
  expect(early[0]).not.toBe(early[1]);
  expect(early[1]).toBe('matrix(1, 0, 0, 1, 0, 0)');
  daemon.upsert(session('a', { state: 'exited', exitCode: 0 }));
  await expect(bot).toHaveAttribute('data-transition', 'done');
  const closed = await bot.evaluate(el => {
    const sample = (time: number) => {
      ['.eye-blink', '.eye-open', '.eye-sleep'].forEach(target => el.querySelector(target)!.getAnimations().forEach(a => { a.pause(); a.currentTime = time; }));
      return [Number(getComputedStyle(el.querySelector('.eye-open')!).opacity), Number(getComputedStyle(el.querySelector('.eye-sleep')!).opacity), new DOMMatrix(getComputedStyle(el.querySelector('.eye-blink')!).transform).d];
    };
    return [sample(125), sample(350)];
  });
  expect(closed[0]![0]).toBe(1);
  expect(closed[0]![1]).toBe(0);
  expect(closed[0]![2]).toBeCloseTo(.5);
  expect(closed[1]![0]).toBe(0);
  expect(closed[1]![1]).toBe(1);
  expect(closed[1]![2]).toBeCloseTo(.12);
  daemon.upsert(session('a', { state: 'error' }));
  await expect(bot).toHaveAttribute('data-transition', 'error');
  await expect(bot.locator('.arrival')).toHaveCSS('animation-name', 'bot-recoil');
  await expect(bot).not.toHaveAttribute('data-transition', 'error');
  await expect(bot.locator('.body')).toHaveCSS('animation-name', 'none');
  await expect(bot).not.toHaveAttribute('data-blink');
});
