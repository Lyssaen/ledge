import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttachmentRef } from '@ledge/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '../../src/ui/ImageViewer';
import { setup } from './setup';

const ID = 'e'.repeat(64);
const REF: AttachmentRef = { id: ID, mime: 'image/png', width: 800, height: 600, bytes: 31_000, preview: true };
const nav = navigator as unknown as Record<string, unknown>;
afterEach(() => { cleanup(); delete nav.canShare; delete nav.share; vi.unstubAllGlobals(); });

async function opened() {
  const t = setup();
  render(<ImageViewer store={t.store} refs={[REF]} index={0} onIndex={() => undefined} onClose={() => undefined} />);
  await waitFor(() => expect(t.of('attachment.get')).toHaveLength(1));
  act(() => t.deliver({ type: 'attachment.data', requestId: t.of('attachment.get')[0]!.requestId, attachment: ID, mime: 'image/png', data: 'AAAA' }));
  await waitFor(() => expect(screen.getByRole('link', { name: 'Enregistrer' })).toBeInTheDocument());
}

describe('Partager', () => {
  it('is absent without navigator.canShare', async () => {
    await opened();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Partager' })).toBeNull();
  });

  it('is absent when canShare says no', async () => {
    nav.canShare = () => false; nav.share = vi.fn();
    vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob(['x']) }));
    await opened();
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: 'Partager' })).toBeNull();
  });

  it('is shown and shares the file when canShare says yes', async () => {
    const share = vi.fn(async () => undefined);
    nav.canShare = () => true; nav.share = share;
    vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob(['x']) }));
    await opened();
    fireEvent.click(await screen.findByRole('button', { name: 'Partager' }));
    expect(share).toHaveBeenCalledWith({ files: [expect.any(File)] });
  });
});
