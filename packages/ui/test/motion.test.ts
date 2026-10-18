import { describe, it, expect } from 'vitest';
import { transition, ms, MOTION } from '../src/motion';

describe('motion', () => {
  it('scales every duration by VITE_LEDGE_MOTION (0 in tests)', () => {
    expect(ms(320)).toBe('0ms');
  });
  it('builds a transition string from the vocabulary', () => {
    expect(transition([['width', 'grow'], ['opacity', 'fadeIn', 200]])).toBe(`width 0ms ${MOTION.grow.ease} 0ms, opacity 0ms ease-out 0ms`);
  });
  it('keeps the three curves exactly as the design system states', () => {
    expect(MOTION.grow).toEqual({ ms: 320, ease: 'cubic-bezier(.22,1,.36,1)', delayMs: 0 });
    expect(MOTION.shrink).toEqual({ ms: 260, ease: 'cubic-bezier(.65,0,.35,1)', delayMs: 60 });
    expect(MOTION.pop.ease).toBe('cubic-bezier(.34,1.3,.64,1)');
  });
  it('card exit is 300 ms after 180 ms', () => {
    expect(MOTION.cardExit).toEqual({ ms: 300, ease: 'cubic-bezier(.65,0,.35,1)', delayMs: 180 });
    expect(transition([['max-height', 'cardExit']])).toBe('max-height 0ms cubic-bezier(.65,0,.35,1) 0ms');
  });
});
