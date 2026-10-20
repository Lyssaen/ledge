import { describe, it, expect } from 'vitest';
import { PLAIN_MAX, SEALED_MAX, SealedFrameSchema } from '@ledge/protocol';
import { generateIdentity, startHandshake } from '@ledge/seal';
import { pad } from '../src/mobile/pad.js';

const size = (s: string) => Buffer.byteLength(s, 'utf8');
const jsonOf = (bytes: number) => JSON.stringify({ a: 'x'.repeat(bytes - 8) });

describe('pad', () => {
  it('pads {} to the first tier and JSON.parse still reads it', () => {
    const p = pad('{}')!;
    expect(size(p)).toBe(1024);
    expect(JSON.parse(p)).toEqual({});
  });
  it('moves a 1025-byte JSON to the next tier', () => {
    const j = jsonOf(1025);
    expect(size(j)).toBe(1025);
    expect(size(pad(j)!)).toBe(4096);
  });
  it('counts UTF-8 bytes, not characters', () => {
    const j = JSON.stringify({ a: 'é'.repeat(1000) });
    expect(size(pad(j)!)).toBe(4096);
  });
  it('keeps an exact tier size as is', () => {
    expect(pad(jsonOf(1024))).toBe(jsonOf(1024));
  });
  it('refuses past PLAIN_MAX', () => {
    expect(pad(jsonOf(PLAIN_MAX))).not.toBeNull();
    expect(pad(jsonOf(PLAIN_MAX + 1))).toBeNull();
    expect(pad('x'.repeat(655_361))).toBeNull();
  });
  it('a PLAIN_MAX message sealed fits a relay frame under SEALED_MAX', async () => {
    const pc = await generateIdentity();
    const dev = await generateIdentity();
    const a = await startHandshake(pc, 'pc', dev.publicKey);
    const b = await startHandshake(dev, 'device', pc.publicKey);
    const channel = await a.finish(b.hello);
    const padded = pad(jsonOf(PLAIN_MAX))!;
    const sealed = await channel.seal(padded);
    const body = JSON.stringify({ k: 'msg', s: sealed });
    expect(SealedFrameSchema.safeParse(JSON.parse(body)).success).toBe(true);
    expect(body.length).toBeLessThanOrEqual(SEALED_MAX);
  });
});
