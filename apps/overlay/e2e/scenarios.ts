import type { Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { session } from './daemon';
import { expectMode, surface } from './fixtures';

/** The mockup's scenarios as daemon data (only what the protocol carries). */
export const perm = { state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text: 'pnpm test --filter overlay', source: 'hook' as const } };
export const ques = { state: 'waiting_input' as const, pending: { kind: 'question' as const, text: 'Quel thème utiliser par défaut ?', options: ['Sombre · Signal', 'Clair · Galet', 'Suivre le système'], source: 'pane' as const } };
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
/** A finished turn, as the Stop hook reports it: the "your turn" view reads it like a plan. */
export const replyText = `## Three reducer findings fixed, transitions covered by a table test

Steps 1 to 6 of the plan are done and green. I stopped before the soak because it needs the daemon running for an hour, and one point about the new \`PaneGone\` event is yours to decide.

### What I did

- Transition table test, 63 cases, all green \`src/daemon/state.test.ts\`
- No double entry into waiting_permission, hook beats pane \`src/daemon/state.ts\`
  - The richer \`pending\` wins; it now carries \`source\` and \`tool\`.
- exited is terminal, pending cleared on SessionEnd and PaneGone \`src/daemon/state.ts\`
- Shared post-injection check for the three adapters \`src/adapters/verify.ts\`
- Codex reply split into text then Enter, decisions verified \`src/adapters/codex.ts\`
- lastActivityAt bumps only when the pane hash changes \`src/daemon/poller.ts\`

### Verified

- \`pnpm test --filter ledge\`: 112 passed, 4.8s
- \`pnpm typecheck\`: clean
- \`scripts/soak.ts\`, one hour: not run

### Open question

PaneGone fires 2s after tmux loses the pane. When the pane comes back inside that window, should the session keep its pending item or start clean?

- Keep it
- Start clean

### Left to do

1. Step 7, the one-hour soak, once you answer.
2. Step 8, the adapter contract in \`docs/adapters.md\`.
`;
export const reply = { state: 'idle' as const, lastReply: { text: replyText, at: ago(0.3) } };
export const overview = (): Session[] => [
  session('otto', { name: 'Otto', project: 'harness-assistant', startedAt: ago(18), ...perm }),
  session('nova', { name: 'Nova', tool: 'codex', project: 'design-system', startedAt: ago(12), ...ques }),
  session('pim', { name: 'Pim', tool: 'cursor', project: 'landing-page', startedAt: ago(8) }),
  session('bix', { name: 'Bix', project: 'documentation', startedAt: ago(2), ...reply })
];
export const team = (): Session[] => ['Otto', 'Nova', 'Pim', 'Bix', 'Lu', 'Milo', 'Ada', 'Nox', 'Pip', 'Sol', 'Mina', 'Tao'].map((name, i) =>
  session(`t${i}`, { name, tool: (['claude', 'codex', 'cursor'] as const)[i % 3], project: ['harness-assistant', 'design-system', 'landing-page'][i % 3]!, startedAt: ago(12 - i), ...(i === 1 || i === 7 || i === 10 ? perm : i % 3 === 0 ? { state: 'idle' as const } : {}) }));

/** Hovers the island with the real mouse, coming from below it. The list opens after the dwell. */
export async function hoverHandle(page: Page) {
  // The notch and every panel share the axis, so the centre holds while a panel folds. The resting filet is 10 px,
  // so the pointer aims at its middle rather than a fixed y. Two steps only: a pending ask unfolds its bubble
  // 540 ms after the sessions arrive unless the notch is hovered first, and each step costs the loaded browser ~50 ms.
  const h = (await surface(page).boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2, { steps: 2 });
}
/** Opens the list by hovering the handle with the real mouse, then rests the pointer inside the surface. */
export async function openList(page: Page) {
  await hoverHandle(page);
  await expectMode(page, 'list');
  await restInside(page);
}
export async function restInside(page: Page) {
  const b = (await surface(page).boundingBox())!;
  await page.mouse.move(b.x + b.width - 4, b.y + b.height / 2);
}
