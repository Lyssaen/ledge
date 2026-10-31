import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Handle } from '../src/surface/Handle';
import { layout } from '../src/surface/geometry';

describe('the Ledge mark on the filet', () => {
  it('is the notch when there are no sessions and opens the list', () => {
    const onOpenHome = vi.fn();
    const geo = layout({ bots: [], mode: 'handle', screenH: 1080, screenW: 1920 });
    render(<Handle sessions={0} visible onOpenHome={onOpenHome} />);
    expect(geo.w).toBe(21);
    const resident = screen.getByRole('button', { name: /Ledge.*open/i });
    expect(resident.querySelector('[data-ledge-mark]')).toHaveStyle({ width: '9px', height: '3px', background: 'var(--sidebar-primary)' });
    fireEvent.click(resident);
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });

  it('stays alone on the notch, its line after it, even when a session is asking', () => {
    const { container } = render(<Handle sessions={1} visible onOpenHome={() => {}} line={{ kind: 'forYou', summary: 'Otto: npm test', count: 1 }} />);
    const buttons = [...container.querySelectorAll('[data-layer="handle"] button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('data-resident');
    expect(buttons[1]).toHaveAttribute('data-ledge-line');
    expect(screen.getByRole('button', { name: 'Otto: npm test · 1 for you' })).toBeInTheDocument();
  });

  it('mutes under do not disturb and names the lost connection', () => {
    const props = { sessions: 0, visible: true, onOpenHome: () => {} };
    const { rerender } = render(<Handle {...props} frozen dnd />);
    expect(screen.getByRole('button', { name: /Ledge.*open/i }).querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--muted-foreground)' });
    expect(screen.getByRole('button', { name: /Ledge.*open/i })).toHaveAttribute('title', expect.stringMatching(/connection lost/i));
    rerender(<Handle {...props} />);
    expect(screen.getByRole('button', { name: /Ledge.*open/i }).querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--sidebar-primary)' });
  });
});
