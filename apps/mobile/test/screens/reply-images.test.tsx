import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttachmentRef } from '@ledge/protocol';
import { setCodecForTests } from '@ledge/ui/images';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Thread } from '../../src/screens/Thread';
import { pending, session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const ID = 'c'.repeat(64);
const REF: AttachmentRef = { id: ID, mime: 'image/webp', width: 800, height: 600, bytes: 31_000, preview: true };

beforeEach(() => {
  setCodecForTests({ async decode() { return { width: 800, height: 600, async draw() { return { async encode(mime: 'image/webp' | 'image/jpeg') { return new Blob([new Uint8Array(1000)], { type: mime }); } }; } }; } });
});
afterEach(() => { setCodecForTests(null); cleanup(); });

const png = () => new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
const chips = () => [...document.querySelectorAll<HTMLElement>('[data-chip]')];
const fileInput = () => document.querySelector<HTMLInputElement>('input[type=file][accept="image/*"][multiple]')!;
const send = () => screen.getByRole('button', { name: 'Envoyer à Kai' });
const field = () => screen.getByLabelText('Message pour Kai');

function opened(items: unknown[] = [], extra = {}) {
  const t = setup();
  t.deliver(snapshot([session('a', { name: 'Kai', topic: 'Inbox mobile', ...extra })]));
  render(<Thread store={t.store} sessionId="a" storage={t.storage} />);
  act(() => t.deliver({ type: 'session.thread', id: 'a', items: items as never, cut: [], more: false }));
  return t;
}
/** The PC stores the nth put. */
async function stored(t: ReturnType<typeof opened>, n: number, ref = REF) {
  await waitFor(() => expect(t.of('attachment.put')).toHaveLength(n));
  act(() => t.deliver({ type: 'attachment.stored', requestId: t.of('attachment.put')[n - 1]!.requestId, ref }));
}

describe('attaching to a reply', () => {
  it('a file chosen through the hidden input becomes a 72 px chip and is put', async () => {
    const t = opened();
    expect(screen.getByRole('button', { name: 'Joindre une image' })).toBeEnabled();
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    await waitFor(() => expect(chips()).toHaveLength(1));
    expect(chips()[0]!.style.width).toBe('72px');
    await stored(t, 1);
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'ready'));
  });

  it('a pasted image does the same and a text paste is left alone', async () => {
    const t = opened();
    const text = fireEvent.paste(field(), { clipboardData: { files: [] } });
    expect(text).toBe(true);
    expect(fireEvent.paste(field(), { clipboardData: { files: [png()] } })).toBe(false);
    await waitFor(() => expect(chips()).toHaveLength(1));
    await stored(t, 1);
    expect(t.of('attachment.put')).toHaveLength(1);
  });

  it('Send with only the chip sends the reply with its id', async () => {
    const t = opened();
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    await stored(t, 1);
    await waitFor(() => expect(send()).toBeEnabled());
    fireEvent.click(send());
    expect(t.of('session.reply')).toMatchObject([{ id: 'a', text: '', attachments: [ID], expect: null }]);
    expect(chips()).toHaveLength(0);
  });

  it('Send is disabled while the image uploads', async () => {
    const t = opened();
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'uploading'));
    expect(send()).toBeDisabled();
    await stored(t, 1);
    await waitFor(() => expect(send()).toBeEnabled());
  });

  it('a refused put shows the reason, keeps Send disabled until the chip is removed', async () => {
    const t = opened();
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    await waitFor(() => expect(t.of('attachment.put')).toHaveLength(1));
    act(() => t.deliver({ type: 'attachment.error', requestId: t.of('attachment.put')[0]!.requestId, reason: 'too_large' }));
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'refused'));
    expect(screen.getAllByText('Image trop lourde, même réduite').length).toBeGreaterThan(0);
    expect(send()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: "Retirer l'image" }));
    expect(chips()).toHaveLength(0);
  });

  it('a question arriving while a chip waits disables Send and says to answer first', async () => {
    const t = opened();
    fireEvent.change(fileInput(), { target: { files: [png()] } });
    await stored(t, 1);
    await waitFor(() => expect(chips()[0]).toHaveAttribute('data-chip', 'ready'));
    act(() => t.deliver({ type: 'session.updated', session: session('a', { name: 'Kai', state: 'waiting_input', pending: pending({ kind: 'question', text: 'Quel nom ?' }) }) }));
    expect(send()).toBeDisabled();
    expect(screen.getByText("Répondez d'abord à la question, l'image partira après")).toBeInTheDocument();
  });
});

describe('an image in the thread', () => {
  const prompt = (images: AttachmentRef[]) => ({ kind: 'prompt', id: 'p1', at: '2026-10-14T10:00:00.000Z', turn: 1, text: '', images });

  it('shows its preview at 240 px, and a tap opens the full image', async () => {
    const t = opened([prompt([REF])]);
    await waitFor(() => expect(t.of('attachment.get')).toHaveLength(1));
    expect(t.of('attachment.get')[0]).toMatchObject({ attachment: ID, preview: true });
    act(() => t.deliver({ type: 'attachment.data', requestId: t.of('attachment.get')[0]!.requestId, attachment: ID, mime: 'image/webp', data: 'AAAA' }));
    const thumb = await waitFor(() => { const el = document.querySelector<HTMLElement>('[data-thumb=ready]'); expect(el).not.toBeNull(); return el!; });
    expect(thumb.style.width).toBe('240px');
    fireEvent.click(thumb);
    await waitFor(() => expect(t.of('attachment.get')).toHaveLength(2));
    expect(t.of('attachment.get')[1]!.preview).toBeFalsy();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => t.deliver({ type: 'attachment.data', requestId: t.of('attachment.get')[1]!.requestId, attachment: ID, mime: 'image/webp', data: 'AAAA' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Enregistrer' })).toHaveAttribute('download'));
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a ref without a preview says it is too heavy for the phone and fetches nothing', () => {
    const t = opened([prompt([{ ...REF, preview: false }])]);
    expect(screen.getByText('Image trop lourde pour le téléphone · ouvrir sur le PC')).toBeInTheDocument();
    expect(t.of('attachment.get')).toEqual([]);
  });

  it('a failed fetch says the image is unavailable', async () => {
    const t = opened([prompt([REF])]);
    await waitFor(() => expect(t.of('attachment.get')).toHaveLength(1));
    act(() => t.deliver({ type: 'attachment.error', requestId: t.of('attachment.get')[0]!.requestId, reason: 'not_found' }));
    await waitFor(() => expect(screen.getByText('Image indisponible')).toBeInTheDocument());
  });
});
