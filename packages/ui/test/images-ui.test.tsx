import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentChips } from '../src/images/AttachmentChips';
import { ImageThumb } from '../src/images/ImageThumb';
import { Lightbox } from '../src/images/Lightbox';

const item = (over = {}) => ({ key: 'a', url: 'blob:a', width: 1440, height: 900, bytes: 212_345, state: 'ready' as const, ...over });

describe('AttachmentChips', () => {
  it('shows a spinner while uploading and the size once ready', () => {
    const { rerender } = render(<AttachmentChips items={[item({ state: 'uploading' })]} onRemove={() => {}} size={{ w: 96, h: 64 }} removeLabel="Retirer" lang="fr" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(<AttachmentChips items={[item()]} onRemove={() => {}} size={{ w: 96, h: 64 }} removeLabel="Retirer" lang="fr" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('212 Ko')).toBeInTheDocument();
  });
  it('shows the reason of a refused chip', () => {
    render(<AttachmentChips items={[item({ state: 'refused', reason: 'Image trop lourde' })]} onRemove={() => {}} size={{ w: 72, h: 72 }} removeLabel="Retirer" lang="fr" />);
    expect(screen.getByText('Image trop lourde')).toBeInTheDocument();
  });
  it('removes by key from the labelled button', () => {
    const onRemove = vi.fn();
    render(<AttachmentChips items={[item({ key: 'k1' })]} onRemove={onRemove} size={{ w: 96, h: 64 }} removeLabel="Retirer" lang="fr" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    expect(onRemove).toHaveBeenCalledWith('k1');
  });
});

describe('ImageThumb', () => {
  const base = { width: 1440, height: 900, maxW: 420, maxH: 260, alt: 'capture', unavailable: 'Image indisponible' };
  it('shows the unavailable text when failed', () => {
    render(<ImageThumb {...base} url={null} failed onOpen={() => {}} />);
    expect(screen.getByText('Image indisponible')).toBeInTheDocument();
  });
  it('opens on click once loaded', () => {
    const onOpen = vi.fn();
    render(<ImageThumb {...base} url="blob:x" failed={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByAltText('capture')).toHaveAttribute('src', 'blob:x');
  });
});

describe('Lightbox', () => {
  const images = [{ url: 'blob:1', meta: '1440×900' }, { url: 'blob:2', meta: '800×600' }];
  const mount = (over = {}) => {
    const p = { onIndex: vi.fn(), onClose: vi.fn() };
    render(<Lightbox images={images} index={0} title="Capture" closeLabel="Fermer" {...p} {...over} />);
    return p;
  };
  it('is a modal dialog that closes on Escape and on ✕', () => {
    const p = mount();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
  it('moves with the arrow keys within the images', () => {
    const p = mount();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(p.onIndex).toHaveBeenCalledWith(1);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(p.onIndex).toHaveBeenCalledTimes(1);
  });
  it('takes the focus and gives it back', () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus();
    const { unmount } = render(<Lightbox images={images} index={0} onIndex={() => {}} onClose={() => {}} title="t" closeLabel="Fermer" />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    unmount();
    expect(document.activeElement).toBe(opener);
  });
});
