import { describe, it, expect } from 'vitest';
import { compareVersions } from '../src/update/semver';

describe('compareVersions', () => {
  it('orders by major, minor, patch numerically', () => {
    expect(compareVersions('0.3.0', '0.2.9')).toBe(1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.2', '0.3.0')).toBe(-1);
  });
  it('treats a dev build as the oldest', () => { expect(compareVersions('0.0.0-dev', '0.0.1')).toBe(-1); });
});
