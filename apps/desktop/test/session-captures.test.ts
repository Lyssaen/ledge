import { describe, expect, it } from 'vitest';
import type { AttachmentRef, ThreadItem, ToolItem } from '@ledge/protocol';
import { T0 } from '@ledge/fleet/test/mockDaemon';
import { capturesOf, exchangesOf } from '../src/session/captures';

const ref = (id: string): AttachmentRef => ({ id, mime: 'image/jpeg', width: 800, height: 600, bytes: 1000, preview: true });
const REF = ref('a'.repeat(32));
const REF2 = ref('b'.repeat(32));

const tool = (id: string, name: string, images?: AttachmentRef[], helperId?: string, turn = 1, output?: string): ToolItem =>
  ({ kind: 'tool', id, at: T0, turn, tool: name, label: name, status: 'success', files: [], ...(images ? { images } : {}), ...(helperId ? { helperId } : {}), ...(output ? { output } : {}) });
const nav = (id: string, url: string, helperId?: string) =>
  tool(id, 'mcp__plugin_playwright_playwright__browser_navigate', undefined, helperId, 1, `### Page\n- Page URL: ${url}\n- Page Title: x`);
const shot = (id: string, images: AttachmentRef[], helperId?: string, turn = 1) =>
  tool(id, 'mcp__plugin_playwright_playwright__browser_take_screenshot', images, helperId, turn);

describe('session captures', () => {
  it('lists captures in thread order with the page URL', () => {
    const caps = capturesOf([nav('n1', 'http://localhost:5173/'), shot('s1', [REF]), nav('n2', 'http://localhost:5173/tarifs'), shot('s2', [REF2])]);
    expect(caps.map(c => [c.key, c.url])).toEqual([['s1:0', 'http://localhost:5173/'], ['s2:0', 'http://localhost:5173/tarifs']]);
  });
  it('keeps two entries for the same bytes, and one per image of a row', () => {
    expect(capturesOf([shot('s1', [REF]), shot('s2', [REF])]).map(c => c.key)).toEqual(['s1:0', 's2:0']);
    expect(capturesOf([shot('s1', [REF, REF2])]).map(c => c.key)).toEqual(['s1:0', 's1:1']);
  });
  it('scopes the URL to the helper', () => {
    const caps = capturesOf([nav('n1', 'http://a/', undefined), nav('n2', 'http://b/', 'h1'), shot('s1', [REF], 'h1'), shot('s2', [REF2])]);
    expect(caps.map(c => [c.helperId, c.url])).toEqual([['h1', 'http://b/'], [undefined, 'http://a/']]);
  });
  it('names a non-Playwright image tool and gives it no URL', () => {
    expect(capturesOf([nav('n1', 'http://a/'), tool('t1', 'mcp__figma__get_screenshot', [REF])])[0]).toMatchObject({ tool: 'get_screenshot', url: undefined });
  });
  it('takes the last URL line of an output, from any Playwright tool', () => {
    const click = tool('c1', 'mcp__playwright__browser_click', undefined, undefined, 1, '- Page URL: http://x/1\n- Page URL: http://x/2');
    expect(capturesOf([click, shot('s1', [REF])])[0]!.url).toBe('http://x/2');
  });
  it('counts exchanges', () => {
    expect(exchangesOf(capturesOf([shot('s1', [REF], undefined, 1), shot('s2', [REF], undefined, 1), shot('s3', [REF], undefined, 2)]))).toBe(2);
  });
});
