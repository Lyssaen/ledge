import { describe, it, expect } from 'vitest';
import { MobileLinkStateSchema } from '../src/index.js';

describe('mobile link state', () => {
  it('accepts an unavailable link with a bounded error', () => {
    expect(MobileLinkStateSchema.parse({ state: 'unavailable', error: 'x' })).toEqual({ state: 'unavailable', error: 'x' });
    expect(() => MobileLinkStateSchema.parse({ state: 'unavailable', error: 'x'.repeat(201) })).toThrow();
    expect(() => MobileLinkStateSchema.parse({ state: 'unavailable', error: 'x'.repeat(200) })).not.toThrow();
  });
});
