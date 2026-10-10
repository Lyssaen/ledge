import type { Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { session } from './daemon';
import { expectMode, surface } from './fixtures';

/** The mockup's scenarios as daemon data (only what the protocol carries). */
export const perm = { state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text: 'pnpm test --filter overlay', source: 'hook' as const } };
export const ques = { state: 'waiting_input' as const, pending: { kind: 'question' as const, text: 'Quel thème utiliser par défaut ?', options: ['Sombre · Signal', 'Clair · Galet', 'Suivre le système'], source: 'pane' as const } };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
export const overview = (): Session[] => [
  session('otto', { name: 'Otto', project: 'harness-assistant', startedAt: ago(18), ...perm }),
  session('nova', { name: 'Nova', tool: 'codex', project: 'design-system', startedAt: ago(12), ...ques }),
  session('pim', { name: 'Pim', tool: 'cursor', project: 'landing-page', startedAt: ago(8) }),
  session('bix', { name: 'Bix', project: 'documentation', startedAt: ago(2), state: 'idle' })
];
export const team = (): Session[] => ['Otto', 'Nova', 'Pim', 'Bix', 'Lu', 'Milo', 'Ada', 'Nox', 'Pip', 'Sol', 'Mina', 'Tao'].map((name, i) =>
  session(`t${i}`, { name, tool: (['claude', 'codex', 'cursor'] as const)[i % 3], project: ['harness-assistant', 'design-system', 'landing-page'][i % 3]!, startedAt: ago(12 - i), ...(i === 1 || i === 7 || i === 10 ? perm : i % 3 === 0 ? { state: 'idle' as const } : {}) }));

/** Opens the list with the real mouse on the edge band above the handle, then rests the pointer inside the surface. */
export async function openList(page: Page) {
  await page.mouse.move(200, 60);
  await page.mouse.move(3, 60, { steps: 3 });
  await expectMode(page, 'list');
  await restInside(page);
}
export async function restInside(page: Page) {
  const b = (await surface(page).boundingBox())!;
  await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2);
}
