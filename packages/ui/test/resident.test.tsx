import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ResidentMascot } from '../src/bots/ResidentMascot';
import './fixtures';

describe('the resident Ledge mascot', () => {
  it('finishes a hover greeting and releases its animation clock on unmount', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<ResidentMascot size={48} theme="dark" />);
      const face = screen.getByRole('img', { name: 'Ledge' });
      fireEvent.mouseEnter(face);
      expect(face).toHaveAttribute('data-gesture', 'happy');
      act(() => vi.advanceTimersByTime(900));
      expect(face).not.toHaveAttribute('data-gesture');
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
