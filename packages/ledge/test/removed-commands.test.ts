import { describe, it, expect } from 'vitest';
import { removedCommand } from '../src/cli/removed.js';

describe('removed commands', () => {
  it('ledge task and ledge team answer with one line pointing at ledge ask', () => {
    expect(removedCommand('task')).toBe(`ledge task a été retiré : pour une décision qui revient à l'utilisateur, ledge ask "<question>" "<options, ta recommandation>"`);
    expect(removedCommand('team')).toBe('ledge team a été retiré');
  });
  it('anything else is not a removed command', () => {
    expect(removedCommand('ask')).toBeUndefined();
    expect(removedCommand(undefined)).toBeUndefined();
  });
});
