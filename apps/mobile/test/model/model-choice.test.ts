import { describe, expect, it } from 'vitest';
import { effortLabel, efforts, isBusy, modelHint, modelLabel, running, samePick } from '../../src/model/modelChoice';
import { session } from './fixtures';

const opus = { id: 'opus', label: 'Opus', efforts: ['low', 'high'] };
const sonnet = { id: 'sonnet', label: 'Sonnet', isDefault: true, efforts: ['low', 'medium'] };

describe('model labels and hints', () => {
  it('names a model by the listing, else by its id', () => {
    expect(modelLabel('claude', 'opus', [opus])).toBe('Opus');
    expect(modelLabel('claude', 'mystery', [opus])).toBe('mystery');
  });
  it('says « Par défaut », with the default model when the listing knows it', () => {
    expect(modelLabel('claude', undefined, [opus])).toBe('Par défaut');
    expect(modelLabel('claude', undefined, [opus, sonnet])).toBe('Par défaut · Sonnet');
  });
  it('words the efforts in French, else gives the id', () => {
    expect(['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'odd'].map(effortLabel)).toEqual(['Bas', 'Moyen', 'Élevé', 'Très élevé', 'Max', 'Ultra', 'odd']);
  });
  it('hints in French for the known Claude models, else the description', () => {
    expect(modelHint('claude', { id: 'fable', label: 'Fable' })).toBe('Le plus capable');
    expect(modelHint('claude', opus)).toBe('Très capable, plus lent');
    expect(modelHint('claude', { id: 'sonnet', label: 'S' })).toBe('Équilibré, au quotidien');
    expect(modelHint('claude', { id: 'haiku', label: 'H' })).toBe('Rapide et économique');
    expect(modelHint('codex', { id: 'opus', label: 'x', description: 'Text' })).toBe('Text');
    expect(modelHint('codex', { id: 'gpt', label: 'x' })).toBeUndefined();
  });
});

describe('picks', () => {
  it('compares picks and reads what a session runs', () => {
    expect(samePick({ model: 'a', effort: null }, { model: 'a', effort: null })).toBe(true);
    expect(samePick({ model: 'a', effort: null }, { model: 'a', effort: 'low' })).toBe(false);
    expect(running(session('a'))).toEqual({ model: null, effort: null });
    expect(running(session('a', { model: 'opus', effort: 'high' }))).toEqual({ model: 'opus', effort: 'high' });
  });
  it('offers the efforts of the picked model, of the default one when none, none for Cursor', () => {
    expect(efforts('claude', [opus, sonnet], { model: 'opus', effort: null })).toEqual(['low', 'high']);
    expect(efforts('claude', [opus, sonnet], { model: null, effort: null })).toEqual(['low', 'medium']);
    expect(efforts('claude', [{ id: 'x', label: 'X' }], { model: 'x', effort: null })).toBeNull();
    expect(efforts('cursor', [opus], { model: 'opus', effort: null })).toBeNull();
  });
});

describe('isBusy', () => {
  it('is what the PC waits on before a model change: not idle nor in error, or a request waiting', () => {
    const states = ['starting', 'working', 'waiting_input', 'waiting_permission', 'idle', 'error'] as const;
    expect(states.map(state => isBusy(session('a', { state })))).toEqual([true, true, true, true, false, false]);
    expect(isBusy(session('a', { state: 'idle', pending: { kind: 'permission', text: 'ok?', source: 'hook', key: 'k', risk: 'low', riskReason: 'read' } as never }))).toBe(true);
  });
});
