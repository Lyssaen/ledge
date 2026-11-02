import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolImages } from '../src/cli/toolImages.js';

const claude = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
const mcp = { type: 'image', data: 'BBBB', mimeType: 'image/jpeg' };
// 1x1 PNG header is enough for imageInfo (IHDR at 12, size at 16..24)
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])]);

describe('toolImages', () => {
  it('reads Claude and MCP image blocks, in order, at most 5', () => {
    expect(toolImages([{ type: 'text', text: 'x' }, claude, mcp])).toEqual([{ mime: 'image/png', data: 'AAAA' }, { mime: 'image/jpeg', data: 'BBBB' }]);
    expect(toolImages(Array(7).fill(claude))).toHaveLength(5);
    expect(toolImages([{ type: 'image', data: 'C', mimeType: 'image/tiff' }])).toEqual([]);
    expect(toolImages('text only')).toEqual([]);
  });

  describe('[Image: source: <path>] fallback', () => {
    const setup = () => {
      const home = mkdtempSync(join(tmpdir(), 'ledge-ti-'));
      const dir = join(home, '.claude', 'projects', 'p', 's', 'tool-results'); mkdirSync(dir, { recursive: true });
      const file = join(dir, 'a.png'); writeFileSync(file, png);
      return { home, file };
    };
    const text = (path: string) => ({ type: 'text', text: `[Image: source: ${path}]` });

    it('reads the file named by a text block when there is no image block', () => {
      const { home, file } = setup();
      expect(toolImages([{ type: 'text', text: 'Took it' }, text(file)], home)).toEqual([{ mime: 'image/png', data: png.toString('base64') }]);
    });
    it('is ignored when an image block is present', () => {
      const { home, file } = setup();
      expect(toolImages([claude, text(file)], home)).toEqual([{ mime: 'image/png', data: 'AAAA' }]);
    });
    it('refuses a path outside <home>/.claude/projects, a symlink out of it, a missing or non-image file', () => {
      const { home, file } = setup();
      const outside = join(home, 'secret.png'); writeFileSync(outside, png);
      const link = join(home, '.claude', 'projects', 'link.png'); symlinkSync(outside, link);
      const notImage = join(home, '.claude', 'projects', 'n.png'); writeFileSync(notImage, 'hello');
      for (const p of [outside, link, notImage, join(home, '.claude', 'projects', 'nope.png'), `${join(home, '.claude', 'projects')}/../secret.png`]) expect(toolImages([text(p)], home)).toEqual([]);
      expect(toolImages([text(file)], home)).toHaveLength(1);
    });
  });
});
