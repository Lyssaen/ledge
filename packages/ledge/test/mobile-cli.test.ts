import { describe, it, expect } from 'vitest';
import type { ClientMessage } from '@ledge/protocol';
import { runMobile } from '../src/cli/mobile.js';

function fake(reply?: unknown) {
  const sent: ClientMessage[] = [];
  const out: string[] = [];
  const connect = (async () => ({ send: (m: ClientMessage) => sent.push(m), next: async () => reply, close: async () => {} })) as never;
  return { sent, out, deps: { connect, print: (s: string) => out.push(s) } };
}

describe('ledge mobile', () => {
  it('enable sends mobile.configure and prints the tailscale serve command', async () => {
    const f = fake();
    expect(await runMobile(['enable', '--origin', 'https://pc.tail1.ts.net/'], f.deps)).toBe(0);
    expect(f.sent).toEqual([{ type: 'mobile.configure', origin: 'https://pc.tail1.ts.net' }]);
    expect(f.out.join('\n')).toContain('tailscale serve --bg --https=443 http://127.0.0.1:47832');
  });
  it('enable refuses a bad origin without connecting', async () => {
    const f = fake();
    expect(await runMobile(['enable', '--origin', 'http://pc.t.ts.net'], f.deps)).toBe(1);
    expect(await runMobile(['enable'], f.deps)).toBe(1);
    expect(f.sent).toEqual([]);
  });
  it('disable sends a null origin', async () => {
    const f = fake();
    expect(await runMobile(['disable'], f.deps)).toBe(0);
    expect(f.sent).toEqual([{ type: 'mobile.configure', origin: null }]);
  });
  it('status asks for devices and prints origin, listening state and devices', async () => {
    const f = fake({ type: 'devices', origin: 'https://pc.tail1.ts.net', listening: true, devices: [{ id: 'd1', name: 'iPhone', createdAt: '2026-10-14T10:00:00.000Z', hasKey: true }] });
    expect(await runMobile(['status'], f.deps)).toBe(0);
    expect(f.sent).toEqual([{ type: 'devices' }]);
    const t = f.out.join('\n');
    expect(t).toContain('https://pc.tail1.ts.net'); expect(t).toContain('listening: yes'); expect(t).toContain('iPhone');
  });
  it('fails clearly when the daemon is not running', async () => {
    const out: string[] = [];
    expect(await runMobile(['status'], { connect: (async () => { throw new Error('x'); }) as never, print: s => out.push(s) })).toBe(1);
    expect(out[0]).toContain('daemon not running');
  });
});
