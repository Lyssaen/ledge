import { describe, it, expect } from 'vitest';
import { imageBracket, takeImages, withImages } from '../src/attachmentText.js';

const dir = '/h/.ledge/attachments';
const id = 'a'.repeat(64);
const p = `${dir}/${id}.webp`;

describe('attachment text', () => {
  it('appends one bracket per image to the text', () => {
    expect(imageBracket(p)).toBe(`[Image attached: ${p}]`);
    expect(withImages('regarde', [p])).toBe(`regarde [Image attached: ${p}]`);
    expect(withImages('', [p])).toBe(`[Image attached: ${p}]`);
    expect(withImages('x', [p, `${dir}/${'b'.repeat(64)}.png`])).toBe(`x [Image attached: ${p}] [Image attached: ${dir}/${'b'.repeat(64)}.png]`);
  });

  it('takes the store\'s brackets back out, in order, and leaves other brackets', () => {
    const q = `${dir}/${'b'.repeat(64)}.png`;
    expect(takeImages(withImages('regarde', [p, q]), dir)).toEqual({ text: 'regarde', ids: [id, 'b'.repeat(64)] });
    expect(takeImages(withImages('', [p]), dir)).toEqual({ text: '', ids: [id] });
    const other = '[Image attached: /tmp/x.png] and [Image attached: /h/.ledge/attachments/../x.webp]';
    expect(takeImages(other, dir)).toEqual({ text: other, ids: [] });
  });

  it('keeps the person\'s own spacing and indentation around a bracket', () => {
    expect(takeImages(withImages('a  b\n    indented', [p]), dir).text).toBe('a  b\n    indented');
    expect(takeImages(`x  [Image attached: ${p}]  y   z`, dir).text).toBe('x  y   z');
  });
});
