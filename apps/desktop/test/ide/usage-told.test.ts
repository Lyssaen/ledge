import { describe, expect, it } from 'vitest';
import type { UsageAlert } from '@ledge/protocol';
import { untold } from '../../src/ide/usageTold';

describe('usage alerts in the IDE (the user, 2026-11-09)', () => {
  it('each alert is told once, the ids kept', () => {
    const a = { id: 'claude|five_hour|1' } as UsageAlert, b = { id: 'codex|seven_day|1' } as UsageAlert;
    const told: string[] = [];
    expect(untold([a], told)).toEqual([a]);
    expect(untold([a, b], told)).toEqual([b]);
    expect(untold([a, b], told)).toEqual([]);
    expect(told).toEqual([a.id, b.id]);
  });
});
