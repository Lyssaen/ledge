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
  it('renders one button per bot, 22 px each, asks first, with the state tick on the top edge', () => {
    render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const otto = screen.getByRole('button', { name: /Otto needs your approval/ });
    const pim = screen.getByRole('button', { name: /Pim/ });
    expect(otto).toHaveStyle({ width: '22px', height: '22px', opacity: '1' });
    expect(pim).toHaveStyle({ width: '22px', opacity: '0.8' });
    expect(screen.getByRole('button', { name: /Lu/ })).toHaveStyle({ opacity: '0.55' });
    expect(otto.querySelector('[data-tick]')).toHaveStyle({ opacity: '1', background: 'var(--danger-text)', top: '-3px' });
    expect(pim.querySelector('[data-tick]')).toHaveStyle({ opacity: '0' });
    const buttons = [...document.querySelectorAll('[data-layer="handle"] button')];
    expect(buttons.map(b => b.getAttribute('data-resident') !== null ? 'ledge' : b.getAttribute('aria-label')!.split(' ')[0])).toEqual(['ledge', 'Otto', 'Pim', 'Lu']);
  });
  it('hover lifts the bot and reports it; click opens it', () => {
    const onHover = vi.fn(), onOpen = vi.fn();
    const { rerender } = render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={onHover} onOpen={onOpen} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Pim/ }));
    expect(onHover).toHaveBeenCalledWith('b');
    rerender(<Handle bots={bots} slots={l.slots} visible hoverId="b" onHover={onHover} onOpen={onOpen} />);
    const sprite = screen.getByRole('button', { name: /Pim/ }).querySelector('[data-sprite]')!;
    expect(sprite).toHaveStyle({ transform: 'scale(1.25)' });
    fireEvent.click(screen.getByRole('button', { name: /Pim/ }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });
  it('a resting working bot hops 2 px on screen: drawn 22 px on the full SVG (viewBox 96 wide), the hop is 12 % of it (2.64 px), 2.64 / 22 * 96 = 11.52 SVG units', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} reducedMotion={false} />);
    const pim = screen.getByRole('button', { name: /Pim/ }).querySelector('svg.bot')!;
    expect(pim).toHaveAttribute('data-hop', 'true');
    expect(pim.getAttribute('style')).toContain('--bot-hop: 11.52px');
    expect(container.querySelectorAll('svg.bot[data-hop="true"]')).toHaveLength(1);
  });
  it('is inert when not visible', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} visible={false} hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
  });
});

describe('<Handle> separator', () => {
  it('draws a separator between Ledge and the bots, hidden without bots', () => {
    const { rerender } = render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-separator]')).toHaveStyle({ opacity: '1' });
    rerender(<Handle bots={[]} slots={[]} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-separator]')).toHaveStyle({ opacity: '0' });
  });
});

describe('<Handle> machine pipes', () => {
  it('draws a pipe where the companions change machine, none on a single machine', () => {
    const fleet: HandleBot[] = [{ ...bots[1]!, machine: 'srv' }, bots[0]!, { ...bots[2]!, machine: 'srv' }];
    const fl = layout({ bots: fleet.map(b => ({ id: b.id, pending: b.pending, machine: b.machine })), mode: 'handle', screenH: 1080, screenW: 1920 });
    const { container, rerender } = render(<Handle bots={fleet} slots={fl.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const row = [...container.querySelectorAll('[data-layer="handle"] > [data-machine-separator], [data-layer="handle"] > button:not([data-resident])')]
      .map(e => e.hasAttribute('data-machine-separator') ? (e as HTMLElement).style.opacity === '1' ? '|' : null : e.getAttribute('aria-label')!.split(' ')[0]).filter(Boolean);
    expect(row).toEqual(['Otto', '|', 'Pim', 'Lu']);
    expect(container.querySelectorAll('[data-machine-separator]')[1]).toHaveStyle({ width: '1px', marginLeft: '8px', height: '16px' });
    rerender(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect([...container.querySelectorAll('[data-machine-separator]')].every(e => (e as HTMLElement).style.opacity === '0')).toBe(true);
  });
});

describe('<Handle> inertness', () => {
  it('marks the hidden layer inert', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots} visible={false} hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).toHaveAttribute('inert');
  });
  it('keeps visible layer focusable and hides collapsed bots from tab order and a11y tree', () => {
    const { container } = render(<Handle bots={bots} slots={l.slots.filter(s => s.id !== 'c')} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(container.firstChild).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: /Otto/ })).not.toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('button', { name: /Lu/ })).toBeNull();
    const lu = container.querySelector('[aria-label^="Lu"]')!;
    expect(lu).toHaveAttribute('tabindex', '-1');
    expect(lu).toHaveAttribute('aria-hidden', 'true');
  });
  it('an unread Ledge answer keeps the resident at rest and names the reply in its label', () => {
    render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} unread />);
    const resident = screen.getByRole('button', { name: /Ledge replied, open/ });
    expect(resident).toHaveStyle({ width: '22px', height: '22px' });
    expect(resident.querySelector('[data-tick]')).toBeNull();
    expect(resident.querySelector('[data-unread-pip]')).toBeNull();
    expect(resident.querySelector('svg.resident')).not.toHaveAttribute('data-unread');
  });
  it('hides the edge tick on the bot that is speaking and grows a held finished bot', () => {
    const asking = [
      { id: 'a', name: 'Otto', tool: 'claude' as const, state: 'approval' as const, pose: 1 as const, pending: true },
      { id: 'b', name: 'Pim', tool: 'codex' as const, state: 'idle' as const, pose: 1 as const, pending: false, held: true }
    ];
    render(<Handle bots={asking} slots={[{ id: 'a', size: 22, center: 962 }, { id: 'b', size: 22, center: 992 }]} visible hoverId={null} onHover={() => {}} onOpen={() => {}} sayId="a" />);
    const otto = screen.getByRole('button', { name: /Otto/ });
    const pim = screen.getByRole('button', { name: /Pim/ });
    expect(otto.querySelector('[data-tick]')).toHaveStyle({ opacity: '0' });
    expect(otto).toHaveStyle({ width: '22px' });
    expect(otto.querySelector('[data-sprite]')).toHaveStyle({ transform: 'scale(1.25)' });
    expect(pim).toHaveStyle({ width: '22px', opacity: '1' });
    expect(pim.querySelector('[data-sprite]')).toHaveStyle({ transform: 'scale(1.25)' });
    expect(pim.querySelector('[data-tick]')).toHaveStyle({ opacity: '0' });
  });
  it('a lifted bot (finishing) is drawn big without the edge tick', () => {
    const lifted = [{ id: 'a', name: 'Otto', tool: 'claude', state: 'idle', pose: 1, pending: false, lifted: true }] as const;
    render(<Handle bots={lifted as never} slots={[{ id: 'a', size: 22, center: 962 }]} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    const btn = screen.getByRole('button', { name: /Otto/ });
    expect(btn).toHaveStyle({ width: '22px', opacity: '1' });
    expect(btn.querySelector('[data-sprite]')).toHaveStyle({ transform: 'scale(1.25)' });
    expect(btn.querySelector('[data-tick]')).toHaveStyle({ opacity: '0' });
  });
});

describe('<Handle> island extras', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `Bot${i}`, tool: 'claude' as const, state: (i === 7 ? 'approval' : 'working') as 'approval' | 'working', pose: 1 as const, pending: i === 7 }));
  const geo = layout({ bots: many.map(b => ({ id: b.id, pending: b.pending })), mode: 'handle', screenH: 1080, screenW: 1920 });
  it('past six sessions, the ask comes first, the six get slots and a "+n" pill counts the rest; the pill opens the list', () => {
    const onOpenHome = vi.fn();
    render(<Handle bots={many} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} onOpenHome={onOpenHome} />);
    const buttons = [...document.querySelectorAll('[data-layer="handle"] button:not([data-resident]):not([data-overflow])')];
    expect(buttons[0]).toHaveAccessibleName(/Bot7/);
    expect(document.querySelector('[aria-label^="Bot5"]')).toHaveStyle({ width: '0px' });
    const pill = document.querySelector('[data-overflow]')!;
    expect(pill).toHaveTextContent('+2');
    expect(pill).toHaveStyle({ width: '30px' });
    fireEvent.click(pill);
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });
  it('the discreet strip: one 6 x 4 dot per shown session in its state colour, the whole strip opens the list', () => {
    const onOpenHome = vi.fn();
    render(<Handle bots={many} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} onOpenHome={onOpenHome} strip />);
    const strip = document.querySelector('[data-layer="handle"][data-strip]')!;
    expect(strip).toHaveStyle({ height: '10px' });
    const dots = strip.querySelectorAll('[data-dot]');
    expect(dots).toHaveLength(6);
    expect(dots[0]).toHaveStyle({ width: '6px', height: '4px', background: 'var(--danger-text)' });
    expect(document.querySelector('[data-resident]')).toBeNull();
    fireEvent.click(strip);
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });
  it('do not disturb draws a moon after the companions', () => {
    const { rerender } = render(<Handle bots={many.slice(0, 2)} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-dnd-moon]')).toBeNull();
    rerender(<Handle bots={many.slice(0, 2)} slots={geo.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} dnd />);
    expect(document.querySelector('[data-dnd-moon]')).toHaveAttribute('width', '12');
  });
});

describe('<Handle> update pip', () => {
  it('shows the pip on the mascot with its tone, and none by default', () => {
    const { rerender } = render(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-update-pip]')).toBeNull();
    rerender(<Handle bots={bots} slots={l.slots} visible hoverId={null} onHover={() => {}} onOpen={() => {}} updatePip="new" updateVersion="0.3.0" />);
    expect(document.querySelector('[data-update-pip="new"]')).not.toBeNull();
    expect(document.querySelector('[data-resident]')!.getAttribute('title')).toMatch(/^Ledge 0\.3\.0 is ready\./);
  });
});

describe('<Badge>', () => {
  it('shows the word for each state', () => {
    render(<Badge state="readonly" />); expect(screen.getByText('Read only')).toBeInTheDocument();
  });
});
