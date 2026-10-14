import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Handle } from '../src/surface/Handle';
import { layout, scaledLayout } from '../src/surface/geometry';

describe('the resident Ledge mascot', () => {
  it('fills the handle when there are no sessions and opens the list', async () => {
    const onOpenHome = vi.fn();
    const geo = layout({ bots: [], mode: 'handle', screenH: 1080, screenW: 1920 });
    render(<Handle bots={[]} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} onOpenHome={onOpenHome} />);
    expect(geo.w).toBe(48);
    const resident = screen.getByRole('button', { name: /Ledge.*open/i });
    expect(resident.querySelector('svg')).toHaveAttribute('aria-label', 'Ledge');
    fireEvent.click(resident);
    expect(resident.querySelector('svg')).toHaveAttribute('data-gesture', 'boop');
    await waitFor(() => expect(onOpenHome).toHaveBeenCalledTimes(1));
  });

  it('remains visible ahead of session bots, even when one is asking', () => {
    const bots = [{ id: 'a', name: 'Otto', tool: 'claude' as const, state: 'approval' as const, pose: 1 as const, pending: true }];
    const geo = layout({ bots: [{ id: 'a', pending: true }], mode: 'handle', screenH: 1080, screenW: 1920 });
    const { container } = render(<Handle bots={bots} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} onOpenHome={() => {}} />);
    const buttons = [...container.querySelectorAll('[data-layer="handle"] button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('data-resident');
    expect(screen.getByRole('button', { name: /Otto needs your approval/i })).toBeInTheDocument();
    expect(geo.slots[0]!.center).toBeGreaterThan(geo.left + 12 + 22);
  });

  it('lets the mascot follow the nearby pointer and recentres when it leaves', () => {
    const geo = layout({ bots: [], mode: 'handle', screenH: 1080, screenW: 1920 });
    const props = { bots: [], slots: geo.slots, visible: true, hoverId: null, onHover: () => {}, onOpen: () => {}, onOpenHome: () => {} };
    const { rerender } = render(<Handle {...props} left={geo.left} pointer={{ x: geo.left + 40, y: 30 }} />);
    const face = screen.getByRole('img', { name: 'Ledge' });
    expect(face).toHaveAttribute('data-near', 'true');
    expect(face.style.getPropertyValue('--resident-gx')).not.toBe('0px');
    rerender(<Handle {...props} left={geo.left} pointer={null} />);
    expect(face).toHaveAttribute('data-near', 'false');
    expect(face.style.getPropertyValue('--resident-gx')).toBe('0px');
  });

  it('uses screen coordinates for its gaze at a 2x handle scale', () => {
    const geo = scaledLayout({ bots: [], mode: 'handle', screenH: 2160, screenW: 3840 }, { handle: 2, panel: 1 });
    const props = { bots: [], slots: geo.slots, visible: true, hoverId: null, onHover: () => {}, onOpen: () => {}, onOpenHome: () => {}, left: geo.left, scale: 2 };
    const { rerender } = render(<Handle {...props} pointer={{ x: geo.left + 46, y: 38 }} />);
    const face = screen.getByRole('img', { name: 'Ledge' });
    expect(face).toHaveAttribute('data-near', 'true');
    expect(face.style.getPropertyValue('--resident-gx')).toBe('0px');
    expect(face.style.getPropertyValue('--resident-gy')).toBe('0px');
    rerender(<Handle {...props} pointer={{ x: geo.left + 120, y: 38 }} />);
    expect(face.style.getPropertyValue('--resident-gx')).not.toBe('0px');
  });

  it('stays present offline and settles under DND or reduced motion', () => {
    const geo = layout({ bots: [], mode: 'handle', screenH: 1080, screenW: 1920 });
    const props = { bots: [], slots: geo.slots, visible: true, hoverId: null, onHover: () => {}, onOpen: () => {}, onOpenHome: () => {} };
    const { rerender } = render(<Handle {...props} frozen dnd reducedMotion />);
    const face = screen.getByRole('img', { name: 'Ledge' });
    expect(face).toHaveAttribute('data-frozen', 'true');
    expect(face).toHaveAttribute('data-quiet', 'true');
    rerender(<Handle {...props} />);
    expect(face).toHaveAttribute('data-frozen', 'false');
  });
});
