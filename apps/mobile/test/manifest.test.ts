import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8')) as {
  display: string; start_url: string; scope: string; background_color: string; theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

describe('manifest', () => {
  it('is a standalone app at the root', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.background_color).toBe('#0c0d0e');
    expect(manifest.theme_color).toBe('#0c0d0e');
  });

  it('declares any 192 and 512 icons and a maskable 512', () => {
    const find = (sizes: string, purpose: string) => manifest.icons.find((i) => i.sizes === sizes && (i.purpose ?? 'any') === purpose);
    expect(find('192x192', 'any')).toBeDefined();
    expect(find('512x512', 'any')).toBeDefined();
    expect(find('512x512', 'maskable')).toBeDefined();
  });

  it('only cites files that exist in public/', () => {
    for (const icon of manifest.icons) expect(existsSync(resolve(root, 'public', icon.src.replace(/^\//, ''))), icon.src).toBe(true);
  });

  it('index.html declares the favicons and the apple touch icon', () => {
    expect(html).toMatch(/<link[^>]*rel="icon"[^>]*type="image\/svg\+xml"[^>]*href="\/favicon\.svg"/);
    expect(html).toMatch(/<link[^>]*rel="icon"[^>]*href="\/favicon-32\.png"/);
    expect(html).toMatch(/<link[^>]*rel="apple-touch-icon"[^>]*sizes="180x180"[^>]*href="\/icon-180\.png"/);
    for (const f of ['favicon.svg', 'favicon-32.png', 'icon-180.png']) expect(existsSync(resolve(root, 'public', f)), f).toBe(true);
  });
});
