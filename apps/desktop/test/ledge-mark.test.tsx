import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LedgeMark } from '../src/shell/LedgeMark';

const icons = resolve(__dirname, '../src-tauri/icons');
const sha = (f: string) => createHash('sha256').update(readFileSync(resolve(icons, f))).digest('hex');
/** icon.png before lot 3: the red watcher robot. The app icon is the Ledge mark now. */
const ROBOT_ICON_PNG = '3d7886502e3aec2347eb6bd9dcb3ddaf54c66ed739c9d37e4975f176ec176d8b';

describe('the Ledge mark', () => {
  it('draws the 16 viewBox under 24 px and the 64 one from 24 px, the mockup\'s shapes and colours', () => {
    const small = render(<LedgeMark size={16} />).container.querySelector('svg')!;
    expect(small).toHaveAttribute('viewBox', '0 0 16 16');
    expect(small).toHaveAttribute('width', '16');
    expect(small.querySelector('circle')).toHaveAttribute('fill', '#FF6467');
    const big = render(<LedgeMark size={48} />).container.querySelector('svg')!;
    expect(big).toHaveAttribute('viewBox', '0 0 64 64');
    expect(big.querySelector('rect')).toHaveAttribute('rx', '14');
    expect(render(<LedgeMark size={24} />).container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 64 64');
  });

  it('is the source of the app icons: each SVG draws the same shapes as the component', () => {
    const shapes = (svg: Element) => [...svg.children].map(c => `${c.tagName.toLowerCase()} ${[...c.attributes].map(a => `${a.name}=${a.value}`).sort().join(' ')}`);
    const file = (f: string) => new DOMParser().parseFromString(readFileSync(resolve(icons, f), 'utf8'), 'image/svg+xml').documentElement;
    for (const [f, size, box] of [['ledge-mark.svg', 64, '0 0 64 64'], ['ledge-mark-16.svg', 16, '0 0 16 16']] as const) {
      expect(file(f).getAttribute('viewBox'), f).toBe(box);
      expect(shapes(file(f)), f).toEqual(shapes(render(<LedgeMark size={size} />).container.querySelector('svg')!));
    }
  });

  it('icon.png is no longer the robot', () => {
    expect(sha('icon.png')).not.toBe(ROBOT_ICON_PNG);
  });
});
