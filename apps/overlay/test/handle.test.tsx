import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Handle, type HandleProps } from '../src/surface/Handle';
import type { HandleLine } from '../src/surface/handleLine';
import { Badge } from '../src/ui/Badge';

const forYou: HandleLine = { kind: 'forYou', category: 'architecture', summary: 'orch-lead : JSON or SQLite?', count: 1 };
const exchange: HandleLine = { kind: 'exchange', rigName: 'factory', from: 'build', to: 'review-a', text: 'Candidate ready, tests green' };
const decided: HandleLine = { kind: 'decided', text: 'I settled for build: merge, no rebase' };
const base: HandleProps = { sessions: 3, visible: true };
const layer = () => document.querySelector('[data-layer="handle"]')!;

afterEach(() => vi.restoreAllMocks());

describe('<Handle> Ledge alone', () => {
  it('the closed notch shows Ledge alone, no bot row', () => {
    for (const awake of [false, true]) {
      const { unmount } = render(<Handle {...base} awake={awake} line={forYou} />);
      expect(layer().querySelectorAll('[data-dot]')).toHaveLength(0);
      // The resident is the only robot drawn: no companion row.
      expect(layer().querySelectorAll('button:not([data-resident]) [data-sprite]')).toHaveLength(0);
      const line = layer().querySelector('[data-ledge-line]') as HTMLElement;
      expect(line).toHaveAttribute('data-kind', 'forYou');
      if (awake) {
        expect(within(line).getByText('Architecture')).toHaveClass('lt-chip');
        expect(line.querySelector('[data-counter]')).toHaveTextContent('1');
        expect(within(line).getByText('orch-lead : JSON or SQLite?')).toBeInTheDocument();
      }
      unmount();
    }
  });
  it('rests as a 10 px filet: Ledge’s rectangle, then the line’s mark in its tone', () => {
    render(<Handle {...base} line={forYou} />);
    const filet = document.querySelector('[data-layer="handle"][data-filet]')!;
    expect(filet).toHaveStyle({ height: '10px' });
    expect(filet.querySelector('[data-ledge-mark]')).toHaveStyle({ width: '9px', height: '3px', background: 'var(--sidebar-primary)' });
    expect(filet.querySelector('[data-line-mark]')).toHaveStyle({ background: 'var(--danger-text)' });
    expect(screen.getByRole('button', { name: 'Architecture · orch-lead : JSON or SQLite? · 1 for you' })).toBeInTheDocument();
  });
  it('calm: the mascot alone, no line', () => {
    render(<Handle {...base} awake line={{ kind: 'calm' }} />);
    expect(layer().querySelector('[data-ledge-line]')).toBeNull();
    render(<Handle {...base} />);
    expect(document.querySelectorAll('[data-ledge-line]')).toHaveLength(0);
  });
  it('awake, an exchange reads rig, from → to and its text; a decision reads its sentence and « Revisit »', () => {
    const { rerender } = render(<Handle {...base} awake line={exchange} />);
    const line = () => layer().querySelector('[data-ledge-line]') as HTMLElement;
    expect(line()).toHaveTextContent('factory');
    expect(line()).toHaveTextContent('build → review-a');
    expect(line()).toHaveTextContent('Candidate ready, tests green');
    rerender(<Handle {...base} awake line={decided} />);
    expect(line()).toHaveTextContent('I settled for build: merge, no rebase');
    expect(line()).toHaveTextContent('Revisit');
  });
  it('the line opens the notch as Ledge does', () => {
    const onOpenHome = vi.fn();
    render(<Handle {...base} awake line={exchange} onOpenHome={onOpenHome} />);
    fireEvent.click(layer().querySelector('[data-ledge-line]')!);
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });
  it('Ledge opens home at once from the filet', () => {
    const onOpenHome = vi.fn();
    render(<Handle {...base} onOpenHome={onOpenHome} />);
    fireEvent.click(screen.getByRole('button', { name: /Ledge, open/ }));
    expect(onOpenHome).toHaveBeenCalledTimes(1);
  });
  it('the discreet strip keeps Ledge alone', () => {
    render(<Handle {...base} strip />);
    const strip = document.querySelector('[data-layer="handle"][data-strip]')!;
    expect(strip).toHaveStyle({ height: '10px' });
    expect(strip.querySelector('[data-ledge-mark]')).not.toBeNull();
    expect(strip.querySelectorAll('[data-dot]')).toHaveLength(0);
    const { unmount } = render(<Handle {...base} strip trailing={<span data-testid="music">♪</span>} />);
    expect(document.querySelector('[data-trailing]')).toBeNull();
    expect(screen.queryByTestId('music')).toBeNull();
    unmount();
  });
  it('do not disturb mutes Ledge’s rectangle, and the island keeps its moon', () => {
    const { rerender } = render(<Handle {...base} />);
    expect(document.querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--sidebar-primary)' });
    rerender(<Handle {...base} dnd />);
    expect(document.querySelector('[data-ledge-mark]')).toHaveStyle({ background: 'var(--muted-foreground)' });
    rerender(<Handle {...base} dnd awake line={forYou} />);
    expect(document.querySelector('[data-dnd-moon]')).not.toBeNull();
  });
  it('names the shortcut in Ledge’s tooltip', () => {
    render(<Handle {...base} shortcut="Ctrl+Alt+L" />);
    expect(document.querySelector('[data-resident]')!.getAttribute('title')).toMatch(/· Ctrl\+Alt\+L$/);
  });
});

describe('<Handle> trailing slot', () => {
  it('without a trailing element: no rule, nothing after the line', () => {
    for (const awake of [false, true]) {
      const { unmount } = render(<Handle {...base} awake={awake} line={forYou} />);
      expect(layer().querySelector('[data-trailing-rule]')).toBeNull();
      expect(layer().querySelector('[data-trailing]')).toBeNull();
      unmount();
    }
  });
  it('with one: a vertical rule then the element, at the right of the message, resting and awake', () => {
    for (const awake of [false, true]) {
      const { unmount } = render(<Handle {...base} awake={awake} line={forYou} trailing={<span data-testid="music">♪</span>} />);
      const rule = layer().querySelector('[data-trailing-rule]') as HTMLElement;
      expect(rule).not.toBeNull();
      expect(rule).toHaveStyle({ width: '1px' });
      const slot = layer().querySelector('[data-trailing]')!;
      expect(within(slot as HTMLElement).getByTestId('music')).toBeInTheDocument();
      const kids = [...layer().children];
      expect(kids.indexOf(rule)).toBeGreaterThan(kids.indexOf(layer().querySelector('[data-ledge-line]')!));
      expect(kids.indexOf(slot)).toBe(kids.indexOf(rule) + 1);
      expect(kids.at(-1)).toBe(slot);
      unmount();
    }
  });
  it('reports the measured widths of the line and the trailing element, in handle px', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const w = this.hasAttribute('data-trailing') ? 80 : this.hasAttribute('data-ledge-line') ? 300 : 0;
      return { width: w, height: 10, x: 0, y: 0, top: 0, left: 0, right: w, bottom: 10, toJSON: () => ({}) } as DOMRect;
    });
    const onMeasure = vi.fn();
    const { rerender } = render(<Handle {...base} awake scale={2} line={forYou} trailing={<span>♪</span>} onMeasure={onMeasure} />);
    expect(onMeasure).toHaveBeenLastCalledWith({ line: 150, trailing: 40 });
    rerender(<Handle {...base} awake scale={2} line={{ kind: 'calm' }} onMeasure={onMeasure} />);
    expect(onMeasure).toHaveBeenLastCalledWith({ line: 0, trailing: 0 });
  });
});

describe('<Handle> inertness', () => {
  it('marks the hidden layer inert and transparent', () => {
    const { container } = render(<Handle {...base} visible={false} />);
    expect(container.firstChild).toHaveAttribute('inert');
    expect(container.firstChild).toHaveStyle({ opacity: '0', pointerEvents: 'none' });
  });
  it('an unread Ledge answer names the reply on the rectangle', () => {
    render(<Handle {...base} unread />);
    expect(screen.getByRole('button', { name: /Ledge replied, open/ })).toBeInTheDocument();
  });
});

describe('<Handle> update pip', () => {
  it('shows the pip after Ledge with its tone, and none by default', () => {
    const { rerender } = render(<Handle {...base} />);
    expect(document.querySelector('[data-update-pip]')).toBeNull();
    rerender(<Handle {...base} updatePip="new" updateVersion="0.3.0" />);
    const pip = document.querySelector('[data-update-pip="new"]') as HTMLElement;
    expect(pip).toHaveStyle({ width: '5px', height: '3px', background: 'var(--sidebar-primary)' });
    expect(document.querySelector('[data-resident]')!.getAttribute('title')).toMatch(/^Ledge 0\.3\.0 is ready\./);
    rerender(<Handle {...base} awake updatePip="new" updateVersion="0.3.0" />);
    expect(document.querySelector('[data-update-pip="new"]')).not.toBeNull();
  });
});

describe('<Badge>', () => {
  it('shows the word for each state', () => {
    render(<Badge state="readonly" />); expect(screen.getByText('Read only')).toBeInTheDocument();
  });
});
