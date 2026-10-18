import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Shoulders, SHOULDER_R, STRIP_SHOULDER_R, shoulderR } from '../src/surface/Shoulders';

const box = (c: HTMLElement, which: 'left' | 'right') => {
  const s = c.querySelector<HTMLElement>(`[data-shoulder="${which}"]`)!.style;
  return { left: parseFloat(s.left), top: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
};

describe('Shoulders', () => {
  it('sit either side of the island on the top edge and overlap it by a pixel, so a fractional display scale shows no seam', () => {
    const left = 900, w = 117;
    const { container } = render(<Shoulders left={left} w={w} transition="none" opacity={1} />);
    const l = box(container, 'left'), r = box(container, 'right');
    expect(l).toMatchObject({ left: left - SHOULDER_R, top: 0, h: SHOULDER_R });
    expect(l.left + l.w).toBeGreaterThan(left);
    expect(r.left).toBeLessThan(left + w);
    expect(r.left + r.w).toBe(left + w + SHOULDER_R);
    expect(container.querySelector('[data-shoulder="right"] svg')).toHaveStyle({ transform: 'scaleX(-1)' });
  });
  it('the strip gets 6 px fillets; a surface narrower than twice the radius gets smaller ones', () => {
    expect(shoulderR(117)).toBe(SHOULDER_R);
    expect(shoulderR(117, true)).toBe(STRIP_SHOULDER_R);
    expect(shoulderR(10)).toBe(5);
    // The box keeps the 12 px fillet's size; the 6 px fillet is drawn against the island, so a change of radius never parts them.
    const { container } = render(<Shoulders left={900} w={48} strip transition="none" opacity={1} />);
    expect(box(container, 'left')).toMatchObject({ left: 900 - SHOULDER_R, h: SHOULDER_R });
    expect(container.querySelector('[data-shoulder="left"] path')!.getAttribute('d')).toBe('M6,0 H13 V6 H12 A6,6 0 0 0 6,0 Z');
  });
  it('a path that fills the top-outer corner: from the screen edge, into the island, down its edge, back along the arc', () => {
    const { container } = render(<Shoulders left={900} w={117} transition="none" opacity={1} />);
    expect(container.querySelector('[data-shoulder="left"] path')!.getAttribute('d')).toBe('M0,0 H13 V12 H12 A12,12 0 0 0 0,0 Z');
  });
});
