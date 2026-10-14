import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PWA manifest and shell', () => {
  it('the manifest installs under /m/ in standalone with the dark background', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m).toMatchObject({ name: 'Ledge', short_name: 'Ledge', start_url: '/m/', scope: '/m/', display: 'standalone', background_color: '#0c0d0e', theme_color: '#0c0d0e' });
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512']);
  });

  it('index.html declares the iOS standalone metas and loads no inline script', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('lang="fr"');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('content="black-translucent"');
    expect(html).toContain('rel="apple-touch-icon" href="/m/icons/180.png"');
    expect(html).toContain('name="theme-color" content="#0c0d0e"');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});
