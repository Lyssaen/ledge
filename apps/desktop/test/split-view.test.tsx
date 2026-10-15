import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitView } from '../src/conversation/SplitView';
import { DEFAULT_PANEL, type PanelState } from '../src/state/panel';

function Harness({ initial = DEFAULT_PANEL, pane = true, selectedId = null }: { initial?: PanelState; pane?: boolean; selectedId?: string | null }) {
  const [panel, setPanel] = useState(initial);
  return <SplitView selectedId={selectedId} panel={panel} onPanel={fn => setPanel(fn)} list={<section className="central" />} pane={pane ? <aside id="conversation-pane" className="detail conversation" /> : null} />;
}
const width = (c: HTMLElement) => (c.querySelector('.view-body') as HTMLElement).style.getPropertyValue('--conversation-width');

afterEach(() => { vi.unstubAllGlobals(); });

describe('SplitView', () => {
  it('the handle moves the conversation by 2 points, Home and End jump to the bounds (Review Focus 5: body not measured)', () => {
    const { container } = render(<Harness />);
    const handle = screen.getByRole('separator', { name: 'Conversation width' });
    expect(handle).toHaveAttribute('aria-valuenow', '38');
    expect(handle).toHaveAttribute('aria-controls', 'conversation-pane');
    expect(handle).toHaveAttribute('aria-valuemin', '25');
    expect(handle).toHaveAttribute('aria-valuemax', '70');
    expect(width(container)).toBe('38%');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '40');
    expect(handle).toHaveAttribute('aria-valuetext', 'Conversation: 40% of the width');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '70');
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '25');
    expect(width(container)).toBe('25%');
  });
  it('a stored width outside the bounds is shown clamped', () => {
    render(<Harness initial={{ width: 0.5, expanded: false }} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '25');
  });
  it('no handle without a conversation, when expanded, or under 760 px', () => {
    const { container, unmount } = render(<Harness pane={false} />);
    expect(screen.queryByRole('separator')).toBeNull();
    expect(width(container)).toBe('');
    unmount();
    const expanded = render(<Harness initial={{ width: 38, expanded: true }} />);
    expect(screen.queryByRole('separator')).toBeNull();
    expect(expanded.container.querySelector('.view-body')).toHaveClass('conversation-expanded');
    expanded.unmount();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 760px)', addEventListener() {}, removeEventListener() {} }));
    render(<Harness />);
    expect(screen.queryByRole('separator')).toBeNull();
  });
  it('stacked under 760 px, selecting another session brings the conversation into view', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 760px)', addEventListener() {}, removeEventListener() {} }));
    const { rerender } = render(<Harness selectedId="a" />);
    expect(scroll).not.toHaveBeenCalled();
    rerender(<Harness selectedId="b" />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('conversation-pane'));
  });
  it('side by side, a selection does not scroll', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const { rerender } = render(<Harness selectedId="a" />);
    rerender(<Harness selectedId="b" />);
    expect(scroll).not.toHaveBeenCalled();
  });
});
