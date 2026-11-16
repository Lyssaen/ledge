import { en } from './en.ts';
import { fr, type Catalogue } from './fr.ts';

export type { Catalogue };
export type Locale = 'fr' | 'en';

/** French is the default language and lives at the root; every other language has its own prefix. */
export const defaultLocale: Locale = 'fr';

/** What the page needs to know about a language besides its copy: the short code the switch shows, the name a screen
 *  reader announces (each in its own language, as a visitor looking for it would read it) and its Open Graph locale. */
export const locales: Record<Locale, { code: string; name: string; og: string; path: string; copy: Catalogue }> = {
  fr: { code: 'FR', name: 'Français', og: 'fr_FR', path: '/', copy: fr },
  en: { code: 'EN', name: 'English', og: 'en_US', path: '/en/', copy: en }
};

export const localeList = Object.keys(locales) as Locale[];

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A command or a value shown in monospace inside a sentence; `tone` picks its colour (see `.code--*` in the stylesheet). */
export const code = (text: string, tone: 'amber' | 'ink' | 'amber-inline' = 'ink'): string =>
  `<code class="code code--${tone}">${escapeHtml(text)}</code>`;

/** Turns a catalogue string into safe HTML: the text is escaped, then each `{name}` hole receives the markup given for it.
 *  A hole with no markup is a mistake in the component, so it fails the build instead of printing braces. */
export function rich(text: string, holes: Record<string, string> = {}): string {
  return escapeHtml(text).replace(/\{(\w+)\}/g, (_, name: string) => {
    const html = holes[name];
    if (html === undefined) throw new Error(`No markup given for the hole {${name}} in “${text}”`);
    return html;
  });
}
