import { describe, expect, it } from 'vitest';
import { openInLedge, subscribeOpenInLedge, type LedgeTarget } from '../src/desktop/openInLedge';

describe('openInLedge', () => {
  it('tells every subscriber, in order, and a removed one hears nothing more', () => {
    const heard: LedgeTarget[] = [];
    const stop = subscribeOpenInLedge(target => heard.push(target));
    const other: LedgeTarget[] = [];
    const stopOther = subscribeOpenInLedge(target => other.push(target));
    openInLedge({ kind: 'session', id: 'otto' });
    openInLedge({ kind: 'settings' });
    stop();
    openInLedge({ kind: 'launch' });
    stopOther();
    expect(heard).toEqual([{ kind: 'session', id: 'otto' }, { kind: 'settings' }]);
    expect(other).toEqual([{ kind: 'session', id: 'otto' }, { kind: 'settings' }, { kind: 'launch' }]);
  });
});
