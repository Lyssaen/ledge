import { describe, expect, it } from 'vitest';
import type { PhoneEscalation, PhoneRig, PhoneSession } from '@ledge/protocol';
import { rigPlace, rigProgress, sortRigs } from '../../src/model/rigs';
import { point } from '../../src/model/point';
const rig: PhoneRig = { key: 'a', name: 'A', project: 'P', offProject: false, lifecycle: 'running', kernel: false, seats: [{ ref: 'r', address: '@a', name: 'A', runtime: 'codex', state: 'attention' }], repos: 1 };
const escalation: PhoneEscalation = { id: 'e', source: 'rig', rigKey: 'a', from: '@a', intent: 'decision', summary: 'question', questions: [], createdAt: '2026-11-01T10:00:00.000Z', state: 'pending' };
describe('rig models', () => {
  it('counts pending escalations but not grace, and keeps attention separate from working', () => {
    const state = { rigs: [rig], sessions: [] as PhoneSession[], escalations: [escalation, { ...escalation, id: 'g', state: 'grace' as const }], decisionsToday: [] };
    expect(point(state)).toMatchObject({ toYou: 1, rigs: [{ working: 0, total: 1 }] });
    expect(rigProgress(rig)).toEqual({ working: 0, total: 1 }); expect(rigPlace(rig)).toBe('dans P');
    expect(sortRigs([{ ...rig, key: 'b' }, rig], [escalation])[0]?.key).toBe('a');
  });
});
