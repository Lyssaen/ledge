import { describe, it, expect } from 'vitest';
import { relativeTime, toolName } from '../src/format';
const T = Date.parse('2026-10-09T18:00:00.000Z');
describe('format', () => {
  it('relative time', () => {
    expect(relativeTime('2026-10-09T17:59:12.000Z', T)).toBe('48s');
    expect(relativeTime('2026-10-09T17:48:00.000Z', T)).toBe('12m');
    expect(relativeTime('2026-10-09T15:00:00.000Z', T)).toBe('3h');
  });
  it('tool names', () => { expect(toolName('cursor')).toBe('Cursor Agent'); });
});
