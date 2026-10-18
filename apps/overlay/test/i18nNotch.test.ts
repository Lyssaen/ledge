import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../src/i18n/messages';

/** Every string a message table can show: values, and what its functions return for dummy arguments. */
function allStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') {
    try { const r = (node as (...a: unknown[]) => unknown)('x', 1); if (typeof r === 'string') out.push(r); else if (r && typeof r === 'object') allStrings(r, out); } catch { /* not a text function */ }
  } else if (node && typeof node === 'object') for (const v of Object.values(node)) allStrings(v, out);
  return out;
}
const words = (lang: 'fr' | 'en') => allStrings(MESSAGES[lang]).join('\n');

describe('the notch is called the notch', () => {
  it('never says island any more', () => {
    expect(words('fr')).not.toMatch(/\bîles?\b|l’île|l'île/i);
    expect(words('en')).not.toMatch(/\bislands?\b/i);
  });
  it('names the notch in each language', () => {
    expect(words('fr')).toMatch(/encoche/i);
    expect(words('en')).toMatch(/notch/i);
  });
});
