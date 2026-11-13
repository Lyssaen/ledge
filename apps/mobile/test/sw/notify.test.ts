import { describe, expect, it } from 'vitest';
import { NOTIFY, notifyLang, notifyText } from '../../src/sw/notify';

describe('the notifications\' words (Q29)', () => {
  it('has the same titles in French and English', () => {
    expect(Object.keys(NOTIFY.en.title).sort()).toEqual(Object.keys(NOTIFY.fr.title).sort());
    expect(Object.keys(NOTIFY.en).sort()).toEqual(Object.keys(NOTIFY.fr).sort());
  });

  it('writes the title from kind and name, keeps the PC\'s title without a name, and the PC\'s body', () => {
    expect(notifyText({ kind: 'decision', name: 'Pim', title: 'Pim attend votre décision', body: 'Laquelle ?' }, 'en')).toEqual({ title: 'Pim needs your decision', body: 'Laquelle ?' });
    // Ledge speaks for the sessions (board 7): a request, a question and a point are Ledge's, the session named once, in the body.
    expect(notifyText({ kind: 'question', name: 'Pim', title: 'Ledge', body: 'Pim · Laquelle ?' }, 'en')).toEqual({ title: 'Ledge', body: 'Pim · Laquelle ?' });
    expect(notifyText({ kind: 'request', name: 'Pim', title: 'Ledge', body: 'pnpm test' }, 'fr')).toEqual({ title: 'Ledge', body: 'Pim · pnpm test' });
    expect(notifyText({ kind: 'point', title: 'Ledge', body: 'Rex a fini.' }, 'en')).toEqual({ title: 'Ledge', body: 'Rex a fini.' });
    expect(notifyText({ kind: 'finished', title: 'Pim a terminé', body: 'Fait.' }, 'en')).toEqual({ title: 'Pim a terminé', body: 'Fait.' });
  });

  it('reads only fr and en as languages', () => {
    expect([notifyLang('en'), notifyLang('fr'), notifyLang('de'), notifyLang(undefined), notifyLang(null)]).toEqual(['en', 'fr', 'fr', 'fr', 'fr']);
  });
});
