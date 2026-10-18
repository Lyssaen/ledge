import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Handle, type HandleBot } from '../src/surface/Handle';
import { Badge } from '../src/ui/Badge';
import { layout } from '../src/surface/geometry';

const bots = [
  { id: 'a', name: 'Otto', tool: 'claude' as const, state: 'approval' as const, pose: 1 as const, pending: true },
  { id: 'b', name: 'Pim', tool: 'codex' as const, state: 'working' as const, pose: 2 as const, pending: false },
  { id: 'c', name: 'Lu', tool: 'codex' as const, state: 'done' as const, pose: 1 as const, pending: false }
];
const l = layout({ bots: bots.map(b => ({ id: b.id, pending: b.pending })), mode: 'handle', screenH: 1080, screenW: 1920 });

describe('<Handle>', () => {
  it('rests as a 10 px filet: Ledge’s rectangle, then one dash per session in its state colour', () => {
    render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const filet = document.querySelector('[data-layer="handle"][data-filet]')!;
    expect(filet).toHaveStyle({ height: '10px' });
    const ledge = filet.querySelector('[data-ledge-mark]') as HTMLElement;
    expect(ledge).toHaveStyle({ width: '9px', height: '3px', background: 'var(--sidebar-primary)' });
    const dashes = [...filet.querySelectorAll('[data-dot]')] as HTMLElement[];
    expect(dashes.map(d => d.getAttribute('data-state'))).toEqual(['approval', 'working', 'done']);
    expect(dashes[0]).toHaveStyle({ width: '5px', height: '3px', background: 'var(--danger-text)' });
    expect(dashes[1]).toHaveStyle({ background: 'var(--info)' });
    const buttons = [...filet.querySelectorAll('button')];
    expect(buttons.map(b => b.getAttribute('data-resident') !== null ? 'ledge' : b.getAttribute('aria-label')!.split(' ')[0])).toEqual(['ledge', 'Otto', 'Pim', 'Lu']);
  });
  it('a dash reports hover and opens its session; Ledge opens home at once', () => {
    const onHover = vi.fn(), onOpen = vi.fn(), onOpenHome = vi.fn();
    render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={onHover} onOpen={onOpen} onOpenHome={onOpenHome} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Pim/ }));
    expect(onHover).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: /Pim/ }));
    expect(onOpen).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });
  it('is inert when not visible', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} visible={false} hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
  });
});

describe('<Handle> separator', () => {
  it('draws a hairline between Ledge and the bots, and none without bots', () => {
    const { rerender } = render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-machine-separator]')).toHaveStyle({ width: '1px', height: '6px' });
    rerender(<Handle bots={[]} slots={[]} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-machine-separator]')).toBeNull();
  });
});

describe('<Handle> machine pipes', () => {
  it('draws a pipe where the companions change machine, none on a single machine', () => {
    const fleet: HandleBot[] = [{ ...bots[1]!, machine: 'srv' }, bots[0]!, { ...bots[2]!, machine: 'srv' }];
    const fl = layout({ bots: fleet.map(b => ({ id: b.id, pending: b.pending, machine: b.machine })), mode: 'handle', screenH: 1080, screenW: 1920 });
    const { container, rerender } = render(<Handle bots={fleet} slots={fl.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const row = [...container.querySelectorAll('[data-layer="handle"] [data-machine-separator], [data-layer="handle"] [data-dot]')]
      .map(e => e.hasAttribute('data-machine-separator') ? '|' : e.closest('button')!.getAttribute('aria-label')!.split(' ')[0]);
    expect(row).toEqual(['|', 'Otto', '|', 'Pim', 'Lu']);
    expect(container.querySelector('[data-machine-separator]')).toHaveStyle({ width: '1px', height: '6px', marginLeft: '3px' });
    rerender(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.querySelectorAll('[data-machine-separator]')).toHaveLength(1);
  });
});

describe('<Handle> inertness', () => {
  it('marks the hidden layer inert', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} visible={false} hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toHaveAttribute('inert');
  });
  it('keeps the visible layer focusable and shows every session', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots.filter(s => s.id !== 'c')} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: /Otto/ })).not.toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: /Lu/ })).toBeInTheDocument();
  });
  it('an unread Ledge answer names the reply on the rectangle', () => {
    render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} unread />);
    expect(screen.getByRole('button', { name: /Ledge replied, open/ })).toBeInTheDocument();
  });
});

describe('<Handle> island extras', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Bot${i}`, tool: 'claude' as const, state: (i === 7 ? 'approval' : 'working') as 'approval' | 'working', pose: 1 as const, pending: i === 7 }));
  const geo = layout({ bots: many.map(b => ({ id: b.id, pending: b.pending })), mode: 'handle', screenH: 1080, screenW: 1920 });
  it('shows every session, the ask first, with no overflow pill', () => {
    render(<Handle bots={many} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const buttons = [...document.querySelectorAll('[data-layer="handle"] button:not([data-resident])')];
    expect(buttons).toHaveLength(8);
    expect(buttons[0]).toHaveAccessibleName(/Bot7/);
    expect(document.querySelector('[data-overflow]')).toBeNull();
  });
  it('the discreet strip keeps Ledge and one dash per session', () => {
    const onOpen = vi.fn(), onOpenHome = vi.fn();
    render(<Handle bots={many} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={onOpen} onOpenHome={onOpenHome} strip />);
    const strip = document.querySelector('[data-layer="handle"][data-strip]')!;
    expect(strip).toHaveStyle({ height: '10px' });
    expect(strip.querySelectorAll('[data-dot]')).toHaveLength(8);
    expect(strip.querySelector('[data-ledge-mark]')).not.toBeNull();
    fireEvent.click(strip.querySelector('[data-dot]')!.closest('button')!);
    expect(onOpen).toHaveBeenCalledWith('s7');
    expect(onOpenHome).not.toHaveBeenCalled();
  });
  it('do not disturb mutes Ledge’s rectangle', () => {
    const { rerender } = render(<Handle bots={many.slice(0, 2)} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--sidebar-primary)' });
    rerender(<Handle bots={many.slice(0, 2)} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} dnd />);
    expect(document.querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--muted-foreground)' });
  });
});

describe('<Handle> update pip', () => {
  it('shows the pip on the mascot with its tone, and none by default', () => {
    const { rerender } = render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-update-pip]')).toBeNull();
    rerender(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} updatePip="new" updateVersion="0.3.0" />);
    expect(document.querySelector('[data-update-pip="new"]')).not.toBeNull();
    const pip = document.querySelector('[data-update-pip="new"]') as HTMLElement;
    expect(pip).toHaveStyle({ width: '5px', height: '3px', background: 'var(--sidebar-primary)' });
    expect(document.querySelector('[data-resident]')!.getAttribute('title')).toMatch(/^Ledge 0\.3\.0 is ready\./);
  });
});

describe('<Badge>', () => {
  it('shows the word for each state', () => {
    render(<Badge state="readonly" />); expect(screen.getByText('Read only')).toBeInTheDocument();
  });
});
