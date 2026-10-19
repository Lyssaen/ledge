import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, declarations, listSessions, ottoThread, unfoldPast } from './helpers';
import { createSessionMemory, memoKey } from '../src/session/memory';
import { saveReduced } from '../src/motionPreferences';

// Each message's Markdown counts its renders (the real reader still renders): the page's ticks must spare it.
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock('@ledge/ui/documents/markdown', async importOriginal => {
  const real = await importOriginal<typeof import('@ledge/ui/documents/markdown')>();
  return { ...real, ThreadMarkdown: (p: Parameters<typeof real.ThreadMarkdown>[0]) => { renders.set(p.text, (renders.get(p.text) ?? 0) + 1); return real.ThreadMarkdown(p); } };
});

afterEach(async () => { cleanup(); localStorage.clear(); saveReduced(false); vi.unstubAllEnvs(); vi.useRealTimers(); renders.clear(); await closeDaemons(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Session thread' }));
async function openOtto(o: { offline?: boolean; withThread?: boolean } = {}) {
  const sessions = listSessions().map(s => (s.name === 'Otto' && o.offline ? { ...s, offline: true } : s));
  const env = await boot({ sessions, list: true });
  if (o.withThread !== false) env.d.thread('otto', ottoThread());
  await env.user.click(screen.getByRole('button', { name: /^Otto,/ }));
  return env;
}

describe('the session page', () => {
  it('the page replaces the pending place: one exchange per prompt, the past one folded to a row that unfolds', async () => {
    const { user } = await openOtto();
    expect(screen.queryByText('This screen is coming soon.')).toBeNull();
    // The past exchange is one row: its prompt, what it did; the current one is open.
    const fold = await thread().findByRole('button', { name: /Câble la liste/, expanded: false });
    expect(fold).toHaveTextContent(/^Exchange at \d\d:\d\d · Câble la liste · 4 actions · 1 file changed$/);
    expect(document.querySelectorAll('.session-thread .turn')).toHaveLength(2);
    expect(document.querySelectorAll('.session-thread .turn.folded')).toHaveLength(1);
    expect(thread().getByText('Corrige-les').closest('.prompt-block')).toHaveTextContent('You');
    await user.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(thread().getByText('Câble la liste').closest('.prompt-block')).toHaveTextContent('You');
    // The agent is its bot on the rail, named for screen readers.
    expect(document.querySelector('.say-row .botn')).toHaveTextContent('Otto');
    expect(thread().getByText('Deux tests échouent.').closest('.ledge-thread-md')).not.toBeNull();
    expect(document.querySelector('.pane-meta')).toHaveTextContent('Local · ledge');
    expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:otto'); // the fleet qualifies ids with the machine
    expect(document.querySelector('.session-page')).not.toHaveAttribute('data-helper');
  });

  it('more than six actions fold into a summary that unfolds; a failure and the running one stay in sight', async () => {
    const at = new Date().toISOString();
    const read = (i: number): ThreadItem => ({ kind: 'tool', id: `r${i}`, at, turn: 1, tool: 'Read', label: `/w/ledge/src/F${i}.tsx`, status: 'success', durationMs: 100, files: [] });
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    d.thread('otto', [
      { kind: 'prompt', id: 'p', at, turn: 1, text: 'Lis tout' },
      ...[1, 2, 3, 4, 5, 6].map(read),
      { kind: 'tool', id: 'f', at, turn: 1, tool: 'Bash', label: 'npm test', status: 'failed', durationMs: 300, error: 'exit 1', files: [] },
      { kind: 'tool', id: 'run', at, turn: 1, tool: 'Bash', label: 'npm run build', status: 'running', files: [] }
    ]);
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    const summary = await thread().findByRole('button', { name: /^8 actions/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary).toHaveTextContent('8 actions · 6 reads, 2 commands · 1 failed');
    expect(summary.closest('.r')!.querySelector('.tm')).toHaveTextContent(/^running · /);
    expect([...document.querySelectorAll('.turn [data-tool]')].map(e => e.getAttribute('data-tool'))).toEqual(['f', 'run']);
    const failed = document.querySelector<HTMLElement>('.action-row.status-failed')!;
    expect(within(failed).getByLabelText('Failed')).not.toBeNull();
    expect(within(failed).getByText('exit 1')).toHaveClass('action-output', 'is-error');  // a failure shows its output
    await user.click(within(failed).getByRole('button', { name: 'npm test' }));
    expect(within(failed).queryByText('exit 1')).toBeNull();
    expect(thread().getByRole('status', { name: 'Action running' })).toHaveTextContent('npm run build');
    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect([...document.querySelectorAll('.turn [data-tool] .action-verb')].map(e => e.textContent)).toEqual([...Array(6).fill('Read'), 'Command', 'Command']);
  });

  it('running actions end live: a result replaces its row in place, and the rows keep their order', async () => {
    const { d } = await openOtto();
    await thread().findByRole('status', { name: 'Action running' });
    const t5 = ottoThread().at(-1)! as Extract<ThreadItem, { kind: 'tool' }>;
    const t6 = { ...t5, id: 't6', tool: 'Read', label: '/w/ledge/src/List.tsx', at: new Date().toISOString() };
    d.threadItem('otto', t6);                                                            // a second action starts beside the first
    d.threadItem('otto', { ...t5, status: 'success', durationMs: 3000, output: 'ok' });  // then the first one's result comes
    const row = (id: string) => document.querySelector(`.turn.current [data-tool="${id}"]`);
    await waitFor(() => expect(row('t5')).toHaveClass('status-success'));
    expect(row('t5')!.querySelector('.action-time')).toHaveTextContent('3.0 s');
    expect(thread().getByRole('status', { name: 'Action running' })).toHaveTextContent('Readsrc/List.tsx');
    expect([...document.querySelectorAll('.turn.current [data-tool]')].map(e => e.getAttribute('data-tool'))).toEqual(['t5', 't6']);
    // The mock daemon stores the re-sent item where it was, as the daemon's store does.
    expect(d.threads.get('otto')!.map(i => i.id)).toEqual([...ottoThread().map(i => i.id), 't6']);
    d.threadItem('otto', { ...t6, status: 'success', durationMs: 1000 });
    await waitFor(() => expect(row('t6')).toHaveClass('status-success'));
    expect(thread().queryByRole('status', { name: 'Action running' })).toBeNull();
  });

  it('past decisions are chips; a subagent is a card that opens its own thread', async () => {
    const { user } = await openOtto();
    await unfoldPast(user);
    const chip = document.querySelector('.decision-chip.accept')!;
    expect(chip.querySelector('[data-badge="idle"]')).toHaveTextContent('Allowed');
    expect(chip).toHaveTextContent('npm test');
    const card = document.querySelector<HTMLElement>('.helper-card[data-helper="h1"]')!;
    expect(card).toHaveTextContent('Explore');
    expect(card).toHaveTextContent('Lire le code');
    // The undecided request is pinned (task 7), never a chip.
    expect(document.querySelectorAll('.decision-chip')).toHaveLength(1);
    await user.click(thread().getByRole('button', { name: "Open Explore's thread" }));
    expect(await thread().findByText('Je lis.')).toBeVisible();
    expect(document.querySelector('.session-page')).toHaveAttribute('data-helper', 'h1');
    expect(thread().getByText('Lire le code').closest('.prompt-block')).toHaveClass('from-agent');
    expect(thread().getByText('Lire le code').closest('.prompt-block')).toHaveTextContent('Instruction from Otto');
    expect(document.querySelector('.say-row .botn')).toHaveTextContent('Explore');
    expect(thread().queryByText('Câble la liste')).toBeNull();
  });

  it('a subagent gone from the session keeps its page: named by its thread row, or waiting for the thread', async () => {
    const { d, user } = await openOtto();
    await unfoldPast(user);
    await user.click(thread().getByRole('button', { name: "Open Explore's thread" }));
    await thread().findByText('Je lis.');
    d.upsert({ ...listSessions()[0]!, helpers: [] });
    await waitFor(() => expect(document.querySelector('.say-row .botn')).toHaveTextContent('Explore'));
    expect(thread().getByText('Je lis.')).toBeVisible();
    expect(document.querySelector('.session-page')).toHaveAttribute('data-helper', 'h1');
  });

  it('a finished subagent stays in the parent thread: its card says it is done, even once gone from the session', async () => {
    const { d, user } = await openOtto();
    await unfoldPast(user);
    const card = () => document.querySelector('.helper-card[data-helper="h1"]');
    expect(card()!.querySelector('[data-badge]')).not.toHaveAttribute('data-badge', 'done');
    d.upsert({ ...listSessions()[0]!, helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'exited' }] });
    await waitFor(() => expect(card()!.querySelector('[data-badge]')).toHaveAttribute('data-badge', 'done'));
    d.upsert({ ...listSessions()[0]!, helpers: [] });
    await waitFor(() => expect(card()!.querySelector('[data-badge]')).toHaveAttribute('data-badge', 'done'));
    expect(card()).toHaveTextContent('Explore');
  });

  it('a subagent without a name of its own is « Subagent », translated', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    d.thread('otto', ottoThread().map(i => (i.kind === 'helper' ? { ...i, agentType: undefined } : i)));
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    await unfoldPast(user);
    await user.click(thread().getByRole('button', { name: "Open Explore's thread" }));
    // Gone from the session, it is named by its thread row, which has no name.
    d.upsert({ ...listSessions()[0]!, helpers: [] });
    await waitFor(() => expect(document.querySelector('.say-row .botn')).toHaveTextContent('Subagent'));
    expect(within(screen.getByRole('banner')).getByText('Subagent')).toBeVisible();
  });

  it('a subagent page before its thread came: it waits, without crashing', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(screen.getByRole('button', { name: /subagent of Otto/ }));
    expect(await thread().findByText('Loading the thread…')).toBeVisible();
    expect(document.querySelector('.session-page')).toHaveAttribute('data-helper', 'h1');
  });

  it('while the thread loads, it says so, in the reading column', async () => {
    await openOtto({ withThread: false });
    expect(await thread().findByText('Loading the thread…')).toBeVisible();
    expect(thread().getByText('Loading the thread…')).toHaveClass('thread-note');
    expect(declarations('session.css', '.session-thread>.thread-note')).toContain('max-width:var(--col);margin-inline:auto');
  });

  it('offline before the thread came: it says so', async () => {
    await openOtto({ offline: true, withThread: false });
    expect(await screen.findByText('The thread was not loaded before the connection was lost.')).toBeVisible();
  });

  it('an empty thread says so', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    d.thread('nova', []);
    await user.click(screen.getByRole('button', { name: /^Nova,/ }));
    expect(await thread().findByText('Nothing in the thread yet.')).toBeVisible();
    expect(thread().getByText('Nothing in the thread yet.')).toHaveClass('thread-note');
  });

  it('a machine that falls freezes the thread it sent: a notice on top and at the end, nothing runs live', async () => {
    const { d } = await openOtto();
    await thread().findByText('Corrige-les');
    await d.close();
    expect(await screen.findByText('Connection lost with Local')).toBeVisible();
    expect(screen.getByText('Connection lost with Local').closest('.frozen-banner')).toHaveAttribute('role', 'status');
    expect(document.querySelector('.frozen-end')).toHaveTextContent('No news since the connection was lost');
    expect(screen.queryByRole('status', { name: 'Action running' })).toBeNull();
    expect(document.querySelector('.spin')).toHaveClass('still');
    expect(thread().getByRole('button', { name: /Câble la liste/ })).toBeVisible();
  });

  it('a session that ended says so after its last exchange', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    d.thread('bix', [
      { kind: 'prompt', id: 'p', at: new Date(Date.now() - 95 * 60_000).toISOString(), turn: 1, text: 'Relis la PR' },
      { kind: 'reply', id: 'r', at: new Date(Date.now() - 90 * 60_000).toISOString(), turn: 1, text: 'Relue.' }
    ]);
    await user.click(screen.getByRole('button', { name: /^Bix,/ }));
    await thread().findByText('Relue.');
    expect(document.querySelector('.turn.current .turn-end')).toHaveTextContent(/^Session ended at \d\d:\d\d · 1 h ago/);
  });

  it('« New since your last visit » marks what arrived while away', async () => {
    const { d, user } = await openOtto();
    await thread().findByText('Corrige-les');
    expect(thread().queryByRole('separator', { name: 'New since your last visit' })).toBeNull(); // a first visit marks nothing
    await user.keyboard('{Escape}');
    d.threadItem('otto', { kind: 'message', id: 'msg-new', at: new Date().toISOString(), turn: 2, text: 'J’ai corrigé le premier test.' });
    await user.click(screen.getByRole('button', { name: /^Otto,/ }));
    const marker = await thread().findByRole('separator', { name: 'New since your last visit' });
    expect(marker.nextElementSibling).toHaveTextContent('J’ai corrigé le premier test.');
    // Frozen for the life of the page: another item does not move it.
    d.threadItem('otto', { kind: 'message', id: 'msg-newer', at: new Date(Date.now() + 1000).toISOString(), turn: 2, text: 'Et le second.' });
    await thread().findByText('Et le second.');
    expect(thread().getAllByRole('separator', { name: 'New since your last visit' })).toHaveLength(1);
    expect(thread().getByRole('separator', { name: 'New since your last visit' }).nextElementSibling).toHaveTextContent('J’ai corrigé le premier test.');
  });

  it('the reader above the end gets « Go to the latest message », which scrolls there', async () => {
    const { user } = await openOtto();
    await thread().findByText('Corrige-les');
    expect(thread().queryByRole('button', { name: 'Go to the latest message' })).toBeNull();
    const el = document.querySelector<HTMLElement>('.session-thread')!;
    let top = 0;
    const calls: ScrollToOptions[] = [];
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => { top = v; } });
    el.scrollTo = ((o: ScrollToOptions) => { calls.push(o); top = o.top ?? top; fireEvent.scroll(el); }) as typeof el.scrollTo;
    top = 200; fireEvent.scroll(el);
    await user.click(await thread().findByRole('button', { name: 'Go to the latest message' }));
    expect(calls).toEqual([{ top: 2000, behavior: 'smooth' }]);
    await waitFor(() => expect(thread().queryByRole('button', { name: 'Go to the latest message' })).toBeNull());
  });

  /** The thread with a stubbed ResizeObserver and a geometry the test drives: 500 px shown, `height` in all, read from `top`. */
  async function resizable() {
    const watched = new Set<Element>(); const calls: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { calls.push(cb); } observe(e: Element) { watched.add(e); } unobserve() {} disconnect() {} });
    await openOtto();
    await thread().findByText('Corrige-les');
    const el = document.querySelector<HTMLElement>('.session-thread')!;
    const g = { top: 1500, height: 2000 };
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.height });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => g.top, set: (v: number) => { g.top = v; } });
    const resized = () => act(() => { for (const cb of calls) cb(); });
    const latest = () => thread().queryByRole('button', { name: 'Go to the latest message' });
    return { el, g, watched, resized, latest };
  }

  it('at the end, the thread keeps the end in view when its column resizes (the pinned card comes): no button', async () => {
    try {
      const { el, g, watched, resized, latest } = await resizable();
      // The thread's column and what is in it are watched: a new item, a card that grows.
      expect(watched.has(el)).toBe(true);
      expect(watched.has(el.querySelector('.rail')!)).toBe(true);
      resized();
      expect(latest()).toBeNull();
      g.height = 2300;                                   // the pinned card came, the pane narrowed the column, an item grew
      resized();
      expect(g.top).toBe(2300);                          // still at the end
      expect(latest()).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it('higher up, growth below the view brings « Go to the latest message » and the view stays', async () => {
    try {
      const { el, g, resized, latest } = await resizable();
      g.top = 200; fireEvent.scroll(el);                 // the reader went up: not following
      expect(await thread().findByRole('button', { name: 'Go to the latest message' })).toBeVisible();
      g.height = 2300;                                   // the thread grows below the view
      resized();
      expect(latest()).toBeVisible();
      expect(g.top).toBe(200);                           // no jump
    } finally { vi.unstubAllGlobals(); }
  });

  it('the running action spins; with reduced motion the spinner holds still', async () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1'); // the suite runs with motion off
    await openOtto();
    const spin = () => thread().getByRole('status', { name: 'Action running' }).querySelector('.spin')!;
    await thread().findByRole('status', { name: 'Action running' });
    expect(spin()).not.toHaveClass('still');
    saveReduced(true);
    await waitFor(() => expect(spin()).toHaveClass('still'));
  });

  it('the clock ticks alone: a message is not rendered again', async () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    const { user } = await openOtto();
    const live = await thread().findByRole('status', { name: 'Action running' });
    await unfoldPast(user);
    await thread().findByText('Deux tests échouent.');
    const before = renders.get('Deux tests échouent.');
    const time = live.querySelector('.action-time')!.textContent;
    await waitFor(() => expect(thread().getByRole('status', { name: 'Action running' }).querySelector('.action-time')).not.toHaveTextContent(time!), { timeout: 2500 });
    expect(renders.get('Deux tests échouent.')).toBe(before);
  });

  it('a frozen thread\'s times stand still while the clock runs on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { d } = await openOtto();
    await thread().findByRole('status', { name: 'Action running' });
    await d.close();
    const banner = await screen.findByText('Connection lost with Local');
    const time = () => document.querySelector('.turn.current [data-tool="t5"] .action-time')!.textContent;
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Action running' })).toBeNull());
    const row = time();
    const since = banner.parentElement!.textContent;
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(banner.parentElement!.textContent).not.toBe(since);                                    // the clock ran: « for 13 min »
    expect(time()).toBe(row);
  });

  it('the styles port the mockup: a reading column of 760 px, 14 / 22 px text, a rail, the side pane never leaves the thread under 440 px', () => {
    expect(declarations('session.css', '.session-thread')).toContain('--col:760px');
    expect(declarations('session.css', '.msg-body')).toContain('font-size:14px;line-height:22px');
    // declarations() strips whitespace: the rule is `flex:0 0 min(var(--split),calc(100% - 440px))`.
    expect(declarations('session.css', '.side-pane')).toContain('flex:0 0 min(var(--split),calc(100% - 440px))'.replace(/\s+/g, ''));
    const css = readFileSync(resolve(__dirname, '../src/styles/session.css'), 'utf8');
    expect(css).toMatch(/@container session \(max-width:860px\)\{/);
    // The rail: a column of nodes, the row's text, its time.
    expect(declarations('session.css', '.r')).toContain('grid-template-columns:40px minmax(0,1fr) 56px'.replace(/\s+/g, ''));
    expect(readFileSync(resolve(__dirname, '../src/styles/app.css'), 'utf8')).toMatch(/@import "\.\/list\.css";\s*@import "\.\/session\.css";/);
  });
});

describe('the session memory', () => {
  it('starts empty, merges what is set, keeps a subagent apart', () => {
    const m = createSessionMemory();
    expect(m.get('otto')).toEqual({ draft: '', scroll: null, seen: null });
    m.set('otto', { seen: 't5' });
    m.set('otto', { scroll: 120 });
    expect(m.get('otto')).toEqual({ draft: '', scroll: 120, seen: 't5' });
    expect(memoKey('otto')).toBe('otto');
    expect(memoKey('otto', 'h1')).toBe('otto#h1');
    expect(m.get(memoKey('otto', 'h1'))).toEqual({ draft: '', scroll: null, seen: null });
  });
});
