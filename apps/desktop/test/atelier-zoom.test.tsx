import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { Projects, Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); vi.unstubAllEnvs(); for (const d of daemons.splice(0)) await d.close(); });

const projects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'pay', name: 'Payment Service Platform Migration Europe', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] },
    { id: 'docs', name: 'Docs', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/docs' }] }
  ],
  rules: []
};
const DEFAULT: Session[] = [
  fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'waiting_permission' }),
  fakeSession('nova', { name: 'Nova', cwd: '/w/pay', state: 'working' }),
  fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' })
];

/** The harness of atelier.test.tsx: Otto (Ledge), Nova (Payment…), Kit (no project), plus Docs, a project without agents. */
async function boot({ sessions = DEFAULT }: { sessions?: Session[] } = {}) {
  const d = await createMockDaemon(); daemons.push(d);
  d.machines([{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev SSH', ssh: 'dev' }]);
  d.projects(projects);
  for (const s of sessions) d.upsert(s);
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  const view = render(<App client={client} />);
  const side = within(await screen.findByRole('complementary', { name: /sidebar/i }));
  await waitFor(() => expect(side.getByRole('button', { name: /Atelier/ })).toHaveTextContent(String(sessions.length)));
  await side.findByRole('button', { name: /^Docs/ });
  if (sessions.length > 0) await screen.findByRole('button', { name: new RegExp(`^${sessions[0]!.name},`) });
  return { d, side, view, client, user: userEvent.setup() };
}

const bar = () => within(screen.getByRole('toolbar', { name: 'Atelier zoom' }));

describe('the atelier zoom', () => {
  it('the zoom bar: − and + step by 1.2, the percentage goes back to 100 %, Fit is pressed when fitted', async () => {
    const { user } = await boot();
    expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('100 %');
    expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(bar().getByRole('button', { name: 'Zoom in' }));
    expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('120 %');
    expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(bar().getByRole('button', { name: 'Zoom in' }));
    expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('144 %');
    await user.click(bar().getByRole('button', { name: 'Back to 100 %' }));
    expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('100 %');
    await user.click(bar().getByRole('button', { name: /Fit/ }));
    expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('+ − 0 from the keyboard, never while typing; Ctrl + wheel zooms, a plain wheel does not', async () => {
    const { user } = await boot();
    const level = () => bar().getByRole('button', { name: 'Back to 100 %' });
    await user.keyboard('+'); expect(level()).toHaveTextContent('120 %');
    await user.keyboard('-'); expect(level()).toHaveTextContent('100 %');
    await user.keyboard('+0'); expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Control>}k{/Control}+');
    expect(screen.getByRole('combobox')).toHaveValue('+');
    await user.keyboard('{Escape}');
    expect(level()).toHaveTextContent('100 %');
    const scroller = document.querySelector('.overview-scroll.atelier')!;
    fireEvent.wheel(scroller, { deltaY: 100 });
    expect(level()).toHaveTextContent('100 %');
    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true });
    expect(level()).toHaveTextContent('125 %');
  });
  it('Space held arms the pan; the bar and the legend sit outside the zoomed content', async () => {
    const { user } = await boot();
    const scroller = document.querySelector('.overview-scroll.atelier')!;
    await user.keyboard('[Space>]'); expect(scroller).toHaveClass('can-pan');
    await user.keyboard('[/Space]'); expect(scroller).not.toHaveClass('can-pan');
    expect(document.querySelector('.zoom-controls')!.closest('.office-shell')).toBeNull();
    expect(document.querySelector('.workspace-legend')!.closest('.office-shell')).toBeNull();
  });
  it('the scroller is fitted (no scrolling) until a manual zoom, and the window losing focus disarms Space', async () => {
    const { user } = await boot();
    const scroller = document.querySelector('.overview-scroll.atelier')!;
    expect(scroller).toHaveClass('fitted');
    await user.keyboard('='); expect(scroller).not.toHaveClass('fitted');
    expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('120 %');
    await user.keyboard('[Space>]'); expect(scroller).toHaveClass('can-pan');
    fireEvent.blur(window); expect(scroller).not.toHaveClass('can-pan');
    // The scroller's dynamic classes survive a re-render that changes the zoom.
    await user.keyboard('[Space>]'); await user.keyboard('0');
    expect(scroller).toHaveClass('fitted'); expect(scroller).toHaveClass('can-pan');
    await user.keyboard('[/Space]');
  });
  it('Space on a focused button keeps its own activation: the pan is not armed', async () => {
    const { user } = await boot();
    const scroller = document.querySelector('.overview-scroll.atelier')!;
    const zoomIn = bar().getByRole('button', { name: 'Zoom in' });
    zoomIn.focus();
    await user.keyboard(' ');
    expect(scroller).not.toHaveClass('can-pan');
    expect(bar().getByRole('button', { name: 'Back to 100 %' })).toHaveTextContent('120 %');
  });
  it('a refit while zoomed keeps the zoom and the point at the centre of the view, instead of jumping to the top left', async () => {
    const { d, user } = await boot();
    const scroller = document.querySelector<HTMLElement>('.overview-scroll.atelier')!;
    const shell = scroller.querySelector<HTMLElement>('.office-shell')!;
    // A browser in miniature: 1000 × 750 of content at zoom 1 in an 800 × 600 view; the scroll is clamped whenever the
    // content shrinks, as a browser does on reflow.
    let zoom = 1, left = 0, top = 0;
    const width = () => Math.max(800, Math.round(1000 * zoom)), height = () => Math.max(600, Math.round(750 * zoom));
    const clamp = () => { left = Math.max(0, Math.min(left, width() - 800)); top = Math.max(0, Math.min(top, height() - 600)); };
    const props: Record<string, PropertyDescriptor> = {
      clientWidth: { get: () => 800 }, clientHeight: { get: () => 600 }, offsetWidth: { get: () => 800 }, offsetHeight: { get: () => 600 },
      scrollWidth: { get: width }, scrollHeight: { get: height },
      scrollLeft: { get: () => left, set: (v: number) => { left = v; clamp(); } },
      scrollTop: { get: () => top, set: (v: number) => { top = v; clamp(); } }
    };
    for (const [k, p] of Object.entries(props)) Object.defineProperty(scroller, k, { configurable: true, ...p });
    Object.defineProperty(shell.style, 'zoom', { configurable: true, get: () => String(zoom), set: (v: string) => { zoom = Number(v) || 1; clamp(); } });
    await user.keyboard('+');
    const level = () => bar().getByRole('button', { name: 'Back to 100 %' });
    expect(level()).toHaveTextContent('120 %');
    scroller.scrollLeft = 300; scroller.scrollTop = 200;
    const centre = { x: (300 + 400) / 1.2, y: (200 + 300) / 1.2 };
    d.upsert(fakeSession('mia', { name: 'Mia', cwd: '/w/docs', state: 'working' }));        // one more agent: the mosaic refits
    await screen.findByRole('button', { name: /^Mia,/ });
    expect(level()).toHaveTextContent('120 %');
    expect(scroller).not.toHaveClass('fitted');
    expect((scroller.scrollLeft + 400) / 1.2).toBeCloseTo(centre.x);
    expect((scroller.scrollTop + 300) / 1.2).toBeCloseTo(centre.y);
  });
  it('a double-click on the floor refits; the zoom bar titles its buttons and shows its hint', async () => {
    const { user } = await boot();
    await user.keyboard('++');
    const scroller = document.querySelector<HTMLElement>('.overview-scroll.atelier')!;
    fireEvent.doubleClick(scroller.querySelector('.office-shell')!);
    expect(bar().getByRole('button', { name: /Fit/ })).toHaveAttribute('aria-pressed', 'true');
    expect(bar().getByRole('button', { name: 'Zoom out' })).toHaveAttribute('title', 'Zoom out (−)');
    expect(screen.getByRole('toolbar', { name: 'Atelier zoom' }).querySelector('.zoom-hint')).toHaveTextContent('Ctrl + wheel · drag the floor · double-click a table');
  });
});
