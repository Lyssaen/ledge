import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { flush, setup, stopAll } from './helpers/gateway.js';
afterEach(stopAll);
it('rejects OpenRig actions until the orchestrator is connected', async () => {
  const g = setup(); const op = randomUUID();
  g.send('dev1', { type: 'rig.act', op, key: 'valid', verb: 'down' });
  await flush();
  expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op, status: 'rejected', reason: 'unsupported' });
  expect(g.dispatched).toEqual([]);
});
