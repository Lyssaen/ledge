import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import { daemonStore } from '@ledge/fleet';
import type { ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, ottoThread } from './helpers';

// Each action group counts its renders by its first action; each exchange's time mark counts the thread's renders.
const groups = vi.hoisted(() => new Map<string, number>());
const marks = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/session/ActionGroup', async importOriginal => {
  const real = await importOriginal<typeof import('../src/session/ActionGroup')>();
  return { ...real, ActionGroup: (p: Parameters<typeof real.ActionGroup>[0]) => { const id = p.tools[0]!.id; groups.set(id, (groups.get(id) ?? 0) + 1); return real.ActionGroup(p); } };
});
vi.mock('../src/session/thread', async importOriginal => {
  const real = await importOriginal<typeof import('../src/session/thread')>();
  return { ...real, timeMark: (...a: Parameters<typeof real.timeMark>) => { marks.n++; return real.timeMark(...a); } };
});

// The open document counts its renders; so does the plan card, by its intro (rendered with it, never memoised apart).
const docs = vi.hoisted(() => ({ n: 0 }));
const intros = vi.hoisted(() => ({ n: 0 }));
const INTRO = 'Préparer la release.';
vi.mock('@ledge/ui/documents/markdown', async importOriginal => {
  const real = await importOriginal<typeof import('@ledge/ui/documents/markdown')>();
  return {
    ...real,
    MarkdownDocument: (p: Parameters<typeof real.MarkdownDocument>[0]) => { docs.n++; return real.MarkdownDocument(p); },
    ThreadMarkdown: (p: Parameters<typeof real.ThreadMarkdown>[0]) => { if (p.text === 'Préparer la release.') intros.n++; return real.ThreadMarkdown(p); }
  };
});

afterEach(async () => { cleanup(); localStorage.clear(); vi.useRealTimers(); groups.clear(); marks.n = 0; docs.n = 0; intros.n = 0; await closeDaemons(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Session thread' }));
/** Otto's page with its thread (an action running in the last exchange), the page's clock held still. */
async function openOtto(extra: ThreadItem[] = []) {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const env = await boot({ sessions: listSessions(), list: true });
  env.d.thread('otto', [...ottoThread(), ...extra]);
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await thread().findByRole('status', { name: 'Action running' });
  // Settled: the thread's renders have stopped (waitFor polls with setInterval, held still here).
  for (let seen = -1; seen !== marks.n;) { seen = marks.n; await pause(150); }
  return env;
}
const pause = (ms: number) => act(() => new Promise<void>(r => setTimeout(r, ms)));
async function until(check: () => boolean) {
  for (let i = 0; i < 40 && !check(); i++) await pause(50);
  expect(check()).toBe(true);
}
const counts = () => ({ thread: marks.n, groups: Object.fromEntries(groups) });

describe('the thread renders only for what it shows', () => {
  it('a preview of another session and a chat delta leave the thread and its action groups alone', async () => {
    const { d } = await openOtto();
    expect([...groups.keys()].sort()).toEqual(['t1', 't4', 't5']);
    const before = counts();
    d.preview('nova', ['$ npm run build']);
    await until(() => daemonStore.getState().previews.get('local:nova')?.[0] === '$ npm run build');
    act(() => { daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'Je regarde' }); });
    expect(daemonStore.getState().chatLive).toEqual({ qid: 'q1', text: 'Je regarde' });
    expect(counts()).toEqual(before);
  });

  it('the clock ticks only the exchange whose action runs', async () => {
    await openOtto();
    const before = counts();
    await act(async () => { vi.advanceTimersByTime(1000); });
    const after = counts();
    expect(after.thread).toBeGreaterThan(before.thread);           // the thread took the new time…
    expect(after.groups.t5).toBeGreaterThan(before.groups.t5!);    // …the live exchange's actions count on…
    expect([after.groups.t1, after.groups.t4]).toEqual([before.groups.t1, before.groups.t4]); // …the finished exchange is left alone
  });

  it('the clock and a preview of another session leave the open document alone', async () => {
    const { d, user } = await openOtto([{ kind: 'reply', id: 'reply-2', at: new Date().toISOString(), turn: 2, text: 'Le guide est dans [docs/guide.md](docs/guide.md).' }]);
    d.documents.set('docs/guide.md', '# Guide\n\nBonjour.');
    await user.click(screen.getByRole('link', { name: 'docs/guide.md' }));
    await within(screen.getByRole('complementary', { name: 'Reading pane' })).findByText('Bonjour.');
    for (let seen = -1; seen !== docs.n;) { seen = docs.n; await pause(150); }
    const before = docs.n;
    await act(async () => { vi.advanceTimersByTime(1000); });
    d.preview('nova', ['$ npm run build']);
    await until(() => daemonStore.getState().previews.get('local:nova')?.[0] === '$ npm run build');
    expect(docs.n).toBe(before);
  });

  it('the clock and a preview of another session leave the plan card and its open plan alone', async () => {
    const plan = `# Plan : version 0.6.0\n\n${INTRO}\n\n1. Construire\n2. Publier`;
    // In the exchange whose action runs: the clock's ticks reach it.
    const { d, user } = await openOtto([{ kind: 'tool', id: 'p1', at: new Date().toISOString(), turn: 2, tool: 'ExitPlanMode', label: '# Plan : version 0.6.0', input: JSON.stringify({ plan }), status: 'running', files: [] }]);
    await user.click(thread().getByRole('button', { name: /Read the plan/ }));
    await within(screen.getByRole('complementary', { name: 'Reading pane' })).findByText('Construire');
    for (let seen = -1; seen !== docs.n + intros.n;) { seen = docs.n + intros.n; await pause(150); }
    const before = { docs: docs.n, intros: intros.n, thread: marks.n };
    await act(async () => { vi.advanceTimersByTime(1000); });
    d.preview('nova', ['$ npm run build']);
    await until(() => daemonStore.getState().previews.get('local:nova')?.[0] === '$ npm run build');
    expect(marks.n).toBeGreaterThan(before.thread);                // the thread took the tick…
    expect({ docs: docs.n, intros: intros.n }).toEqual({ docs: before.docs, intros: before.intros }); // …the plan, card and tab, did not
  });
});
