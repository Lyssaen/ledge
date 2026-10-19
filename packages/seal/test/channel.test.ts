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
  it('accepts a frame only once when opens run concurrently', async () => {
    const { cpc, cdev } = await pair();
    const a = await cpc.seal('a');
    const r = await Promise.allSettled([cdev.open(a), cdev.open(a)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'replay' });
  });
  it('opens in-order frames concurrently', async () => {
    const { cpc, cdev } = await pair();
    const a = await cpc.seal('a'), b = await cpc.seal('b');
    expect(await Promise.all([cdev.open(a), cdev.open(b)])).toEqual(['a', 'b']);
  });
  it('resolves seals in seq order', async () => {
    const { cpc, cdev } = await pair();
    const order: string[] = [];
    await Promise.all(Array.from({ length: 20 }, (_, i) => cpc.seal(`m${i}`).then((f) => void order.push(f))));
    for (let i = 0; i < 20; i++) expect(await cdev.open(order[i]!)).toBe(`m${i}`);
  });
  it('finishes only once', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity();
    const hp = await startHandshake(pc, 'pc', dev.publicKey);
    const hd = await startHandshake(dev, 'device', pc.publicKey);
    await hp.finish(hd.hello);
    await expect(hp.finish(hd.hello)).rejects.toMatchObject({ code: 'bad_key' });
  });
  it('stays usable after a rejected frame', async () => {
    const { cpc, cdev } = await pair();
    const good = await cpc.seal('hello');
    const bytes = fromB64u(good);
    bytes[bytes.length - 1]! ^= 1;
    await expect(cdev.open(b64u(bytes))).rejects.toMatchObject({ code: 'bad_seal' });
    expect(await cdev.open(good)).toBe('hello');
  });
  it('consumes the handshake synchronously on concurrent finish', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity();
    const hp = await startHandshake(pc, 'pc', dev.publicKey);
    const hd = await startHandshake(dev, 'device', pc.publicKey);
    const r = await Promise.allSettled([hp.finish(hd.hello), hp.finish(hd.hello)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'bad_key' });
  });
  it('a failed finish consumes the handshake', async () => {
    const pc = await generateIdentity(), dev = await generateIdentity();
    const hp = await startHandshake(pc, 'pc', dev.publicKey);
    const hd = await startHandshake(dev, 'device', pc.publicKey);
    await expect(hp.finish('AAAA')).rejects.toMatchObject({ code: 'bad_key' });
    await expect(hp.finish(hd.hello)).rejects.toMatchObject({ code: 'bad_key' });
  });
});
