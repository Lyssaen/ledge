import { describe, it, expect } from 'vitest';
import { BROWSER_FRAME_MAX, BROWSER_TITLE_MAX, parseClientMessage, parseServerMessage } from '../src/index.js';

const at = '2026-11-03T15:20:00.000Z';

describe('browser: the agent\'s browser, live', () => {
  it('a session\'s browser in each of its states', () => {
    expect(parseServerMessage({ type: 'browser.live', id: 's1', state: 'none', tabs: 0 })).toMatchObject({ state: 'none' });
    expect(parseServerMessage({ type: 'browser.live', id: 's1', state: 'off', tabs: 1, since: at })).toMatchObject({ state: 'off' });
    expect(parseServerMessage({ type: 'browser.live', id: 's1', state: 'live', tabs: 2, url: 'http://localhost:8733/m.html', title: 'Maquette', since: at,
      image: { at, url: 'http://localhost:8733/m.html', title: 'Maquette' } })).toMatchObject({ tabs: 2, image: { at } });
    expect(parseServerMessage({ type: 'browser.live', id: 's1', state: 'closed', tabs: 0, url: 'about:blank', closedAt: at, closed: 'tabs' })).toMatchObject({ closed: 'tabs' });
    for (const bad of [{ state: 'gone' }, { state: 'closed', closed: 'crashed' }, { state: 'live', tabs: -1 }, { state: 'live', title: 'x'.repeat(BROWSER_TITLE_MAX + 1) }])
      expect(() => parseServerMessage({ type: 'browser.live', id: 's1', tabs: 0, ...bad })).toThrow();
  });

  it('a frame of the film, or the last image kept; never more than its cap', () => {
    expect(parseServerMessage({ type: 'browser.frame', id: 's1', data: '/9j/4AAQ', at, width: 1280, height: 800, live: true })).toMatchObject({ live: true });
    expect(parseServerMessage({ type: 'browser.frame', id: 's1', data: '/9j/4AAQ', at, live: false })).toMatchObject({ live: false });
    expect(() => parseServerMessage({ type: 'browser.frame', id: 's1', data: 'x'.repeat(BROWSER_FRAME_MAX + 1), at, live: true })).toThrow();
    expect(() => parseServerMessage({ type: 'browser.frame', id: 's1', data: '', at, live: true })).toThrow();
  });

  it('watch, unwatch; enabling needs the person\'s confirmation', () => {
    expect(parseClientMessage({ type: 'browser.watch', id: 's1' })).toEqual({ type: 'browser.watch', id: 's1' });
    expect(parseClientMessage({ type: 'browser.unwatch', id: 's1' })).toEqual({ type: 'browser.unwatch', id: 's1' });
    expect(parseClientMessage({ type: 'browser.enable', rid: 'r1', confirmed: true })).toMatchObject({ confirmed: true });
    expect(() => parseClientMessage({ type: 'browser.enable', rid: 'r1' })).toThrow();
    expect(() => parseClientMessage({ type: 'browser.enable', rid: 'r1', confirmed: false })).toThrow();
    expect(parseServerMessage({ type: 'browser.enabled', rid: 'r1', outcome: 'refused', reason: 'not_configured' })).toMatchObject({ reason: 'not_configured' });
    expect(parseServerMessage({ type: 'browser.enabled', rid: 'r1', outcome: 'enabled', path: '/home/u/.config/playwright-mcp/config.json' })).toMatchObject({ outcome: 'enabled' });
  });
});
