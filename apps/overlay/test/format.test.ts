import { describe, it, expect } from 'vitest';
import { relativeTime, toolName, duration } from '../src/format';
import { messagesFor } from '../src/i18n/lang';
const T = Date.parse('2026-10-09T18:00:00.000Z');
describe('format', () => {
  it('relative time', () => {
    expect(relativeTime('2026-10-09T17:59:12.000Z', T)).toBe('48s');
    expect(relativeTime('2026-10-09T17:48:00.000Z', T)).toBe('12m');
    expect(relativeTime('2026-10-09T15:00:00.000Z', T)).toBe('3h');
  });
  it('tool names', () => { expect(toolName('cursor')).toBe('Cursor Agent'); });
});

describe('duration', () => {
  it('reads minutes and seconds in the current language', () => {
    expect(duration(160_000, messagesFor('en'))).toBe('2m 40s');
    expect(duration(160_000, messagesFor('fr'))).toBe('2 min 40 s');
    expect(duration(48_000, messagesFor('en'))).toBe('48s');
    expect(duration(3_600_000 + 5 * 60_000, messagesFor('en'))).toBe('1h 5m');
  });
});
