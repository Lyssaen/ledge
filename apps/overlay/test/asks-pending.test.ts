import { describe, it, expect } from 'vitest';
import { isPending } from '../src/daemon/changes';
import { isPending as asksIsPending } from '../src/surface/useDaemonAsks';
describe('pending asks', () => { it('the asks hook and the change detector agree on what waits', () => { expect(asksIsPending).toBe(isPending); }); });
