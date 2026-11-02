import { describe, expect, it } from 'vitest';
import type { SlashCommand } from '@ledge/protocol';
import { completed, draftCommand, matchCommands, slashQuery } from '../src/slash/match';

const LIST: SlashCommand[] = [
  { name: 'code-review', aliases: ['review'], source: 'builtin', description: 'Review the current diff' },
  { name: 'review-pr', source: 'project', description: 'Review a GitHub PR' },
  { name: 'security-review', source: 'builtin', description: 'Complete a security review' },
  { name: 'compact', source: 'builtin', description: 'Free up context by summarizing' },
  { name: 'usage', aliases: ['cost'], source: 'builtin', description: 'Show session cost', blocked: 'panel' },
  { name: 'model', source: 'builtin', description: 'Set the AI model', bare: 'panel' },
  { name: 'recap', source: 'builtin', description: 'One-line session recap, after review' }
];
const names = (q: string) => matchCommands(LIST, q).map(m => m.shown);

describe('slashQuery', () => {
  it('is open on the first word of a command, shut once a space or a line follows', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/Rev')).toBe('rev');
    expect(slashQuery('/review ')).toBeNull();
    expect(slashQuery('/a\nb')).toBeNull();
    expect(slashQuery('hello /x')).toBeNull();
    expect(slashQuery(' /x')).toBeNull();
  });
});

describe('matchCommands', () => {
  it('ranks the exact name, then the names and aliases that start with the query, then those that hold it, then descriptions', () => {
    expect(names('review')).toEqual(['review', 'review-pr', 'security-review', 'recap']);
    expect(matchCommands(LIST, 'review')[0]).toMatchObject({ command: { name: 'code-review' }, shown: 'review', at: 0 });
    expect(matchCommands(LIST, 'review')[2]).toMatchObject({ shown: 'security-review', at: 9 });
    expect(matchCommands(LIST, 'review')[3]).toMatchObject({ shown: 'recap', at: -1 });
  });
  it('keeps a command Ledge does not send after the others of its rank, and lists everything for « / »', () => {
    expect(names('co')).toEqual(['code-review', 'compact', 'cost', 'security-review']); // the last by its description: « Complete… »
    expect(names('c')).toEqual(['code-review', 'compact', 'cost', 'recap', 'security-review']); // usage once, by its alias
    expect(names('')).toHaveLength(LIST.length);
    expect(matchCommands(LIST, '').every(m => m.at === -1)).toBe(true);
    expect(names('zzz')).toEqual([]);
  });
});

describe('draftCommand and completed', () => {
  it('finds the command a draft starts with, by name or alias', () => {
    expect(draftCommand('/code-review high', LIST)?.name).toBe('code-review');
    expect(draftCommand('/Review', LIST)?.name).toBe('code-review');
    expect(draftCommand('/nope', LIST)).toBeUndefined();
    expect(draftCommand('no', LIST)).toBeUndefined();
    expect(completed(LIST[3]!)).toBe('/compact ');
  });
});
