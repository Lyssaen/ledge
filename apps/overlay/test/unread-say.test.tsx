import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnreadSay } from '../src/surface/UnreadSay';

describe('<UnreadSay>', () => {
  it('speaks the given line when visible and opens on click', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<UnreadSay visible top={100} text="Hey! I answered you!" kind="ledge" onOpen={onOpen} />);
    const say = screen.getByRole('button', { name: 'Hey! I answered you!' });
    expect(say).toHaveAttribute('data-unread-say');
    expect(say).toHaveAttribute('data-say-kind', 'ledge');
    expect(say).toHaveStyle({ opacity: '1' });
    fireEvent.click(say);
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(<UnreadSay visible={false} top={100} text="Hey! I answered you!" kind="ledge" onOpen={onOpen} />);
    expect(say).toHaveStyle({ opacity: '0' });
  });
});
