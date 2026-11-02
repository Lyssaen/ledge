import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Handle } from '../src/surface/Handle';
import { layout } from '../src/surface/geometry';

describe('the Ledge mark on the filet', () => {
  it('is the notch, alone, and opens home', () => {
    const onOpenHome = vi.fn();
    const geo = layout({ bots: [{ id: 'a', pending: true }], mode: 'handle', screenH: 1080, screenW: 1920 });
    const { container } = render(<Handle visible onOpenHome={onOpenHome} />);
    expect(geo.w).toBe(21);
    expect(geo.slots).toEqual([]);
    expect(container.querySelectorAll('[data-layer="handle"] button')).toHaveLength(1);
    const resident = screen.getByRole('button', { name: /Ledge.*open/i });
    expect(resident.querySelector('[data-ledge-mark]')).not.toHaveAttribute('data-pending');
    fireEvent.click(resident);
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });

  it('keeps the most urgent request’s colour: red for a permission, amber for the rest, over the DND grey', () => {
    const { rerender } = render(<Handle visible pending="permission" dnd />);
    const mark = () => document.querySelector('[data-ledge-mark]')!;
    expect(mark()).toHaveAttribute('data-pending', 'permission');
    rerender(<Handle visible pending="question" />);
    expect(mark()).toHaveAttribute('data-pending', 'question');
  });

  it('mutes under do not disturb and names the lost connection', () => {
    const { rerender } = render(<Handle visible frozen dnd />);
    expect(screen.getByRole('button', { name: /Ledge.*open/i }).querySelector('[data-ledge-mark]')).toHaveAttribute('data-dnd');
    expect(screen.getByRole('button', { name: /Ledge.*open/i })).toHaveAttribute('title', expect.stringMatching(/connection lost/i));
    rerender(<Handle visible />);
    expect(screen.getByRole('button', { name: /Ledge.*open/i }).querySelector('[data-ledge-mark]')).not.toHaveAttribute('data-dnd');
  });
});
