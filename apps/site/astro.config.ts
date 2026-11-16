import { defineConfig } from 'astro/config';
import { site } from './src/config.ts';

// The site is fully static: two prerendered pages (French at `/`, English at `/en/`) and the media in `public/`.
export default defineConfig({
  site: site.url,
  trailingSlash: 'always',
  i18n: { locales: ['fr', 'en'], defaultLocale: 'fr', routing: { prefixDefaultLocale: false } },
  devToolbar: { enabled: false }
});
