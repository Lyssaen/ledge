import { describe, expect, it } from 'vitest';

const tick = () => new Promise(r => setTimeout(r, 20));
const go = async (hash: string) => { globalThis.location.hash = hash; await tick(); };

describe('« Retour »', () => {
  it('opened from outside goes to the fallback in place; inside the app, one step back to the screen before', async () => {
    // A notification opened the app on a thread: no screen of the app before it.
    globalThis.history.replaceState(null, '', '#/thread/s1');
    const { backTarget, goBack } = await import('../src/router');
    expect(backTarget({ name: 'agents' })).toEqual({ route: { name: 'agents' }, known: false, inApp: false });
    goBack({ name: 'agents' });
    await tick();
    expect(globalThis.location.hash).toBe('#/agents');
    // Replaced, not pushed: the agents are still the first screen.
    expect(backTarget({ name: 'inbox' }).inApp).toBe(false);

    // Agents → inbox → a request: back leads to the inbox, then to the agents.
    await go('#/');
    await go('#/request/s1/k1');
    expect(backTarget({ name: 'inbox' })).toEqual({ route: { name: 'inbox' }, known: true, inApp: true });
    goBack({ name: 'inbox' });
    await tick();
    expect(globalThis.location.hash).toBe('#/');
    expect(backTarget({ name: 'inbox' })).toEqual({ route: { name: 'agents' }, known: true, inApp: true });

    // A new step after going back drops the one ahead: inbox → thread, back is the inbox again.
    await go('#/thread/s2');
    expect(backTarget({ name: 'agents' }).route).toEqual({ name: 'inbox' });
  });
});
