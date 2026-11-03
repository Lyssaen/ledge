import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { BrowserLive, Session, ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons } from './helpers';
import { actionOf, pillOf, resetBrowserLive, sideOnOpen, markOffSeen } from '../src/session/browserLive';
import { clock } from '../src/session/exchanges';

vi.mock('@ledge/fleet', async importOriginal => ({ ...(await importOriginal<object>()), useImageUrl: () => ({ url: 'blob:t', failed: false }) }));

beforeEach(() => { localStorage.clear(); resetBrowserLive(); });
afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await closeDaemons(); });

/** docs/mockups/ledge-browser-live.html (design/html-viewer 44811d1e): the agent's own browser, live, in the Navigateur tab. */
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
const SINCE = iso(8), SHOT = iso(3), CLOSED = iso(1);
const URL = 'http://localhost:8733/ledge-openrig-omp.html';
const OTTO = fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' });
const tool = (id: string, short: string, input: object, extra: Partial<ThreadItem> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: SHOT, turn: 1, tool: `mcp__playwright__${short}`, label: short, input: JSON.stringify(input, null, 2), status: 'success', files: [], ...extra }) as ThreadItem;
const REF = { id: 'a'.repeat(64), mime: 'image/png', width: 1280, height: 800, bytes: 1000, preview: true } as const;
const THREAD: ThreadItem[] = [
  { kind: 'prompt', id: 'p1', at: iso(10), turn: 1, text: 'Vérifie la vue TUI de la maquette, puis capture-la.' },
  tool('t1', 'browser_navigate', { url: URL }),
  tool('t2', 'browser_take_screenshot', {}, { images: [REF] } as Partial<ThreadItem>),
  tool('t3', 'browser_click', { element: '1 · Desktop', ref: 'e12' }, { at: new Date(now - 2000).toISOString() })
];
const live = (id: string, extra: Partial<BrowserLive> = {}): Omit<BrowserLive, 'type'> => ({ id, state: 'live', tabs: 1, url: URL, title: 'Sièges OMP dans Ledge', since: SINCE, ...extra });
const closed = (id: string, extra: Partial<BrowserLive> = {}): Omit<BrowserLive, 'type'> =>
  ({ id, state: 'closed', tabs: 0, url: URL, title: 'Sièges OMP dans Ledge', since: SINCE, closedAt: CLOSED, closed: 'browser', image: { at: SHOT, url: URL }, ...extra });
const omp = (id: string, name: string, extra: Partial<Session> = {}): Session =>
  fakeSession(id, { name, tool: 'omp', cwd: '/w/dev-omp', state: 'working', source: 'rig', tmuxSession: 'design-maquettiste@dev-omp', rig: { seat: 'design-maquettiste@dev-omp', name: 'dev-omp', role: 'design.maquettiste' }, ...extra });

const pill = () => document.querySelector<HTMLElement>('.pane-heading .browser-pill');
const pane = () => within(screen.getByRole('complementary', { name: 'Reading pane' }));
const watches = (d: Awaited<ReturnType<typeof boot>>['d']) => d.received.filter(m => m.type === 'browser.watch' || m.type === 'browser.unwatch').map(m => `${m.type}:${(m as { id: string }).id}`);

async function openOtto(b: Omit<BrowserLive, 'type'> | null, thread: ThreadItem[] = THREAD) {
  const booted = await boot({ sessions: [OTTO], daemon: { version: '0.41.0', install: 'npm', systemd: true, browserLive: true } });
  booted.d.thread('otto', thread);
  if (b) booted.d.browser(b);
  await booted.user.click(booted.side.getByRole('button', { name: /^Otto/ }));
  await screen.findByRole('tab', { name: /^Thread/ });
  return booted;
}

describe('a Claude session’s browser', () => {
  it('live: « Browser · live », its Direct side filmed while it shows, the last action read in the thread; Captures unwatches it', async () => {
    const { d, user } = await openOtto(live('otto', { image: { at: SHOT, url: URL } }));
    d.lastImage({ id: 'otto', data: 'TEFTVA==', at: SHOT });
    await waitFor(() => expect(pill()).toHaveClass('browser-pill-live'));
    expect(pill()).toHaveTextContent('Browser· live1');
    expect(pill()).toHaveAttribute('title', 'Otto’s browser, live · 1 capture');
    expect(pill()!.querySelector('.live-dot')).not.toBeNull();
    await user.click(pill()!);
    const p = pane();
    expect(p.getByRole('tab', { name: /^Live/ })).toHaveAttribute('aria-selected', 'true');
    expect(p.getByRole('tab', { name: /^Captures/ })).toHaveTextContent('Captures1');
    await waitFor(() => expect(watches(d)).toEqual(['browser.watch:otto']));
    expect(p.getByText('Otto is driving · read-only')).toBeVisible();
    // The kept image first, then the film; the frame rate shows only while frames come (design-ux 5).
    await waitFor(() => expect(screen.getByTestId('browser-screen').querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,TEFTVA=='));
    expect(document.querySelector('.browser-fps')).toBeNull();
    act(() => { for (let k = 0; k < 4; k++) d.frame({ id: 'otto', data: `RlJBTUU${k}`, at: new Date().toISOString() }); });
    await waitFor(() => expect(document.querySelector('.browser-fps')).toHaveTextContent('2 fps'));
    expect(screen.getByTestId('browser-screen')).toHaveClass('live');
    expect(screen.getByTestId('browser-screen')).toHaveAttribute('title', 'Read-only: Otto is driving.');
    expect(document.querySelector('.browser-address')).toHaveTextContent('localhost:8733/ledge-openrig-omp.html· Sièges OMP dans Ledge');
    expect(document.querySelector('.browser-last')).toHaveTextContent(/^Clicks« 1 · Desktop »· \d+ s agoin the thread$/);
    // Captures: the tab of PR #163, and the film stops.
    await user.click(p.getByRole('tab', { name: /^Captures/ }));
    await waitFor(() => expect(watches(d)).toEqual(['browser.watch:otto', 'browser.unwatch:otto']));
    expect(document.querySelector('.browser-strip')).not.toBeNull();
  });

  it('closed: « Browser · closed », its last image grey and dated, the last address, « Open in my browser »; back: Live again and a notice', async () => {
    const { d, user } = await openOtto(closed('otto'));
    d.lastImage({ id: 'otto', data: 'TEFTVA==', at: SHOT });
    await waitFor(() => expect(pill()).toHaveClass('browser-pill-closed'));
    expect(pill()).toHaveTextContent('Browser· closed1');
    await user.click(pill()!);
    const p = pane();
    expect(p.getByRole('tab', { name: /^Closed/ })).toHaveAttribute('aria-selected', 'true');
    expect(p.getByText(`Browser closed at ${clock(CLOSED)}`)).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('browser-screen').querySelector('img')).not.toBeNull());
    expect(screen.getByTestId('browser-screen')).toHaveClass('closed');
    expect(p.getByText(`Last image · seen at ${clock(SHOT)}`)).toBeVisible();
    expect(document.querySelector('.browser-address')).toHaveTextContent('localhost:8733/ledge-openrig-omp.html· last address');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await user.click(p.getByRole('button', { name: 'Open in my browser' }));
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener');
    expect(p.getByText(/the mockup’s server must still be running/)).toBeVisible();
    // Otto opens it again: the Direct side live, the notice, watched again (the daemon sends its state and image).
    act(() => d.browser(live('otto')));
    await waitFor(() => expect(p.getByRole('tab', { name: /^Live/ })).toHaveAttribute('aria-selected', 'true'));
    expect(p.getByRole('status')).toHaveTextContent('Otto reopened the browser');
    expect(pill()).toHaveClass('browser-pill-live');
    await waitFor(() => expect(watches(d).filter(w => w === 'browser.watch:otto')).toHaveLength(2));
  });

  it('reopened on another page with no image yet: « Waiting for the first image… », never the closed page’s image under its address (review)', async () => {
    const { d, user } = await openOtto(live('otto'));
    act(() => d.frame({ id: 'otto', data: 'T0xE', at: new Date().toISOString() }));
    await waitFor(() => expect(pill()).toHaveClass('browser-pill-live'));
    await user.click(pill()!);
    act(() => d.frame({ id: 'otto', data: 'T0xE', at: new Date().toISOString() }));
    await waitFor(() => expect(screen.getByTestId('browser-screen').querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,T0xE'));
    // Closed: the daemon keeps that image; then the browser opens again on another page, the kept image older than it.
    const kept = new Date(Date.now() - 60_000).toISOString();
    d.lastImage({ id: 'otto', data: 'T0xE', at: kept });
    act(() => d.browser(closed('otto', { image: { at: kept, url: URL } })));
    await waitFor(() => expect(screen.getByTestId('browser-screen')).toHaveClass('closed'));
    act(() => d.browser(live('otto', { url: 'https://example.com/new', title: 'New', since: new Date().toISOString() })));
    await waitFor(() => expect(document.querySelector('.browser-address')).toHaveTextContent('example.com/new'));
    await waitFor(() => expect(watches(d).filter(w => w === 'browser.watch:otto').length).toBeGreaterThanOrEqual(3));
    expect(screen.getByTestId('browser-screen')).toHaveTextContent('Waiting for the first image…');
    expect(screen.getByTestId('browser-screen').querySelector('img')).toBeNull();
    // Its first frame of the film shows.
    act(() => d.frame({ id: 'otto', data: 'TkVX', at: new Date().toISOString() }));
    await waitFor(() => expect(screen.getByTestId('browser-screen').querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,TkVX'));
  });

  it('another page while live (an address, a tab): page A’s image never shows under B, nor the kept image of A a watch sends (review)', async () => {
    const { d, user } = await openOtto(live('otto', { image: { at: SHOT, url: URL } }));
    d.lastImage({ id: 'otto', data: 'QUFB', at: SHOT });
    await waitFor(() => expect(pill()).toHaveClass('browser-pill-live'));
    await user.click(pill()!);
    await waitFor(() => expect(screen.getByTestId('browser-screen').querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,QUFB'));
    // B: same live period, another address, no image of it yet.
    act(() => d.browser(live('otto', { url: 'https://example.com/new', title: 'New', image: { at: SHOT, url: URL } })));
    await waitFor(() => expect(document.querySelector('.browser-address')).toHaveTextContent('example.com/new'));
    expect(screen.getByTestId('browser-screen')).toHaveTextContent('Waiting for the first image…');
    // The kept image a new watch sends (the Captures side and back) is still A's: not shown under B.
    await user.click(pane().getByRole('tab', { name: /^Captures/ }));
    await user.click(pane().getByRole('tab', { name: /^Live/ }));
    await waitFor(() => expect(watches(d).filter(w => w === 'browser.watch:otto')).toHaveLength(2));
    expect(screen.getByTestId('browser-screen').querySelector('img')).toBeNull();
    act(() => d.frame({ id: 'otto', data: 'QkJC', at: new Date().toISOString() }));
    await waitFor(() => expect(screen.getByTestId('browser-screen').querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,QkJC'));
    // Another tab on the same address: its image is not the last one's either.
    act(() => d.browser(live('otto', { url: 'https://example.com/new', title: 'New', tabs: 2 })));
    await waitFor(() => expect(screen.getByTestId('browser-screen')).toHaveTextContent('Waiting for the first image…'));
  });

  it('closed without an image: its title and address only; an address that is not http has no « Open in my browser »', async () => {
    const { user } = await openOtto(closed('otto', { image: undefined, url: 'file:///home/gch/m.html' }), []);
    await waitFor(() => expect(pill()).toHaveClass('browser-pill-closed'));
    expect(pill()).toHaveTextContent('Browser· closed');
    await user.click(pill()!);
    expect(pane().getByText('No image was taken of this tab.')).toBeVisible();
    expect(document.querySelector('.browser-address')).toHaveTextContent('/home/gch/m.html· Sièges OMP dans Ledge');
    expect(pane().queryByRole('button', { name: 'Open in my browser' })).toBeNull();
    // No capture in the thread: no Captures side.
    expect(pane().queryByRole('tab', { name: /^Captures/ })).toBeNull();
  });

  it('off: « Browser » even without a capture, its box once for the app, « Turn on live view… », the confirmation, then the daemon’s answer', async () => {
    const { d, user } = await openOtto({ id: 'otto', state: 'off', tabs: 1, since: SINCE });
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(pill()).toHaveTextContent('Browser1');
    expect(pill()).not.toHaveClass('browser-pill-live');
    await user.click(pill()!);
    const p = pane();
    expect(p.getByRole('tab', { name: /^Live/ })).toHaveAttribute('aria-selected', 'true');
    expect(p.getByText('Live view is off.')).toBeVisible();
    expect(p.getByText(/it applies to sessions started afterwards/)).toBeVisible();
    await user.click(p.getByRole('button', { name: 'Turn on live view…' }));
    const dialog = p.getByRole('dialog', { name: 'Turn on live view of the agents’ browser?' });
    expect(dialog).toHaveTextContent('Ledge adds --remote-debugging-port=0 to the Playwright config Claude Code loads.');
    // Cancel sends nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(d.received.some(m => m.type === 'browser.enable')).toBe(false);
    await user.click(p.getByRole('button', { name: 'Turn on live view…' }));
    await user.click(within(p.getByRole('dialog')).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(d.received.find(m => m.type === 'browser.enable')).toMatchObject({ confirmed: true }));
    const rid = (d.received.find(m => m.type === 'browser.enable') as { rid: string }).rid;
    act(() => d.reply({ type: 'browser.enabled', rid, outcome: 'enabled', path: '/home/gch/.config/playwright-mcp/config.json' }));
    await waitFor(() => expect(p.getByText('Live view on for the next sessions.')).toBeVisible());
    expect(p.queryByRole('button', { name: 'Turn on live view…' })).toBeNull();
    // Seen once: the button now opens Captures.
    await user.click(p.getByRole('button', { name: /Close the pane/ }));
    await user.click(pill()!);
    expect(pane().getByRole('tab', { name: /^Captures/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('refused: its reason and the config’s path, no button', async () => {
    const { d, user } = await openOtto({ id: 'otto', state: 'off', tabs: 1 }, []);
    await waitFor(() => expect(pill()).not.toBeNull());
    expect(pill()).toHaveTextContent(/^Browser$/);
    await user.click(pill()!);
    await user.click(pane().getByRole('button', { name: 'Turn on live view…' }));
    await user.click(within(pane().getByRole('dialog')).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(d.received.some(m => m.type === 'browser.enable')).toBe(true));
    const rid = (d.received.find(m => m.type === 'browser.enable') as { rid: string }).rid;
    act(() => d.reply({ type: 'browser.enabled', rid, outcome: 'refused', reason: 'invalid_config', path: '/home/gch/pw.json' }));
    await waitFor(() => expect(pane().getByText('The Playwright config cannot be read: Ledge leaves it alone.')).toBeVisible());
    expect(pane().getByText('/home/gch/pw.json')).toBeVisible();
    expect(pane().queryByRole('button', { name: /Turn on/ })).toBeNull();
    // The config mended: « Try again » asks once more at once, « Working… » meanwhile (review qitem-20261103172151, design-ux 17:23Z).
    await user.click(pane().getByRole('button', { name: 'Try again' }));
    expect(pane().queryByRole('dialog')).toBeNull();
    expect(pane().getByRole('button', { name: 'Working…' })).toBeDisabled();
    await waitFor(() => expect(d.received.filter(m => m.type === 'browser.enable')).toHaveLength(2));
    const again = (d.received.filter(m => m.type === 'browser.enable').at(-1) as { rid: string }).rid;
    expect(again).not.toBe(rid);
    act(() => d.reply({ type: 'browser.enabled', rid: again, outcome: 'already', path: '/home/gch/pw.json' }));
    await waitFor(() => expect(pane().getByText('Live view on for the next sessions.')).toBeVisible());
  });

  it('a refusal is not kept for the app: the pane opened again offers « Turn on live view… » again', async () => {
    const { d, user } = await openOtto({ id: 'otto', state: 'off', tabs: 1 }, []);
    await waitFor(() => expect(pill()).not.toBeNull());
    await user.click(pill()!);
    await user.click(pane().getByRole('button', { name: 'Turn on live view…' }));
    await user.click(within(pane().getByRole('dialog')).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(d.received.some(m => m.type === 'browser.enable')).toBe(true));
    const rid = (d.received.find(m => m.type === 'browser.enable') as { rid: string }).rid;
    act(() => d.reply({ type: 'browser.enabled', rid, outcome: 'refused', reason: 'not_configured' }));
    await waitFor(() => expect(pane().getByText('Claude Code loads no Playwright config: nothing to change.')).toBeVisible());
    await user.click(pane().getByRole('button', { name: /Close the pane/ }));
    await user.click(pill()!);
    expect(pane().getByRole('button', { name: 'Turn on live view…' })).toBeVisible();
  });
});

describe('an OMP seat’s browser', () => {
  it('live: the page stays on Terminal, the pane beside it, « The agent’s browser », « Mia is using the browser », no Captures', async () => {
    const MIA = omp('rig-mia', 'Mia');
    const { d, side, user } = await boot({ sessions: [MIA], daemon: { version: '0.41.0', install: 'npm', systemd: true, browserLive: true } });
    d.browser(live('rig-mia', { url: 'about:blank' }));
    await user.click(side.getByRole('button', { name: /^Mia/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Terminal/ })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(pill()).toHaveClass('browser-pill-live'));
    expect(pill()).toHaveTextContent(/^Browser· live$/);
    await user.click(pill()!);
    expect(screen.getByRole('tab', { name: /^Terminal/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeVisible();
    const p = pane();
    expect(p.queryByRole('tab', { name: /^Captures/ })).toBeNull();
    expect(document.querySelector('.browser-address')).toHaveTextContent('The agent’s browser· Sièges OMP dans Ledge');
    expect(document.querySelector('.browser-last')).toHaveTextContent(`Mia is using the browser · since ${clock(SINCE)}`);
    expect(p.getByText('Mia is driving · read-only')).toBeVisible();
    // Its tabs closed: grey, the last image, no address to open.
    act(() => d.browser(closed('rig-mia', { url: 'about:blank', closed: 'tabs', image: undefined })));
    await waitFor(() => expect(p.getByText(`Tabs closed at ${clock(CLOSED)}`)).toBeVisible());
    expect(document.querySelector('.browser-address')).toHaveTextContent('The agent’s browser· last page: Sièges OMP dans Ledge');
    expect(p.getByText(/Mia’s browser stays ready, with no tab\..*The injected mockup has no address/)).toBeVisible();
    expect(p.queryByRole('button', { name: 'Open in my browser' })).toBeNull();
    expect(pill()).toHaveClass('browser-pill-closed');
  });

  it('stopped: its page on « Thread », the pane keeps the last image, « Seat stopped at … »', async () => {
    const MIA = omp('rig-mia', 'Mia', { state: 'exited', exitedAt: CLOSED });
    // A stopped seat shows under its rig beside a live one (the eye of « Projets » folds it).
    const { d, side, user } = await boot({ sessions: [omp('rig-ana', 'Ana', { tmuxSession: 'analysis-analyst@dev-omp', rig: { seat: 'analysis-analyst@dev-omp', name: 'dev-omp', role: 'analysis.analyst' } }), MIA], daemon: { version: '0.41.0', install: 'npm', systemd: true, browserLive: true } });
    d.browser(closed('rig-mia', { url: 'about:blank', closed: 'stopped' }));
    d.lastImage({ id: 'rig-mia', data: 'TEFTVA==', at: SHOT });
    await user.click(side.getByRole('button', { name: /^Mia/ }));
    await waitFor(() => expect(pill()).toHaveClass('browser-pill-closed'));
    await user.click(pill()!);
    expect(screen.getByRole('tab', { name: /^Thread/ })).toHaveAttribute('aria-selected', 'true');
    expect(pane().getByText(`Seat stopped at ${clock(CLOSED)}`)).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('browser-screen').querySelector('img')).not.toBeNull());
    expect(pane().getByText(/The browser stopped with the seat\./)).toBeVisible();
  });

  it('none (an OMP browser open with no tab): no button', async () => {
    const MIA = omp('rig-mia', 'Mia');
    const { d, side, user } = await boot({ sessions: [MIA], daemon: { version: '0.41.0', install: 'npm', systemd: true, browserLive: true } });
    d.browser({ id: 'rig-mia', state: 'none', tabs: 0 });
    await user.click(side.getByRole('button', { name: /^Mia/ }));
    await screen.findByRole('region', { name: 'Terminal' });
    expect(pill()).toBeNull();
  });
});

describe('the rules', () => {
  it('the head’s button: live, closed, or the captures’ (off even without one; a remote session or none only with captures)', () => {
    expect(['live', 'closed', 'off', 'remote', 'none'].map(k => [pillOf(k as never, 0), pillOf(k as never, 2)]))
      .toEqual([['live', 'live'], ['closed', 'closed'], ['captures', 'captures'], [null, 'captures'], [null, 'captures']]);
  });
  it('the side it opens on (design-ux 1b, 4, 7)', () => {
    expect(sideOnOpen('live', 2, false)).toBe('direct');
    expect(sideOnOpen('closed', 0, false)).toBe('direct');
    expect(sideOnOpen('live', 2, true)).toBe('captures');
    expect(sideOnOpen('remote', 2, false)).toBe('captures');
    expect(sideOnOpen('off', 2, false)).toBe('direct');
    markOffSeen();
    expect(sideOnOpen('off', 2, false)).toBe('captures');
    expect(sideOnOpen('off', 0, false)).toBe('direct');
  });
  it('the last action’s objects (design-ux 15:26Z): element, address without scheme, cut at 48, fields counted, option in element, seconds', () => {
    const a = (short: string, input: object) => { const x = actionOf(tool('x', short, input) as Extract<ThreadItem, { kind: 'tool' }>); return [x.objects, x.fields, x.seconds]; };
    expect(a('browser_click', { element: 'Envoyer', ref: 'e1' })).toEqual([['Envoyer'], undefined, undefined]);
    expect(a('browser_click', { ref: 'e1' })).toEqual([[], undefined, undefined]);
    expect(a('browser_navigate', { url: 'https://example.com/a' })).toEqual([['example.com/a'], undefined, undefined]);
    expect(a('browser_type', { text: 'x'.repeat(60) })[0]).toEqual([`${'x'.repeat(47)}…`]);
    expect(a('browser_fill_form', { fields: [{}, {}, {}] })).toEqual([[], 3, undefined]);
    expect(a('browser_select_option', { element: 'Pays', values: ['Belgique'] })).toEqual([['Belgique', 'Pays'], undefined, undefined]);
    expect(a('browser_wait_for', { time: 2 })).toEqual([[], undefined, 2]);
    expect(a('browser_resize', { width: 1280, height: 800 })).toEqual([['1280×800'], undefined, undefined]);
    expect(a('browser_tabs', { action: 'list' })).toEqual([[], undefined, undefined]);
  });
});
