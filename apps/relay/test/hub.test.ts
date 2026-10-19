import { describe, it, expect } from 'vitest';
import type { RelayServerMessage } from '@ledge/protocol';
import { Hub, type Conn, type Who } from '../src/hub.js';
import type { RelayLogEvent } from '../src/log.js';

const D1 = 'd_aaaaaaaaaaaaaaaa', D2 = 'd_bbbbbbbbbbbbbbbb';

class Fake implements Conn {
  sent: RelayServerMessage[] = [];
  closed: Array<[number, string]> = [];
  send(m: RelayServerMessage) { this.sent.push(m); }
  close(c: number, r: string) { this.closed.push([c, r]); }
}
const pc = (a = 'A'): Who => ({ accountId: a, peer: 'pc' });
const dev = (p: string, a = 'A'): Who => ({ accountId: a, peer: p as Who['peer'] });
const send = (to: string, body: string) => JSON.stringify({ type: 'send', to, body });
function setup(limits = {}) {
  const events: RelayLogEvent[] = [];
  return { hub: new Hub((e) => events.push(e), limits), events };
}

describe('Hub', () => {
  it('routes a device frame to its PC and back', () => {
    const { hub } = setup();
    const p = new Fake(), d = new Fake();
    hub.attach(p, pc()); hub.attach(d, dev(D1));
    hub.receive(d, send('pc', 'up'));
    hub.receive(p, send(D1, 'down'));
    expect(p.sent).toContainEqual({ type: 'deliver', from: D1, body: 'up' });
    expect(d.sent).toContainEqual({ type: 'deliver', from: 'pc', body: 'down' });
  });

  it('welcomes with who is online and tells the others', () => {
    const { hub } = setup();
    const d = new Fake(), p = new Fake();
    hub.attach(d, dev(D1));
    expect(d.sent[0]).toEqual({ type: 'welcome', accountId: 'A', self: D1, online: [] });
    hub.attach(p, pc());
    expect(d.sent[1]).toEqual({ type: 'presence', peer: 'pc', online: true });
    expect(p.sent[0]).toEqual({ type: 'welcome', accountId: 'A', self: 'pc', online: [D1] });
    hub.detach(d, 1000);
    expect(p.sent[1]).toEqual({ type: 'presence', peer: D1, online: false });
  });

  it('replaces a second PC socket and closes the first', () => {
    const { hub } = setup();
    const p1 = new Fake(), p2 = new Fake(), d = new Fake();
    hub.attach(p1, pc()); hub.attach(d, dev(D1)); hub.attach(p2, pc());
    expect(p1.closed).toEqual([[4000, 'replaced']]);
    hub.detach(p1, 4000);
    hub.receive(d, send('pc', 'x'));
    expect(p2.sent.filter((m) => m.type === 'deliver')).toHaveLength(1);
    expect(p1.sent.filter((m) => m.type === 'deliver')).toHaveLength(0);
    expect(d.sent.some((m) => m.type === 'presence' && !m.online)).toBe(false);
  });

  it('keeps accounts apart', () => {
    const { hub } = setup();
    const pa = new Fake(), db = new Fake();
    hub.attach(pa, pc('A')); hub.attach(db, dev(D1, 'B'));
    hub.receive(pa, send(D1, 'x'));
    expect(pa.sent.at(-1)).toEqual({ type: 'error', code: 'offline', to: D1 });
    expect(db.sent).toHaveLength(1); // welcome only
  });

  it('refuses device-to-device frames and pc-to-pc', () => {
    const { hub } = setup();
    const d1 = new Fake(), d2 = new Fake(), p = new Fake();
    hub.attach(d1, dev(D1)); hub.attach(d2, dev(D2)); hub.attach(p, pc());
    hub.receive(d1, send(D2, 'x'));
    expect(d1.sent.at(-1)).toEqual({ type: 'error', code: 'bad_target' });
    hub.receive(p, send('pc', 'x'));
    expect(p.sent.at(-1)).toEqual({ type: 'error', code: 'bad_target' });
    expect(d2.sent.some((m) => m.type === 'deliver')).toBe(false);
  });

  it('says offline instead of queuing', () => {
    const { hub } = setup();
    const d = new Fake(), p = new Fake();
    hub.attach(d, dev(D1));
    hub.receive(d, send('pc', 'old'));
    expect(d.sent.at(-1)).toEqual({ type: 'error', code: 'offline', to: 'pc' });
    hub.attach(p, pc());
    expect(p.sent.some((m) => m.type === 'deliver')).toBe(false);
  });

  it('answers bad JSON, unknown types and oversize bodies on that socket only', () => {
    const { hub } = setup();
    const p = new Fake(), d = new Fake();
    hub.attach(p, pc()); hub.attach(d, dev(D1));
    const n = p.sent.length;
    hub.receive(d, '{nope');
    expect(d.sent.at(-1)).toEqual({ type: 'error', code: 'bad_frame' });
    hub.receive(d, JSON.stringify({ type: 'ping' }));
    expect(d.sent.at(-1)).toEqual({ type: 'error', code: 'bad_frame' });
    hub.receive(d, send('pc', 'x'.repeat(1_048_577)));
    expect(d.sent.at(-1)).toEqual({ type: 'error', code: 'too_large' });
    expect(p.sent).toHaveLength(n);
  });

  it('rate-limits a flooding socket', () => {
    let t = 0;
    const { hub } = setup({ framesPerWindow: 3, windowMs: 1000, now: () => t });
    const p = new Fake(), d = new Fake();
    hub.attach(p, pc()); hub.attach(d, dev(D1));
    for (let i = 0; i < 4; i++) hub.receive(d, send('pc', String(i)));
    expect(d.sent.at(-1)).toEqual({ type: 'error', code: 'rate_limited' });
    expect(p.sent.filter((m) => m.type === 'deliver')).toHaveLength(3);
    t = 1000;
    hub.receive(d, send('pc', 'again'));
    expect(p.sent.filter((m) => m.type === 'deliver')).toHaveLength(4);
  });

  it('logs sizes and counts, never a body', () => {
    const { hub, events } = setup();
    const p = new Fake(), d = new Fake();
    hub.attach(p, pc()); hub.attach(d, dev(D1));
    hub.receive(d, send('pc', 'SECRET-123'));
    hub.receive(d, JSON.stringify({ type: 'send', to: 'admin', body: 'SECRET-456' }));
    hub.detach(d, 1000); hub.detach(p, 1000);
    expect(events.some((e) => e.ev === 'frame_error')).toBe(true);
    for (const e of events) expect(JSON.stringify(e)).not.toContain('SECRET');
    const dis = events.find((e) => e.ev === 'disconnect' && e.peer === D1);
    expect(dis).toMatchObject({ framesIn: 2, bytesOut: 0 });
    expect(events.find((e) => e.ev === 'disconnect' && e.peer === 'pc')).toMatchObject({ bytesOut: 10 });
  });
});
