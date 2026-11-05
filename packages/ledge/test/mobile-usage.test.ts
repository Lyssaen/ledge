import { describe, it, expect, afterEach } from 'vitest';
import { PhoneServerMessageSchema, type HarnessUsage, type PhoneServerMessage } from '@ledge/protocol';
import { flush, setup, stopAll } from './helpers/gateway.js';

// The phone's « LIMITES » (docs/mockups/ledge-harness-usage.html): the windows' percent and resets, never the account id.
afterEach(stopAll);

const CLAUDE: HarnessUsage = { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: '2026-11-05T14:00:00.000Z',
  windows: [{ kind: 'five_hour', pct: 84, resetsAt: '2026-11-05T14:30:00.000Z' }, { kind: 'model', model: 'Opus', pct: 100, resetsAt: '2026-11-09T09:00:00.000Z' }] };
type Usage = Extract<PhoneServerMessage, { type: 'usage.state' }>;
const usages = (g: ReturnType<typeof setup>, id: string) => g.got(id).filter((m): m is Usage => m.type === 'usage.state');

describe('phone: usage', () => {
  it('after the snapshot, then on each change: the limits without the account', async () => {
    let current: HarnessUsage[] = [CLAUDE];
    const g = setup({ deps: { usage: () => ({ harnesses: current, prefs: { alert: 0.8 } }) } });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap && snap.type === 'snapshot' ? snap.daemon.usage : undefined).toBe(true);
    const [first] = usages(g, 'dev1');
    expect(PhoneServerMessageSchema.parse(first)).toEqual({ type: 'usage.state', harnesses: [{ harness: 'claude', status: 'ok', readAt: CLAUDE.readAt, windows: CLAUDE.windows }], prefs: { alert: 0.8 } });
    expect(JSON.stringify(first)).not.toContain(CLAUDE.account!);
    current = [{ ...CLAUDE, status: 'expired', windows: [] }];
    g.gw.forward({ type: 'usage.state', harnesses: current, alerts: [], prefs: { alert: 0.9 } });
    await flush();
    expect(usages(g, 'dev1').at(-1)).toEqual({ type: 'usage.state', harnesses: [{ harness: 'claude', status: 'expired', readAt: CLAUDE.readAt, windows: [] }], prefs: { alert: 0.9 } });
    // A device that did not ask for the sessions gets nothing.
    expect(usages(g, 'dev2')).toEqual([]);
  });

  it('a PC without usage says nothing and sends nothing', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.gw.forward({ type: 'usage.state', harnesses: [CLAUDE], alerts: [], prefs: { alert: 0.8 } });
    await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap && snap.type === 'snapshot' ? snap.daemon : {}).not.toHaveProperty('usage');
    expect(usages(g, 'dev1')).toEqual([]);
  });
});
