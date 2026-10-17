import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Handle } from '../src/surface/Handle';
import { layout } from '../src/surface/geometry';

describe('the Ledge mark on the filet', () => {
  it('is the notch when there are no sessions and opens the list', () => {
    const onOpenHome = vi.fn();
    const geo = layout({ bots: [], mode: 'handle', screenH: 1080, screenW: 1920 });
    render(<Handle bots={[]} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} onOpenHome={onOpenHome} />);
    expect(geo.w).toBe(21);
    const resident = screen.getByRole('button', { name: /Ledge.*open/i });
    expect(resident.querySelector('[data-ledge-mark]')).toHaveStyle({ width: '9px', height: '3px', background: 'var(--sidebar-primary)' });
    fireEvent.click(resident);
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });

  it('stays ahead of the session dashes, even when one is asking', () => {
    const bots = [{ id: 'a', name: 'Otto', tool: 'claude' as const, state: 'approval' as const, pose: 1 as const, pending: true }];
    const geo = layout({ bots: [{ id: 'a', pending: true }], mode: 'handle', screenH: 1080, screenW: 1920 });
    const { container } = render(<Handle bots={bots} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} onOpenHome={() => {}} />);
    const buttons = [...container.querySelectorAll('[data-layer="handle"] button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('data-resident');
    expect(screen.getByRole('button', { name: /Otto needs your approval/i })).toBeInTheDocument();
    expect(geo.slots[0]!.center).toBeGreaterThan(geo.left + 6 + 9);
  });

  it('mutes under do not disturb and names the lost connection', () => {
    const geo = layout({ bots: [], mode: 'handle', screenH: 1080, screenW: 1920 });
    const props = { bots: [], slots: geo.slots, visible: true, hoverId: null, onHover: () => {}, onOpen: () => {}, onOpenHome: () => {} };
    const { rerender } = render(<Handle {...props} frozen dnd />);
    expect(screen.getByRole('button', { name: /Ledge.*open/i }).querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--muted-foreground)' });
    expect(screen.getByRole('button', { name: /Ledge.*open/i })).toHaveAttribute('title', expect.stringMatching(/connection lost/i));
    rerender(<Handle {...props} />);
    expect(screen.getByRole('button', { name: /Ledge.*open/i }).querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--sidebar-primary)' });
  });
});
