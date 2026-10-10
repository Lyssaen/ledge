import { describe, it, expect } from 'vitest';
import { verifyGone } from '../src/adapters/verify.js';

describe('verifyGone', () => {
  it('returns true as soon as the prompt is gone', async () => {
    const panes = ['Do you want to proceed?', 'Do you want to proceed?', 'Running tests'];
    let i = 0;
    const ok = await verifyGone(async () => panes[i++] ?? 'Running tests', p => p.includes('Do you want to proceed?'), { attempts: 3, intervalMs: 5 });
    expect(ok).toBe(true);
    expect(i).toBe(3);
  });
  it('returns false after the last attempt if it is still there', async () => {
    let calls = 0;
    const ok = await verifyGone(async () => { calls++; return 'Do you want to proceed?'; }, p => p.includes('proceed'), { attempts: 3, intervalMs: 5 });
    expect(ok).toBe(false);
    expect(calls).toBe(3);
  });
  it('defaults to 3 attempts over 600ms', async () => {
    const t0 = Date.now();
    await verifyGone(async () => 'still', () => true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
  });
});
