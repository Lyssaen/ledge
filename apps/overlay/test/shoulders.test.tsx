import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Shoulders, SHOULDER_R } from '../src/surface/Shoulders';

const box = (c: HTMLElement, which: 'top' | 'bottom') => {
  const s = c.querySelector<HTMLElement>(`[data-shoulder="${which}"]`)!.style;
  return { top: parseFloat(s.top), h: parseFloat(s.height) };
};

describe('Shoulders', () => {
  it('overlap the surface instead of meeting it on a shared edge, which a fractional display scale shows as a seam', () => {
    const top = 100, h = 300;
    const { container } = render(<Shoulders top={top} h={h} w={380} transition="none" opacity={1} />);
    const above = box(container, 'top'), below = box(container, 'bottom');
    expect(above.top).toBe(top - SHOULDER_R);
    expect(above.top + above.h).toBeGreaterThan(top);
    expect(below.top).toBeLessThan(top + h);
    expect(below.top + below.h).toBe(top + h + SHOULDER_R);
  });
});
