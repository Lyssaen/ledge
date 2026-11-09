import { describe, expect, it } from 'vitest';
import { paletteRows, PALETTE_MAX, type PaletteCommand, type PaletteSession } from '../../src/ide/palette/model';

const noop = () => {};
const s = (id: string, waiting = false): PaletteSession => ({ kind: 'session', id, label: id, hint: 'ledge', waiting, run: noop });
const c = (label: string): PaletteCommand => ({ kind: 'command', id: label, label, run: noop });

const sessions = [s('Pim'), s('Nova', true), s('dev-front')];
const commands = [c('Nouvelle session'), c('Ouvrir les réglages'), c('Diviser le groupe à droite')];
const ids = (q: string) => paletteRows(q, sessions, commands).map(r => r.id);

describe('the IDE palette', () => {
  it('lists the waiting sessions, the commands, then the other sessions', () => {
    expect(ids('')).toEqual(['Nova', 'Nouvelle session', 'Ouvrir les réglages', 'Diviser le groupe à droite', 'Pim', 'dev-front']);
  });

  it('keeps the sessions and seats after @, the commands after >', () => {
    expect(ids('@')).toEqual(['Pim', 'Nova', 'dev-front']);
    expect(ids('>')).toEqual(['Nouvelle session', 'Ouvrir les réglages', 'Diviser le groupe à droite']);
    expect(ids('  @ dev')).toEqual(['dev-front']);
  });

  it('filters on a word, accents and case aside', () => {
    expect(ids('>reglages')).toEqual(['Ouvrir les réglages']);
    expect(ids('NOV')).toEqual(['Nova']);
    expect(ids('zzz')).toEqual([]);
  });

  it('shows ten rows at most', () => {
    const many = Array.from({ length: 15 }, (_, i) => s(`s${i}`));
    expect(paletteRows('@', many, [])).toHaveLength(PALETTE_MAX);
  });

  it('puts the open MRs and PRs after the commands, before the sessions that wait for nothing; > keeps them', () => {
    const prs = [c('#225 layout.ts')];
    expect(paletteRows('', sessions, commands, prs).map(r => r.id)).toEqual(['Nova', 'Nouvelle session', 'Ouvrir les réglages', 'Diviser le groupe à droite', '#225 layout.ts', 'Pim', 'dev-front']);
    expect(paletteRows('>#22', sessions, commands, prs).map(r => r.id)).toEqual(['#225 layout.ts']);
    expect(paletteRows('@', sessions, commands, prs).map(r => r.id)).toEqual(['Pim', 'Nova', 'dev-front']);
  });
});
