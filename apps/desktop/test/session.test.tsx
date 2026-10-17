import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { SPINNER, SPINNER_STILL } from '@ledge/ui/thread/tools';
import { boot, closeDaemons, declarations, listSessions, ottoThread } from './helpers';
import { createSessionMemory, memoKey } from '../src/session/memory';
import { saveReduced } from '../src/motionPreferences';

// Each message's Markdown counts its renders (the real reader still renders): the page's ticks must spare it.
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock('@ledge/ui/documents/markdown', async importOriginal => {
  const real = await importOriginal<typeof import('@ledge/ui/documents/markdown')>();
  return { ...real, ThreadMarkdown: (p: Parameters<typeof real.ThreadMarkdown>[0]) => { renders.set(p.text, (renders.get(p.text) ?? 0) + 1); return real.ThreadMarkdown(p); } };
});

afterEach(async () => { cleanup(); localStorage.clear(); saveReduced(false); vi.unstubAllEnvs(); vi.useRealTimers(); renders.clear(); await closeDaemons(); });

const thread = () => within(screen.getByRole('region', { name: 'Session thread' }));
async function openOtto(o: { offline?: boolean; withThread?: boolean } = {}) {
  const sessions = listSessions().map(s => (s.name === 'Otto' && o.offline ? { ...s, offline: true } : s));
  const env = await boot({ sessions, list: true });
  if (o.withThread !== false) env.d.thread('otto', ottoThread());
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  return env;
}

describe('the session page', () => {
  it('the page replaces the pending place: one exchange per prompt, your prompt as a bubble, the agent named once', async () => {
    await openOtto();
    expect(screen.queryByText('This screen is coming soon.')).toBeNull();
    expect(await thread().findByText('Câble la liste')).toBeVisible();
    expect(thread().getByText('Câble la liste').closest('.prompt-block')).toHaveTextContent('You');
    expect(document.querySelectorAll('.session-thread .turn')).toHaveLength(2);
    expect(document.querySelectorAll('.session-thread .turn-author')).toHaveLength(2);
    expect(thread().getByText('Deux tests échouent.').closest('.ledge-thread-md')).not.toBeNull();
    expect(document.querySelector('.pane-meta')).toHaveTextContent('Local · ledge');
    expect(document.querySelector('.session-page')).toHaveAttribute('data-session', 'local:otto'); // the fleet qualifies ids with the machine
    expect(document.querySelector('.session-page')).not.toHaveAttribute('data-helper');
  });

  it('actions fold into a summary that unfolds; a failure stays visible; the running one shows live', async () => {
    const { user } = await openOtto();
    const summary = await thread().findByRole('button', { name: /^3 actions/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary).toHaveTextContent('· 1 file changed');
    expect(summary).toHaveTextContent('0.9 s');
    expect([...summary.querySelectorAll('.kind-chip')].map(c => c.getAttribute('title'))).toEqual(['1 read', '1 search', '1 edit']);
    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect([...document.querySelectorAll('.action-list:not(.compact) .action-verb')].map(e => e.textContent)).toEqual(['Read', 'Search', 'Edit']);
    const failed = document.querySelector<HTMLElement>('.action-row.status-failed')!;
    expect(failed.closest('.action-list')).toHaveClass('compact');
    expect(within(failed).getByLabelText('Failed')).toHaveTextContent('✕');
    await user.click(within(failed).getByRole('button', { name: 'npm test' }));
    expect(within(failed).getByText('exit 1')).toHaveClass('action-output', 'is-error');
    const live = thread().getByRole('status', { name: 'Action running' });
    expect(live).toHaveTextContent('npm test');
    expect(live.closest('.turn')!.querySelector('.turn-live')).toHaveTextContent('running');
    // Only running actions: no summary over the live line.
    expect(live.closest('.action-group')!.querySelector('.action-summary')).toBeNull();
  });

  it('running actions end live: a result replaces its row in place, the live line gives way to the summary', async () => {
    const { d } = await openOtto();
    await thread().findByRole('status', { name: 'Action running' });
    const t5 = ottoThread().at(-1)! as Extract<ThreadItem, { kind: 'tool' }>;
    const t6 = { ...t5, id: 't6', tool: 'Read', label: '/w/ledge/src/List.tsx', at: new Date().toISOString() };
    d.threadItem('otto', t6);                                                            // a second action starts beside the first
    d.threadItem('otto', { ...t5, status: 'success', durationMs: 3000, output: 'ok' });  // then the first one's result comes
    const summary = () => document.querySelector('.turn.current .action-summary');
    await waitFor(() => expect(summary()).toHaveTextContent(/^2 actions.*running · /));
    expect(thread().getByRole('status', { name: 'Action running' })).toHaveTextContent('Readsrc/List.tsx');
    // The mock daemon stores the re-sent item where it was, as the daemon's store does.
    expect(d.threads.get('otto')!.map(i => i.id)).toEqual([...ottoThread().map(i => i.id), 't6']);
    d.threadItem('otto', { ...t6, status: 'success', durationMs: 1000 });
    await waitFor(() => expect(summary()).toHaveTextContent(/^2 actions.*4\.0 s$/));
    expect(thread().queryByRole('status', { name: 'Action running' })).toBeNull();
    expect(document.querySelector('.turn-live')).toBeNull();
  });

  it('past decisions are chips; a subagent is a card that opens its own thread', async () => {
    const { user } = await openOtto();
    await thread().findByText('Allowed');
    expect(document.querySelector('.decision-chip.accept')).toHaveTextContent('✓Allowednpm test');
    // The undecided request is pinned (task 7), never a chip.
    expect(document.querySelectorAll('.decision-chip')).toHaveLength(1);
    await user.click(thread().getByRole('button', { name: 'Open Explore: Lire le code' }));
    expect(await thread().findByText('Je lis.')).toBeVisible();
    expect(document.querySelector('.session-page')).toHaveAttribute('data-helper', 'h1');
    expect(thread().getByText('Lire le code').closest('.prompt-block')).toHaveClass('from-agent');
    expect(thread().getByText('Lire le code').closest('.prompt-block')).toHaveTextContent('Instruction from Otto');
    expect(document.querySelector('.turn-author')).toHaveTextContent('Explore');
    expect(thread().queryByText('Câble la liste')).toBeNull();
  });

  it('a subagent gone from the session keeps its page: named by its thread row, or waiting for the thread', async () => {
    const { d, user } = await openOtto();
    await user.click(await thread().findByRole('button', { name: 'Open Explore: Lire le code' }));
    await thread().findByText('Je lis.');
    d.upsert({ ...listSessions()[0]!, helpers: [] });
    await waitFor(() => expect(document.querySelector('.helper-card, .turn-author')).toHaveTextContent('Explore'));
    expect(thread().getByText('Je lis.')).toBeVisible();
    expect(document.querySelector('.session-page')).toHaveAttribute('data-helper', 'h1');
  });

  it('a subagent page before its thread came: it waits, without crashing', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true });
    await user.click(within(screen.getByRole('listitem', { name: /^Otto,/ })).getByRole('button', { name: 'Show 1 subagent' }));
    await user.click(screen.getByRole('listitem', { name: /subagent of Otto/ }));
    expect(await thread().findByText('Loading the thread…')).toBeVisible();
    expect(document.querySelector('.session-page')).toHaveAttribute('data-helper', 'h1');
  });

  it('while the thread loads, it says so', async () => {
    await openOtto({ withThread: false });
    expect(await thread().findByText('Loading the thread…')).toBeVisible();
  });

  it('offline before the thread came: it says so', async () => {
    await openOtto({ offline: true, withThread: false });
    expect(await screen.findByText('The thread was not loaded before the connection was lost.')).toBeVisible();
  });

  it('an empty thread says so', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    d.thread('nova', []);
    await user.click(screen.getByRole('listitem', { name: /^Nova,/ }));
    expect(await thread().findByText('Nothing in the thread yet.')).toBeVisible();
  });

  it('a machine that falls freezes the thread it sent: a notice on top and at the end, nothing runs live', async () => {
    const { d } = await openOtto();
    await thread().findByText('Corrige-les');
    await d.close();
    expect(await screen.findByText('Connection lost with Local')).toBeVisible();
    expect(screen.getByText('Connection lost with Local').closest('.frozen-banner')).toHaveAttribute('role', 'status');
    expect(document.querySelector('.frozen-end')).toHaveTextContent('No news since the connection was lost');
    expect(screen.queryByRole('status', { name: 'Action running' })).toBeNull();
    expect(document.querySelector('.turn-live')).toBeNull();
    expect(thread().getByText('Câble la liste')).toBeVisible();
  });

  it('a session that ended says so after its last exchange', async () => {
    const { d, user } = await boot({ sessions: listSessions(), list: true });
    d.thread('bix', [
      { kind: 'prompt', id: 'p', at: new Date(Date.now() - 95 * 60_000).toISOString(), turn: 1, text: 'Relis la PR' },
      { kind: 'reply', id: 'r', at: new Date(Date.now() - 90 * 60_000).toISOString(), turn: 1, text: 'Relue.' }
    ]);
    await user.click(screen.getByRole('listitem', { name: /^Bix,/ }));
    await thread().findByText('Relue.');
    expect(document.querySelector('.turn.current .turn-end')).toHaveTextContent('Session ended · 1 h ago');
  });

  it('« New since your last visit » marks what arrived while away', async () => {
    const { d, user } = await openOtto();
    await thread().findByText('Corrige-les');
    expect(thread().queryByRole('separator', { name: 'New since your last visit' })).toBeNull(); // a first visit marks nothing
    await user.keyboard('{Escape}');
    d.threadItem('otto', { kind: 'message', id: 'msg-new', at: new Date().toISOString(), turn: 2, text: 'J’ai corrigé le premier test.' });
    await user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
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

  it('the running action spins; with reduced motion the spinner holds still', async () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1'); // the suite runs with motion off
    await openOtto();
    const mark = () => thread().getByRole('status', { name: 'Action running' }).querySelector('.action-mark')!.textContent!;
    await thread().findByRole('status', { name: 'Action running' });
    const first = mark();
    expect(SPINNER).toContain(first);
    await waitFor(() => expect(mark()).not.toBe(first));
    saveReduced(true);
    await waitFor(() => expect(mark()).toBe(SPINNER_STILL));
  });

  it('the spinner and the clock tick alone: a message is not rendered again', async () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    await openOtto();
    const live = await thread().findByRole('status', { name: 'Action running' });
    await thread().findByText('Deux tests échouent.');
    const before = renders.get('Deux tests échouent.');
    const mark = () => thread().getByRole('status', { name: 'Action running' }).querySelector('.action-mark')!.textContent!;
    const time = live.querySelector('.action-time')!.textContent;
    const frames = new Set([mark()]);
    await waitFor(() => { frames.add(mark()); expect(frames.size).toBeGreaterThan(2); });      // the spinner turns…
    await waitFor(() => expect(thread().getByRole('status', { name: 'Action running' }).querySelector('.action-time')).not.toHaveTextContent(time!), { timeout: 2500 }); // …and the clock ticked
    expect(renders.get('Deux tests échouent.')).toBe(before);
  });

  it('a frozen thread\'s times stand still while the clock runs on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { d } = await openOtto();
    await thread().findByRole('status', { name: 'Action running' });
    await d.close();
    const banner = await screen.findByText('Connection lost with Local');
    const group = () => document.querySelector('.turn.current .action-group')!;
    await waitFor(() => expect(group().querySelector('.action-summary')).not.toBeNull());
    fireEvent.click(group().querySelector('.action-summary')!);
    const summary = group().querySelector('.action-summary')!.textContent;
    const row = group().querySelector('.action-row .action-time')!.textContent;
    const since = banner.parentElement!.textContent;
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(banner.parentElement!.textContent).not.toBe(since);                                    // the clock ran: « for 13 min »
    expect(group().querySelector('.action-summary')!.textContent).toBe(summary);
    expect(group().querySelector('.action-row .action-time')!.textContent).toBe(row);
  });

  it('the styles port the mockup: a reading column of 760 px, 14 / 23 px text, the side pane never leaves the thread under 440 px', () => {
    expect(declarations('session.css', '.session-thread')).toContain('--col:760px');
    expect(declarations('session.css', '.msg-body')).toContain('font-size:14px;line-height:23px');
    // declarations() strips whitespace: the rule is `flex:0 0 min(var(--split),calc(100% - 440px))`.
    expect(declarations('session.css', '.side-pane')).toContain('flex:0 0 min(var(--split),calc(100% - 440px))'.replace(/\s+/g, ''));
    const css = readFileSync(resolve(__dirname, '../src/styles/session.css'), 'utf8');
    expect(css).toMatch(/@container session \(max-width:860px\)\{/);
    // A flat thread only: the folded-turn rules are not ported.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.turn-head|\.turn-toggle|\.turn\.folded|\.folded-note/);
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
