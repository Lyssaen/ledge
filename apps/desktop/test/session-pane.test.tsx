import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, renderHook, screen, within } from '@testing-library/react';
import type { DaemonClient, DaemonStatus } from '@ledge/fleet';
import type { ClientMessage, ServerMessage, ThreadItem } from '@ledge/protocol';
import { DOCUMENT_TIMEOUT_MS, useDocument } from '../src/session/useDocument';
import { docRefs } from '../src/session/thread';
import { besideDoc } from '../src/session/SidePane';
import { boot, closeDaemons, listSessions, ottoThread } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); vi.useRealTimers(); await closeDaemons(); });

const side = () => within(screen.getByRole('complementary', { name: 'Reading pane' }));
const withDoc: ThreadItem[] = [{ kind: 'reply', id: 'reply-2', at: new Date().toISOString(), turn: 2, text: 'Le guide est dans [docs/guide.md](docs/guide.md).' }];
async function openOtto(extra: ThreadItem[] = withDoc) {
  const env = await boot({ sessions: listSessions(), list: true });
  env.d.thread('otto', [...ottoThread(), ...extra]);
  env.d.documents.set('docs/guide.md', '---\ntitle: Guide de Ledge\n---\n# Guide\n\nBonjour.');
  await env.user.click(screen.getByRole('listitem', { name: /^Otto,/ }));
  await screen.findByText('Câble la liste');
  return env;
}

it('a document link opens beside the thread; the thread stays usable; Escape closes the tab, then leaves the page', async () => {
  const { user } = await openOtto();
  await user.click(screen.getByRole('link', { name: 'docs/guide.md' }));
  expect(await side().findByText('Bonjour.')).toBeVisible();
  expect(side().getByText('Guide de Ledge')).toBeVisible();
  expect(side().getByText('docs/guide.md', { selector: 'code' })).toBeVisible();
  await user.click(screen.getByRole('textbox', { name: 'Reply to the agent' }));
  await user.keyboard('ok');
  expect(screen.getByRole('textbox', { name: 'Reply to the agent' })).toHaveValue('ok');
  (document.activeElement as HTMLElement).blur();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('complementary', { name: 'Reading pane' })).toBeNull();
  expect(document.querySelector('.session-page')).not.toBeNull();
  await user.keyboard('{Escape}');
  expect(document.querySelector('.session-page')).toBeNull();
});
it('a document card under the message; several items become closable tabs; « View the change » opens a diff tab J / K walk', async () => {
  const { user } = await openOtto([...withDoc, { kind: 'tool', id: 'w1', at: new Date().toISOString(), turn: 2, tool: 'Write', label: '/w/ledge/docs/guide.md', status: 'success', files: [{ path: '/w/ledge/docs/guide.md', change: 'write', diff: '+ # Guide' }] }]);
  await user.click(screen.getByRole('button', { name: /guide\.md.*Read/ }));
  await user.click(screen.getByRole('button', { name: /^3 actions/ }));
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="t3"]')!).getByRole('button', { name: 'View the change' }));
  expect(side().getAllByRole('tab').map(t => t.textContent)).toEqual(['guide.md', '± App.tsx']);
  expect(side().getByRole('tab', { name: '± App.tsx' })).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('j');
  expect(side().getByRole('tab', { name: '± guide.md' })).toHaveAttribute('aria-selected', 'true');
  await user.click(side().getByRole('button', { name: 'Close ± guide.md' }));
  expect(side().queryAllByRole('tab')).toHaveLength(0);                              // one tab left: no tab bar
  expect(side().getByText('Guide de Ledge')).toBeVisible();
});
it('« All changes » opens the Changes view on that file; the pane waits under it, back on the thread', async () => {
  const { user } = await openOtto();
  await user.click(screen.getByRole('button', { name: /^3 actions/ }));
  await user.click(within(document.querySelector<HTMLElement>('[data-tool="t3"]')!).getByRole('button', { name: 'View the change' }));
  expect(side().getByText('Change · App.tsx')).toBeVisible();
  expect(side().getByText('1 / 1')).toHaveClass('file-pos');
  expect([...document.querySelectorAll('.side-diff .diff-line .code')].map(c => c.textContent)).toEqual(['a', 'b']);
  await user.click(side().getByRole('button', { name: 'All changes' }));
  expect(screen.getByRole('tab', { name: /^Changes/ })).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('.file-title code')).toHaveTextContent('src/App.tsx');
  expect(screen.queryByRole('complementary', { name: 'Reading pane' })).toBeNull();
  await user.click(screen.getByRole('tab', { name: /^Thread/ }));
  expect(side().getByText('Change · App.tsx')).toBeVisible();
});
it('Enlarge and the keyboard on the handle move the split, bounded and remembered', async () => {
  const { user } = await openOtto();
  await user.click(screen.getByRole('link', { name: 'docs/guide.md' }));
  await user.click(side().getByRole('button', { name: /^Enlarge/ }));
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.65);
  screen.getByRole('separator', { name: 'Resize the pane' }).focus();
  await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.72);
  await user.dblClick(screen.getByRole('separator', { name: 'Resize the pane' }));
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.5);
});
it('dragging the handle gives the pane what lies right of the pointer, bounded; letting go ends it', async () => {
  const { user } = await openOtto();
  await user.click(screen.getByRole('link', { name: 'docs/guide.md' }));
  const handle = screen.getByRole('separator', { name: 'Resize the pane' });
  const split = handle.parentElement!;
  expect(split).toHaveClass('session-split', 'has-pane');
  vi.spyOn(split, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, width: 1000, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}) });
  const move = (clientX: number) => act(() => { handle.dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true })); });
  fireEvent.pointerDown(handle, { pointerId: 1 });
  move(400);
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.6);
  expect(split.style.getPropertyValue('--split')).toBe('60%');
  move(100);
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.72);
  fireEvent.pointerUp(handle, { pointerId: 1 });
  move(500);
  expect(JSON.parse(localStorage.getItem('desktop.session')!).split).toBe(0.72);
});
it('a document that does not come says why, and Escape closes its tab', async () => {
  const { user } = await openOtto([{ kind: 'reply', id: 'reply-2', at: new Date().toISOString(), turn: 2, text: 'Voir [le plan](docs/absent.md).' }]);
  await user.click(screen.getByRole('link', { name: 'le plan' }));
  expect(await side().findByText('Document not found.')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('complementary', { name: 'Reading pane' })).toBeNull();
});

describe('docRefs', () => {
  it('the Markdown files a message names or links, distinct, in order, three at most', () => {
    expect(docRefs('Le guide est dans [docs/guide.md](docs/guide.md).')).toEqual(['docs/guide.md']);
    expect(docRefs('Voir a.md, puis [b](docs/b.md#usage) et c.md:3, d.md et e.md.')).toEqual(['a.md', 'docs/b.md', 'c.md']);
    expect(docRefs('Rien à lire ici, ni https://x.y/z.md.')).toEqual([]);
  });
});

describe('besideDoc', () => {
  it('a link inside a document is read from beside it', () => {
    expect(besideDoc('docs/guide.md', 'usage.md')).toBe('docs/usage.md');
    expect(besideDoc('docs/guide.md', '../README.md')).toBe('README.md');
    expect(besideDoc('docs/a/guide.md', './b/../c.md')).toBe('docs/a/c.md');
    expect(besideDoc('/w/ledge/docs/guide.md', '../../../../x.md')).toBe('/x.md');
    expect(besideDoc('guide.md', '../x.md')).toBe('../x.md');
    expect(besideDoc('docs/guide.md', '/etc/notes.md')).toBe('/etc/notes.md');
  });
});

/** A client whose sends are recorded and whose replies the test pushes. */
function fakeClient(status: DaemonStatus = 'open') {
  const sent: ClientMessage[] = [];
  const msgFns = new Set<(m: ServerMessage) => void>();
  const statusFns = new Set<(s: DaemonStatus) => void>();
  const client: DaemonClient = {
    connect() {}, close() {}, send: m => { sent.push(m); }, status: () => status,
    onMessage: f => { msgFns.add(f); return () => { msgFns.delete(f); }; },
    onStatus: f => { statusFns.add(f); return () => { statusFns.delete(f); }; }
  } as DaemonClient;
  const push = (m: ServerMessage) => act(() => { for (const f of [...msgFns]) f(m); });
  return { client, sent, push };
}
const requestOf = (sent: ClientMessage[]) => {
  const m = sent.at(-1);
  if (m?.type !== 'document.read') throw new Error('no document.read');
  return m;
};

describe('useDocument', () => {
  it('reads the document for the session, the reply correlated by its requestId; the front matter gives the title', () => {
    const { client, sent, push } = fakeClient();
    const { result } = renderHook(() => useDocument(client, 'local:otto', 'docs/guide.md', true));
    expect(result.current).toEqual({ status: 'loading' });
    const req = requestOf(sent);
    expect(req).toMatchObject({ type: 'document.read', path: 'docs/guide.md', sessionId: 'local:otto' });
    push({ type: 'document.content', requestId: `${req.requestId}-other`, path: 'docs/guide.md', text: 'autre', bytes: 5, modifiedAt: new Date().toISOString() });
    expect(result.current).toEqual({ status: 'loading' });
    push({ type: 'document.content', requestId: req.requestId, path: 'docs/guide.md', text: '---\ntitle: Guide\n---\nBonjour', bytes: 10, modifiedAt: new Date().toISOString() });
    expect(result.current).toEqual({ status: 'ready', text: '---\ntitle: Guide\n---\nBonjour', title: 'Guide' });
  });
  it('offline: an offline error, nothing sent', () => {
    const { client, sent } = fakeClient();
    const { result } = renderHook(() => useDocument(client, 'local:otto', 'docs/guide.md', false));
    expect(result.current).toEqual({ status: 'error', code: 'offline' });
    expect(sent).toEqual([]);
  });
  it('a daemon not connected is offline too, nothing sent', () => {
    const { client, sent } = fakeClient('unreachable');
    const { result } = renderHook(() => useDocument(client, 'local:otto', 'docs/guide.md', true));
    expect(result.current).toEqual({ status: 'error', code: 'offline' });
    expect(sent).toEqual([]);
  });
  it('no reply within DOCUMENT_TIMEOUT_MS: a timeout', () => {
    vi.useFakeTimers();
    const { client } = fakeClient();
    const { result } = renderHook(() => useDocument(client, 'local:otto', 'docs/guide.md', true));
    act(() => { vi.advanceTimersByTime(DOCUMENT_TIMEOUT_MS - 1); });
    expect(result.current).toEqual({ status: 'loading' });
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual({ status: 'error', code: 'timeout' });
  });
  it('a daemon error comes back as is', () => {
    const { client, sent, push } = fakeClient();
    const { result } = renderHook(() => useDocument(client, 'local:otto', 'docs/big.md', true));
    push({ type: 'document.error', requestId: requestOf(sent).requestId, path: 'docs/big.md', code: 'too_large' });
    expect(result.current).toEqual({ status: 'error', code: 'too_large' });
  });
  it('another path: loading again, and the first reply no longer counts', () => {
    const { client, sent, push } = fakeClient();
    const { result, rerender } = renderHook(({ path }) => useDocument(client, 'local:otto', path, true), { initialProps: { path: 'a.md' } });
    const first = requestOf(sent);
    rerender({ path: 'b.md' });
    expect(result.current).toEqual({ status: 'loading' });
    push({ type: 'document.content', requestId: first.requestId, path: 'a.md', text: 'A', bytes: 1, modifiedAt: new Date().toISOString() });
    expect(result.current).toEqual({ status: 'loading' });
    push({ type: 'document.content', requestId: requestOf(sent).requestId, path: 'b.md', text: 'B', bytes: 1, modifiedAt: new Date().toISOString() });
    expect(result.current).toEqual({ status: 'ready', text: 'B' });
  });
});
