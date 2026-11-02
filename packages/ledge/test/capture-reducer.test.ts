import { describe, expect, it, afterEach } from 'vitest';
import { PNG } from 'pngjs';
import { CaptureReducer } from '../src/daemon/captureReducer.js';
import { imageInfo } from '../src/imageInfo.js';

const stub = new URL('./fixtures/reduce-worker-stub.mjs', import.meta.url);
const text = (b: Buffer) => b.toString();
let reducer: CaptureReducer | undefined;
afterEach(async () => { await reducer?.close(); reducer = undefined; });

describe('CaptureReducer', () => {
  it('reduces in the real worker', async () => {
    reducer = new CaptureReducer();
    const p = new PNG({ width: 800, height: 500 }); p.data.fill(200);
    const raw = PNG.sync.write(p);
    const out = await reducer.reduce(raw);
    expect(out.image.equals(raw)).toBe(true);
    expect(imageInfo(out.preview!)).toMatchObject({ mime: 'image/jpeg', width: 480, height: 300 });
    await expect(reducer.reduce(Buffer.from('nope'))).rejects.toMatchObject({ reason: 'not_image' });
  }, 20_000);
  it('runs the jobs one at a time, in order', async () => {
    reducer = new CaptureReducer(stub);
    const out = await Promise.all(['a', 'b', 'c'].map(s => reducer!.reduce(Buffer.from(s))));
    expect(out.map(o => text(o.image))).toEqual(['0:a', '1:b', '2:c']);
    await expect(reducer.reduce(Buffer.from('refuse'))).rejects.toMatchObject({ reason: 'not_image' });
  });
  it('answers a crash with unreadable and restarts for the next job', async () => {
    reducer = new CaptureReducer(stub);
    const [a, crash, b] = await Promise.allSettled(['a', 'crash', 'b'].map(s => reducer!.reduce(Buffer.from(s))));
    expect(a).toMatchObject({ status: 'fulfilled' });
    expect(crash).toMatchObject({ status: 'rejected', reason: { reason: 'unreadable' } });
    expect(b?.status === 'fulfilled' ? text(b.value.image) : b).toBe('0:b');
  });
});
