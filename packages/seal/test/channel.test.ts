import { describe, expect, it } from 'vitest';
import { b64u, fromB64u, generateIdentity, startHandshake } from '../src/index.js';

async function pair() {
  const pc = await generateIdentity(), dev = await generateIdentity();
  const hp = await startHandshake(pc, 'pc', dev.publicKey);
  const hd = await startHandshake(dev, 'device', pc.publicKey);
  const [cpc, cdev] = await Promise.all([hp.finish(hd.hello), hd.finish(hp.hello)]);
  return { pc, dev, cpc, cdev };
}

describe('channel', () => {
  it('carries text both ways', async () => {
    const { cpc, cdev } = await pair();
    expect(await cdev.open(await cpc.seal('session.decide accept'))).toBe('session.decide accept');
    expect(await cpc.open(await cdev.seal('é ✓'))).toBe('é ✓');
  });
  it('refuses a replayed or reordered frame', async () => {
    const { cpc, cdev } = await pair();
    const a = await cpc.seal('a'), b = await cpc.seal('b');
    await expect(cdev.open(b)).rejects.toMatchObject({ code: 'replay' });
    expect(await cdev.open(a)).toBe('a');
    await expect(cdev.open(a)).rejects.toMatchObject({ code: 'replay' });
  });
  it('refuses a flipped bit', async () => {
    const { cpc, cdev } = await pair();
    const bytes = fromB64u(await cpc.seal('hello'));
    bytes[bytes.length - 1]! ^= 1;
    await expect(cdev.open(b64u(bytes))).rejects.toMatchObject({ code: 'bad_seal' });
  });
  it('does not open a frame from another connection', async () => {
    const first = await pair();
    const old = await first.cpc.seal('old');
    const hp = await startHandshake(first.pc, 'pc', first.dev.publicKey);
    const hd = await startHandshake(first.dev, 'device', first.pc.publicKey);
    const cdev = await hd.finish(hp.hello);
    await expect(cdev.open(old)).rejects.toMatchObject({ code: 'bad_seal' });
  });
  it('fails when a side expects another peer key', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity(), other = await generateIdentity();
    const hp = await startHandshake(pc, 'pc', other.publicKey);
    const hd = await startHandshake(dev, 'device', pc.publicKey);
    const [cpc, cdev] = await Promise.all([hp.finish(hd.hello), hd.finish(hp.hello)]);
    await expect(cdev.open(await cpc.seal('x'))).rejects.toMatchObject({ code: 'bad_seal' });
  });
  it('cannot open its own frame as the peer’s', async () => {
    const { cpc } = await pair();
    await expect(cpc.open(await cpc.seal('x'))).rejects.toMatchObject({ code: 'bad_seal' });
  });
  it('rejects an invalid peer hello', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity();
    const hp = await startHandshake(pc, 'pc', dev.publicKey);
    await expect(hp.finish('AAAA')).rejects.toMatchObject({ code: 'bad_key' });
  });
});
