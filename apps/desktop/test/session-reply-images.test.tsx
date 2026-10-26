import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { setCodecForTests } from '@ledge/ui/images';
import { boot, closeDaemons, listSessions, type MockDaemon } from './helpers';

const ID = 'a'.repeat(64);
const ID2 = 'b'.repeat(64);
const ref = (id: string) => ({ id, mime: 'image/webp' as const, width: 800, height: 600, bytes: 12_000, preview: true });

beforeEach(() => {
  // jsdom decodes no picture: a codec that draws and encodes 1 000 bytes.
  setCodecForTests({ async decode() { return { width: 800, height: 600, async draw() { return { async encode(mime: 'image/webp' | 'image/jpeg') { return new Blob([new Uint8Array(1000)], { type: mime }); } }; } }; } });
});
afterEach(async () => { setCodecForTests(null); cleanup(); localStorage.clear(); await closeDaemons(); });

const field = () => screen.getByRole('textbox', { name: 'Reply to the agent' });
const sent = (d: MockDaemon, type: string) => d.received.filter(m => m.type === type);
const chips = () => [...document.querySelectorAll('[data-chip]')];
const send = () => screen.getByRole('button', { name: 'Send' });
const png = () => new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' });
const paste = (files: File[]) => fireEvent.paste(field(), { clipboardData: { files, items: [], types: ['Files'], getData: () => '' } });

/** Answers each attachment.put: `stored` with `ID` (then ID2 …), or the failure `reason`; `hold` leaves it unanswered. */
function answerPuts(d: MockDaemon, how: { reason?: 'too_large'; hold?: boolean } = {}) {
  let n = 0;
  d.onMessage(m => {
    if (m.type !== 'attachment.put' || how.hold) return;
    d.push(how.reason ? { type: 'attachment.error', requestId: m.requestId, reason: how.reason } : { type: 'attachment.stored', requestId: m.requestId, ref: ref(n++ === 0 ? ID : ID2) });
  });
}
async function open(name: string, sessions = listSessions()) {
  const env = await boot({ sessions, list: true });
  await env.user.click(screen.getByRole('button', { name: new RegExp(`^${name},`) }));
  await waitFor(() => expect(document.querySelector('.session-reply')).not.toBeNull());
  return env;
}

describe('images in the session reply', () => {
  it('a pasted image becomes a chip, is put for the session, and a reply with empty text sends its id then clears the chips', async () => {
    const { d, user } = await open('Bix');
    answerPuts(d);
    paste([png()]);
    await waitFor(() => expect(chips()).toHaveLength(1));
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'ready'));
    expect(sent(d, 'attachment.put')).toEqual([{ type: 'attachment.put', requestId: expect.any(String), id: 'bix', image: expect.objectContaining({ mime: 'image/webp' }) }]);
    await user.click(send());
    await waitFor(() => expect(sent(d, 'session.reply')).toEqual([{ type: 'session.reply', id: 'bix', text: '', attachments: [ID] }]));
    expect(chips()).toHaveLength(0);
  });

  it('a dropped image goes the same way; a dropped file that is no image says so', async () => {
    const { d } = await open('Bix');
    answerPuts(d);
    const form = field().closest('form')!;
    const drop = createEvent.drop(form); Object.defineProperty(drop, 'dataTransfer', { value: { files: [png()], types: ['Files'] } });
    fireEvent(form, drop);
    expect(drop.defaultPrevented).toBe(true);
    await waitFor(() => expect(chips()).toHaveLength(1));
    const text = createEvent.drop(form); Object.defineProperty(text, 'dataTransfer', { value: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })], types: ['Files'] } });
    fireEvent(form, text);
    await waitFor(() => expect(screen.getByText('This file is not an image')).toBeVisible());
    expect(chips()).toHaveLength(1);
  });

  it('a drop on a shut field adds nothing', async () => {
    const omp = fakeSession('omp1', { name: 'Noor', tool: 'omp', backend: 'omp-rpc', tmuxSession: null, state: 'waiting_input', pending: { kind: 'question', text: 'Name?', source: 'rpc', tool: 'omp', requestId: 'ask1', questions: [{ id: 'n', question: 'Name?', options: [{ label: 'skip' }] }] } });
    const { d } = await open('Noor', [omp, ...listSessions()]);
    answerPuts(d);
    expect(field()).toBeDisabled();
    const form = field().closest('form')!;
    const drop = createEvent.drop(form); Object.defineProperty(drop, 'dataTransfer', { value: { files: [png()], types: ['Files'] } });
    fireEvent(form, drop);
    await new Promise(r => setTimeout(r, 100));
    expect(chips()).toHaveLength(0);
    expect(sent(d, 'attachment.put')).toEqual([]);
  });

  it('Send is disabled while the put is unanswered', async () => {
    const { d } = await open('Bix');
    answerPuts(d, { hold: true });
    paste([png()]);
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'uploading'));
    expect(send()).toBeDisabled();
  });

  it('a put refused as too large shows a red chip with the reason, and Send stays disabled until it is removed', async () => {
    const { d, user } = await open('Bix');
    answerPuts(d, { reason: 'too_large' });
    await user.type(field(), 'look');
    paste([png()]);
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'refused'));
    expect(screen.getAllByText('Image too large, even reduced').length).toBeGreaterThan(0);
    expect(send()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(chips()).toHaveLength(0);
    expect(send()).toBeEnabled();
  });

  it('a sixth image is ignored with the 5-image message', async () => {
    const { d } = await open('Bix');
    answerPuts(d);
    paste([png(), png(), png(), png(), png()]);
    await waitFor(() => expect(chips()).toHaveLength(5));
    paste([png()]);
    await waitFor(() => expect(screen.getByText('5 images per message at most')).toBeVisible());
    expect(chips()).toHaveLength(5);
  });

  it('with a question pending, a chip disables Send and says to answer the question first', async () => {
    const { d } = await open('Kit');
    answerPuts(d);
    paste([png()]);
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'ready'));
    expect(send()).toBeDisabled();
    expect(screen.getByText('Answer the question first, the image will go after')).toBeVisible();
  });

  it('a refused reply keeps the chips', async () => {
    const { d, user } = await open('Bix');
    answerPuts(d);
    paste([png()]);
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'ready'));
    await user.click(send());
    await waitFor(() => expect(sent(d, 'session.reply')).toHaveLength(1));
    d.push({ type: 'error', id: 'bix', message: 'not taken', request: 'session.reply' });
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(chips()[0]).toHaveAttribute('data-chip', 'ready');
  });

  describe('OMP: the queue taken back', () => {
    const omp = () => fakeSession('omp1', { name: 'Noor', tool: 'omp', backend: 'omp-rpc', tmuxSession: null, state: 'working' });
    it('brings the images of a restored message back as chips, from the store', async () => {
      const { d, user } = await open('Noor', [omp(), ...listSessions()]);
      d.onMessage(m => { if (m.type === 'attachment.get') d.push({ type: 'attachment.data', requestId: m.requestId, attachment: m.attachment, mime: 'image/webp', data: btoa('0123456789') }); });
      d.push({ type: 'session.queue.restored', id: 'omp1', texts: ['hurry'], entries: [{ text: 'hurry', attachments: [ID] }] });
      await waitFor(() => expect(field()).toHaveValue('hurry'));
      await waitFor(() => expect(chips()).toHaveLength(1));
      expect(sent(d, 'attachment.get')).toEqual([expect.objectContaining({ attachment: ID, id: 'omp1' })]);
      await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'ready'));
      await user.click(screen.getByRole('button', { name: 'Send after this turn' }));
      await waitFor(() => expect(sent(d, 'session.reply')).toEqual([{ type: 'session.reply', id: 'omp1', text: 'hurry', attachments: [ID] }]));
    });
    it('says the images were lost when the daemon could not put them back', async () => {
      const { d } = await open('Noor', [omp(), ...listSessions()]);
      d.push({ type: 'session.queue.restored', id: 'omp1', texts: ['hurry'], entries: [{ text: 'hurry' }], imagesDropped: true });
      await waitFor(() => expect(screen.getByText("This message's images were lost")).toBeVisible());
    });
  });
});
