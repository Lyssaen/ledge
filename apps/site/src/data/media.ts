import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The one place that knows where the media live. The captures were first recorded in French and sit in `public/media/`;
// a capture recorded in another language sits in `public/media/<language>/` under the same file name. This module runs
// at build time only (it reads the disk), so it is imported by components and never by the scripts sent to the browser.

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
/** Astro builds and serves from the project's folder, so `public/` is found from the working directory. */
const mediaDir = resolve(process.cwd(), 'public/media');

/** The public address of a page or a file at the root of the site (`/`, `/en/`, `/favicon.svg`). */
export const local = (path: string): string => `${base}${path}`;

/** Returns the resolver of media files for a language: the capture recorded in that language when the file exists at
 *  build time, the French one otherwise. Components call it with `Astro.currentLocale`. */
export function mediaFor(locale: string | undefined): (file: string) => string {
  return file => (locale !== undefined && existsSync(resolve(mediaDir, locale, file)) ? `${base}/media/${locale}/${file}` : `${base}/media/${file}`);
}
