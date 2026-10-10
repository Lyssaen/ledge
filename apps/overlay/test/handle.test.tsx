import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Handle } from '../src/surface/Handle';
import { Badge } from '../src/ui/Badge';
import { layout } from '../src/surface/geometry';

const bots = [
  { id: 'a', name: 'Otto', tool: 'claude' as const, state: 'approval' as const, pose: 1 as const, pending: true, tip: 'needs your approval · npm test' },
  { id: 'b', name: 'Pim', tool: 'codex' as const, state: 'working' as const, pose: 2 as const, pending: false, tip: 'reading migrations' },
  { id: 'c', name: 'Lu', tool: 'codex' as const, state: 'done' as const, pose: 1 as const, pending: false, tip: 'exited 0' }
];
const l = layout({ bots: bots.map(b => ({ id: b.id, pending: b.pending })), mode: 'handle', screenH: 1080 });

describe('<Handle>', () => {
  it('renders one button per bot with sizes and ticks by state', () => {
    render(<Handle bots={bots} slots={l.slots} big={20} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const otto = screen.getByRole('button', { name: /Otto needs your approval/ });
    const pim = screen.getByRole('button', { name: /Pim/ });
    expect(otto).toHaveStyle({ width: '20px', opacity: '1' });
    expect(pim).toHaveStyle({ width: '12px', opacity: '0.8' });
    expect(screen.getByRole('button', { name: /Lu/ })).toHaveStyle({ opacity: '0.55' });
    expect(otto.querySelector('[data-tick]')).toHaveStyle({ opacity: '1', background: 'var(--danger-text)' });
    expect(pim.querySelector('[data-tick]')).toHaveStyle({ opacity: '0' });
  });
  it('hover lifts the bot and reports it; click opens it', () => {
    const onHover = vi.fn(), onOpen = vi.fn();
    const { rerender } = render(<Handle bots={bots} slots={l.slots} big={20} visible hoverId={null} onHover={onHover} onOpen={onOpen} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Pim/ }));
    expect(onHover).toHaveBeenCalledWith('b');
    rerender(<Handle bots={bots} slots={l.slots} big={20} visible hoverId="b" onHover={onHover} onOpen={onOpen} />);
    const sprite = screen.getByRole('button', { name: /Pim/ }).querySelector('[data-sprite]')!;
    expect(sprite).toHaveStyle({ transform: `scale(${(12 / 20) * 1.25})` });
    fireEvent.click(screen.getByRole('button', { name: /Pim/ }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });
  it('is inert when not visible', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} big={20} visible={false} hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
  });
});

describe('<Handle> inertness', () => {
  it('marks the hidden layer inert', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} big={20} visible={false} hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toHaveAttribute('inert');
  });
  it('keeps visible layer focusable and hides collapsed bots from tab order and a11y tree', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots.filter(s => s.id !== 'c')} big={20} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: /Otto/ })).not.toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('button', { name: /Lu/ })).toBeNull();
    const lu = container.querySelector('[aria-label^="Lu"]')!;
    expect(lu).toHaveAttribute('tabindex', '-1');
    expect(lu).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('<Badge>', () => {
  it('shows the word for each state', () => {
    render(<Badge state="readonly" />); expect(screen.getByText('Read only')).toBeInTheDocument();
  });
});
