import { describe, expect, it } from 'vitest';
import type { ThreadItem } from '@ledge/protocol';
import { exchanges } from '../src/session/exchanges';
import { marksOf, synapseOf, tagLabel } from '../src/session/markers';

const at = new Date(0).toISOString();

describe('the [synapse-obs] lines', () => {
  it('a text without one is left as it is', () => {
    expect(synapseOf('Câble la liste')).toEqual({ text: 'Câble la liste', tags: null });
  });

  it('its lines leave the text; the last one of each key wins', () => {
    expect(synapseOf('[synapse-obs] story=ST7-123 objectif=analyse\nCâble la liste\n  [synapse-obs] objectif=implementation\n'))
      .toEqual({ text: 'Câble la liste', tags: { story: 'ST7-123', objectif: 'implementation' } });
  });

  it('a line with neither a story nor an objective leaves, and notes nothing', () => {
    expect(synapseOf('[synapse-obs] skill=brainstorming\nBonjour')).toEqual({ text: 'Bonjour', tags: null });
  });

  it('a tag reads as its label, a ticket key as it is, the rest capitalised with its dashes as spaces', () => {
    const known = { 'hors-story': 'Hors story', analyse: 'Analyse' };
    expect(tagLabel('Analyse', known)).toBe('Analyse');
    expect(tagLabel('ST7-162', known)).toBe('ST7-162');
    expect(tagLabel('revue-de_code', known)).toBe('Revue de code');
  });

  it('marksOf: by item the text left and its tags; an agent that notes another objective keeps the one before', () => {
    const items: ThreadItem[] = [
      { kind: 'prompt', id: 'p1', at, turn: 1, text: '[synapse-obs] story=hors-story objectif=analyse\nRegarde' },
      { kind: 'reply', id: 'r1', at, turn: 1, text: '[synapse-obs] objectif=implementation\nJe m’y mets.' },
      { kind: 'reply', id: 'r2', at, turn: 1, text: '[synapse-obs] objectif=implementation\nToujours.' }
    ];
    const { byId, latest } = marksOf(exchanges(items));
    expect(byId.get('p1')).toEqual({ text: 'Regarde', tags: { story: 'hors-story', objectif: 'analyse' } });
    expect(byId.get('r1')).toEqual({ text: 'Je m’y mets.', tags: { objectif: 'implementation' }, was: 'analyse' });
    expect(byId.get('r2')).toEqual({ text: 'Toujours.', tags: { objectif: 'implementation' } });   // the same objective: no change
    expect(latest).toEqual({ story: 'hors-story', objectif: 'implementation' });
  });
});
