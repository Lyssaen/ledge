import { describe, expect, it } from 'vitest';

const tick = () => new Promise(r => setTimeout(r, 20));
const go = async (hash: string) => { globalThis.location.hash = hash; await tick(); };

describe('« Retour »', () => {
  it('opened from outside goes to the fallback in place; inside the app, one step back to the screen before', async () => {
    // A notification opened the app on a thread: no screen of the app before it.
    globalThis.history.replaceState(null, '', '#/thread/s1');
    const { backTarget, goBack } = await import('../src/router');
    expect(backTarget({ name: 'sessions' })).toEqual({ route: { name: 'sessions' }, known: false, inApp: false });
    goBack({ name: 'sessions' });
    await tick();
    expect(globalThis.location.hash).toBe('#/sessions');
    // Replaced, not pushed: Sessions is still the first screen.
    expect(backTarget({ name: 'atoi' }).inApp).toBe(false);

    // Sessions → À toi → a request: back leads to À toi, then to Sessions.
    await go('#/');
    await go('#/request/s1/k1');
    expect(backTarget({ name: 'atoi' })).toEqual({ route: { name: 'atoi' }, known: true, inApp: true });
    goBack({ name: 'atoi' });
    await tick();
    expect(globalThis.location.hash).toBe('#/');
    expect(backTarget({ name: 'atoi' })).toEqual({ route: { name: 'sessions' }, known: true, inApp: true });

    // A new step after going back drops the one ahead: À toi → thread, back is À toi again.
    await go('#/thread/s2');
    expect(backTarget({ name: 'sessions' }).route).toEqual({ name: 'atoi' });
  });
});
