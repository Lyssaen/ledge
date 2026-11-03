import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { AttachmentRef, ThreadItem } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import type { Decisions } from '../src/fleet/decisions';
import type { NavState } from '../src/nav/state';
import type { SessionActions } from '../src/manage/useSessionActions';
import { createSessionMemory } from '../src/session/memory';
import { SessionPage } from '../src/session/SessionPage';

vi.mock('@ledge/fleet', async importOriginal => ({ ...(await importOriginal<object>()), useImageUrl: () => ({ url: 'blob:t', failed: false }) }));

const REF: AttachmentRef = { id: 'a'.repeat(64), mime: 'image/png', width: 1280, height: 800, bytes: 1000, preview: true };
const REF2: AttachmentRef = { id: 'b'.repeat(64), mime: 'image/png', width: 390, height: 844, bytes: 1000, preview: true };
const AT = new Date(2026, 10, 2, 16, 41).toISOString();
const prompt: ThreadItem = { kind: 'prompt', id: 'p1', at: AT, turn: 1, text: 'Vérifie la page' };
const shot = (id: string, images: AttachmentRef[], extra: Partial<ThreadItem> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: AT, turn: 1, tool: 'mcp__playwright__browser_take_screenshot', label: 'viewport', status: 'success', files: [], images, ...extra }) as ThreadItem;

const session = fakeSession('luna', { name: 'Luna', cwd: '/w/site' });
const client = { send: () => {}, on: () => () => {}, onMessage: () => () => {} } as unknown as DaemonClient;
const decisions: Decisions = { busy: () => false, landed: null, decide: () => false, reply: () => false, answer: () => false };
const nav = { place: { kind: 'overview' } } as unknown as NavState;

let user: UserEvent;
beforeEach(() => { user = userEvent.setup(); });
afterEach(cleanup);

function page(items: ThreadItem[]) {
  return (
    <LangProvider lang="fr">
      <SessionPage session={session} helper={null} items={[prompt, ...items]} nav={nav} dispatch={() => {}} decisions={decisions} waits={new Map()}
        actions={{} as SessionActions} memory={memory} notify={() => {}} onShowKids={() => {}} onPanel={() => {}} split={0.5} onSplit={() => {}} client={client}
        view="thread" onView={() => {}} files={[]} changes={{ shown: false, listOpen: false, closeList: () => {}, step: () => {} }} onAllChanges={() => {}} api={{ current: null }} onOpenShell={() => {}} />
    </LangProvider>
  );
}
let memory = createSessionMemory();
function renderSession({ items }: { items: ThreadItem[] }) {
  memory = createSessionMemory();
  const view = render(page(items));
  return { rerender: ({ items: next }: { items: ThreadItem[] }) => view.rerender(page(next)) };
}

const pane = () => screen.getByRole('complementary', { name: 'Volet de lecture' });
const selectedCell = () => pane().querySelector('[data-capture][aria-current="true"]');
const cell = (key: string) => pane().querySelector<HTMLElement>(`[data-capture="${key}"]`)!;
const threadThumb = (toolId: string) => document.querySelector<HTMLElement>(`.session-thread [data-tool="${toolId}"] [data-thumb]`)!;
const openOn = (key: string) => act(() => threadThumb(key.split(':')[0]!).click());

describe('the Navigateur tab', () => {
  it('shows no head button without a capture', () => {
    renderSession({ items: [] });
    expect(screen.queryByRole('button', { name: /Navigateur/ })).toBeNull();
  });

  it('opens on the latest capture from the head button', async () => {
    renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    await user.click(screen.getByRole('button', { name: /Navigateur/ }));
    expect(within(pane()).getByText('2 captures · 1 échange')).toBeVisible();
    expect(selectedCell()).toHaveAttribute('data-capture', 's2:0');
    expect(within(pane()).getByText('390×844', { selector: '.browser-meta *' })).toBeVisible();
  });

  it('opens on the clicked thread capture', async () => {
    renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    await user.click(threadThumb('s1'));
    expect(selectedCell()).toHaveAttribute('data-capture', 's1:0');
    // Another thumbnail clicked while the tab is open moves it there.
    await user.click(threadThumb('s2'));
    expect(selectedCell()).toHaveAttribute('data-capture', 's2:0');
  });

  it('a strip cell selects its capture', async () => {
    renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    await user.click(screen.getByRole('button', { name: /Navigateur/ }));
    await user.click(cell('s1:0'));
    expect(selectedCell()).toHaveAttribute('data-capture', 's1:0');
  });

  it('a divider between turns', async () => {
    renderSession({ items: [shot('s1', [REF]), { kind: 'prompt', id: 'p2', at: AT, turn: 2, text: 'Et en mobile' }, shot('s2', [REF2], { turn: 2 })] });
    await user.click(screen.getByRole('button', { name: /Navigateur/ }));
    expect(within(pane()).getByText('2 captures · 2 échanges')).toBeVisible();
    expect(pane().querySelectorAll('.browser-turn')).toHaveLength(1);
  });

  it('compares two captures', async () => {
    renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    await user.click(screen.getByRole('button', { name: /Navigateur/ }));
    await user.click(within(pane()).getByRole('button', { name: 'Comparer' }));
    expect(within(pane()).getByText('Choisis les deux captures à comparer')).toBeVisible();
    await user.click(cell('s1:0')); await user.click(cell('s2:0'));
    expect(within(pane()).getAllByTestId('compare-side')).toHaveLength(2);
    expect(within(cell('s1:0')).getByText('A')).toBeVisible();
    expect(within(cell('s2:0')).getByText('B')).toBeVisible();
    await user.click(within(pane()).getByRole('button', { name: 'Comparaison · Quitter' }));
    expect(within(pane()).queryAllByTestId('compare-side')).toHaveLength(0);
    expect(within(pane()).getByRole('button', { name: 'Comparer' })).toBeVisible();
  });

  it('a thread thumbnail clicked while comparing shows that capture alone', async () => {
    renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    await user.click(screen.getByRole('button', { name: /Navigateur/ }));
    await user.click(within(pane()).getByRole('button', { name: 'Comparer' }));
    await user.click(cell('s1:0')); await user.click(cell('s2:0'));
    await user.click(threadThumb('s1'));
    expect(within(pane()).queryAllByTestId('compare-side')).toHaveLength(0);
    expect(selectedCell()).toHaveAttribute('data-capture', 's1:0');
    expect(within(pane()).getByRole('button', { name: 'Comparer' })).toBeVisible();
  });

  it('lights the row in the thread', async () => {
    renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    await user.click(threadThumb('s1'));
    await user.click(within(pane()).getByRole('button', { name: 'dans le fil' }));
    expect(document.querySelector('.session-thread [data-tool="s1"]')).toHaveClass('flash');
  });

  it('« Agrandir » opens the lightbox on the selected capture', async () => {
    renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    await user.click(threadThumb('s1'));
    await user.click(within(pane().querySelector<HTMLElement>('.browser-meta')!).getByRole('button', { name: 'Agrandir' }));
    expect(await screen.findByRole('dialog', { name: /^Capture · Luna/ })).toHaveTextContent('1/2');
  });

  it('the strip shows its end when a capture arrives while the tab is open; the selection stays', async () => {
    const { rerender } = renderSession({ items: [shot('s1', [REF])] });
    await user.click(screen.getByRole('button', { name: /Navigateur/ }));
    const strip = pane().querySelector<HTMLElement>('.browser-cells')!;
    const left = vi.fn();
    Object.defineProperty(strip, 'scrollWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(strip, 'scrollLeft', { configurable: true, get: () => 0, set: left });
    rerender({ items: [shot('s1', [REF]), shot('s2', [REF2])] });
    expect(left).toHaveBeenCalledWith(900);
    expect(selectedCell()).toHaveAttribute('data-capture', 's1:0');
  });

  it('falls back when the focused capture leaves the thread', async () => {
    const { rerender } = renderSession({ items: [shot('s1', [REF]), shot('s2', [REF2])] }); await openOn('s1:0');
    expect(selectedCell()).toHaveAttribute('data-capture', 's1:0');
    rerender({ items: [shot('s2', [REF2])] });
    expect(selectedCell()).toHaveAttribute('data-capture', 's2:0');
    rerender({ items: [] });
    expect(within(pane()).getByText('Plus aucune capture dans le fil')).toBeVisible();
    await user.click(within(pane()).getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('complementary', { name: 'Volet de lecture' })).toBeNull();
  });
});
