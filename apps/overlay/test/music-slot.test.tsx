import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NowPlaying } from '@ledge/protocol';
import { MusicSlot, type MusicSlotProps } from '../src/surface/MusicSlot';
import { musicWidth } from '../src/surface/geometry';

const NOW: NowPlaying = { title: 'Quai 9', artist: 'Mira Volant', playing: true, cover: 'data:image/png;base64,AQID', canPrev: true, canNext: true, source: 'Chrome' };
const slot = (extra: Partial<MusicSlotProps> = {}) => {
  const props = { now: NOW, hover: 'controls' as const, open: false, onOpen: vi.fn(), onClose: vi.fn(), onControl: vi.fn(), ...extra };
  const view = render(<MusicSlot {...props} />);
  return { ...view, props };
};

afterEach(() => vi.useRealTimers());

describe('MusicSlot', () => {
  it('closed: the cover only, with the track as its tooltip', () => {
    slot();
    const cover = screen.getByRole('button', { name: 'Quai 9 · Mira Volant' });
    expect(cover).toHaveAttribute('title', 'Quai 9 · Mira Volant');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('tooltip without artist', () => {
    slot({ now: { ...NOW, artist: '' } });
    expect(screen.getByRole('button', { name: 'Quai 9' })).toHaveAttribute('title', 'Quai 9');
  });

  it('no cover shows the note', () => {
    slot({ now: { ...NOW, cover: null } });
    const cover = screen.getByRole('button', { name: 'Quai 9 · Mira Volant' });
    expect(cover.style.backgroundImage).toBe('');
    expect(cover.querySelector('[data-music-note]')).not.toBeNull();
  });

  it('paused: greyed with the pause sign, no activity bars', () => {
    slot({ now: { ...NOW, playing: false } });
    const cover = screen.getByRole('button', { name: 'Quai 9 · Mira Volant' });
    expect(cover).toHaveAttribute('data-paused');
    expect(cover.querySelector('[data-eq]')).toBeNull();
    expect(cover.querySelector('[data-pause-mark]')).not.toBeNull();
  });

  it('hovering the cover asks to open; leaving closes after 250 ms', () => {
    vi.useFakeTimers();
    const { props } = slot();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Quai 9 · Mira Volant' }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(document.querySelector('[data-music-slot]')!);
    act(() => { vi.advanceTimersByTime(249); });
    expect(props.onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('open: Previous, Pause, Next in order, and they act', () => {
    const onControl = vi.fn();
    const { props, rerender } = slot({ open: true, onControl });
    const names = () => screen.getAllByRole('button').map(b => b.getAttribute('aria-label'));
    expect(names()).toEqual(['Quai 9 · Mira Volant', 'Previous', 'Pause', 'Next']);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onControl.mock.calls.map(c => c[0])).toEqual(['prev', 'toggle', 'next']);
    rerender(<MusicSlot {...props} now={{ ...NOW, playing: false }} open />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('disabled when canNext is false', () => {
    const { props } = slot({ open: true, now: { ...NOW, canNext: false } });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(props.onControl).not.toHaveBeenCalled();
  });

  it('controls-title shows title and artist', () => {
    const { rerender, props } = slot({ open: true, hover: 'controls' });
    expect(screen.queryByText('Mira Volant')).toBeNull();
    rerender(<MusicSlot {...props} hover="controls-title" open />);
    expect(screen.getByText('Quai 9')).toBeVisible();
    expect(screen.getByText('Mira Volant')).toBeVisible();
  });
});

describe('musicWidth', () => {
  it('adds the rule, the cover, then the controls and the title', () => {
    expect(musicWidth({ open: false, withTitle: false })).toBe(37);
    expect(musicWidth({ open: true, withTitle: false })).toBe(37 + 6 + 84);
    expect(musicWidth({ open: true, withTitle: true })).toBe(37 + 6 + 84 + 156);
  });
});
