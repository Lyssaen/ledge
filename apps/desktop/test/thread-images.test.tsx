import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { AttachmentRef, ClientMessage, ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, type MockDaemon } from './helpers';

const ref = (c: string): AttachmentRef => ({ id: c.repeat(64), mime: 'image/png', width: 1440, height: 900, bytes: 212_000, preview: true });
const A = ref('a'), B = ref('b'), C = ref('c'), D = ref('d'), E = ref('e');
const PIXEL = 'iVBORw0KGgo=';
const at = new Date(2026, 9, 26, 14, 2).toISOString();

let n = 0;
beforeEach(() => {
  localStorage.clear();
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
});
afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const gets = (d: MockDaemon) => d.received.filter((m): m is Extract<ClientMessage, { type: 'attachment.get' }> => m.type === 'attachment.get');
/** Answers every attachment.get with a pixel, except the ids in `refuse`. */
function answerGets(d: MockDaemon, refuse: string[] = []) {
  d.onMessage(m => {
    if (m.type !== 'attachment.get') return;
    d.push(refuse.includes(m.attachment) ? { type: 'attachment.error', requestId: m.requestId, reason: 'not_found' } : { type: 'attachment.data', requestId: m.requestId, attachment: m.attachment, mime: 'image/png', data: PIXEL });
  });
}
const items = (images: AttachmentRef[]): ThreadItem[] => [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Look at this', images }];
async function openNova(images: AttachmentRef[], refuse: string[] = []) {
  const env = await boot({ sessions: listSessions(), list: true });
  answerGets(env.d, refuse);
  env.d.thread('nova', items(images));
  await env.user.click(screen.getByRole('button', { name: /^Nova,/ }));
  await screen.findByText('Look at this');
  return env;
}
const thumbs = () => [...document.querySelectorAll<HTMLElement>('.prompt-images [data-thumb]')];

describe('images in the session thread', () => {
  it('a prompt with two refs shows two thumbnails once attachment.get answers, and asks for the session’s image', async () => {
    const { d } = await openNova([A, B]);
    await waitFor(() => expect(thumbs().map(t => t.dataset.thumb)).toEqual(['ready', 'ready']));
    expect(gets(d).map(m => ({ attachment: m.attachment, id: m.id, preview: m.preview }))).toEqual([{ attachment: A.id, id: 'nova', preview: true }, { attachment: B.id, id: 'nova', preview: true }]);
  });

  it('a thumbnail opens the lightbox: title, size, ArrowRight to the next, Escape closes', async () => {
    const { user } = await openNova([A, B]);
    await waitFor(() => expect(thumbs()).toHaveLength(2));
    await waitFor(() => expect(thumbs()[0]).toHaveAttribute('data-thumb', 'ready'));
    await user.click(thumbs()[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Capture · You, 14:02' });
    expect(dialog).toHaveTextContent('1440×900 · 212 KB · 1/2');
    await user.keyboard('{ArrowRight}');
    expect(dialog).toHaveTextContent('2/2');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the lightbox offers Copier and Enregistrer… with a capture-HHMM name', async () => {
    const { user } = await openNova([A]);
    await waitFor(() => expect(thumbs()[0]).toHaveAttribute('data-thumb', 'ready'));
    await user.click(thumbs()[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Save…' })).toHaveAttribute('download', 'capture-1402.png');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('an attachment.error shows « Image unavailable »', async () => {
    await openNova([D, E], [E.id]);
    await waitFor(() => expect(thumbs().map(t => t.dataset.thumb)).toEqual(['ready', 'failed']));
    expect(thumbs()[1]).toHaveTextContent('Image unavailable');
  });
});

describe('images in a chat turn', () => {
  it('a turn with attachments asks that machine for its images, above the question', async () => {
    const { d, user, client } = await boot({ sessions: listSessions(), list: true });
    answerGets(d);
    // What the app hands the fleet. The fleet stamps each turn with the machine its daemon is (here the one fake daemon, `local`) and routes by it.
    const send = vi.spyOn(client, 'send');
    await user.keyboard('{Control>}/{/Control}');
    await screen.findByRole('complementary', { name: 'Chat Ledge' });
    // Asked now: the fleet keeps only the day's chat turns, so a fixed date would only pass on that day.
    d.push({ type: 'chat.history', turns: [{ qid: 'q-img', question: 'What do you see?', askedAt: new Date().toISOString(), steps: [], attachments: [C], machineId: 'elsewhere' }] });
    await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'attachment.get', attachment: C.id, machine: 'local', preview: true })));
    await waitFor(() => expect(document.querySelector('[data-turn] [data-thumb="ready"]')).not.toBeNull());
  });
});

describe('the same image attached twice', () => {
  it('shows two thumbnails without a duplicate-key warning, and each opens its own slot', async () => {
    const F = ref('f');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = await openNova([F, F]);
    await waitFor(() => expect(thumbs().map(t => t.dataset.thumb)).toEqual(['ready', 'ready']));
    await user.click(thumbs()[1]!);
    expect(await screen.findByRole('dialog')).toHaveTextContent('2/2');
    expect(warn.mock.calls.filter(c => String(c[0]).includes('same key'))).toEqual([]);
    warn.mockRestore();
  });
});

describe('captures on tool rows', () => {
  const tool = (id: string, extra: Partial<Extract<ThreadItem, { kind: 'tool' }>> = {}): ThreadItem => ({ kind: 'tool', id, at, turn: 1, tool: 'mcp__browser__screenshot', label: 'screenshot', status: 'success', files: [], ...extra } as ThreadItem);
  const open = async (list: ThreadItem[]) => {
    const env = await boot({ sessions: listSessions(), list: true });
    answerGets(env.d);
    env.d.thread('nova', [{ kind: 'prompt', id: 'p1', at, turn: 1, text: 'Look at this' }, ...list]);
    await env.user.click(screen.getByRole('button', { name: /^Nova,/ }));
    await screen.findByText('Look at this');
    return env;
  };

  const rowCaptures = () => [...document.querySelectorAll<HTMLElement>('.action-captures [data-thumb="ready"]')];

  it('shows a tool row capture with its size; a click opens the Browser tab, whose « Enlarge » opens the lightbox', async () => {
    const { user } = await open([tool('u1', { images: [A] })]);
    await waitFor(() => expect(rowCaptures()).toHaveLength(1));
    expect(document.querySelector('.action-captures [data-thumb-size]')).toHaveTextContent('1440×900');
    await user.click(rowCaptures()[0]!);
    const pane = within(screen.getByRole('complementary', { name: 'Reading pane' }));
    expect(pane.getByText('Browser')).toBeVisible();
    await user.click(within(document.querySelector<HTMLElement>('.browser-meta')!).getByRole('button', { name: 'Enlarge' }));
    expect(await screen.findByRole('dialog', { name: 'Capture · Nova, 14:02' })).toBeInTheDocument();
  });

  it('shows the captures of a folded group', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => tool(`g${i}`, i === 1 ? { images: [A] } : i === 5 ? { images: [B] } : {}));
    await open(rows);
    await waitFor(() => expect(rowCaptures()).toHaveLength(2));
  });

  it('says when a capture was too large', async () => {
    await open([tool('u1', { imagesDropped: true })]);
    expect(await screen.findByText('Capture too large for Ledge')).toBeVisible();
  });
});
