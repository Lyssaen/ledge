import { describe, it, expect } from 'vitest';
import { cleanTopic, sessionTitle, TOPIC_MAX } from '../src/topic.js';

describe('cleanTopic', () => {
  it('keeps the first non-empty line, flattened', () => {
    expect(cleanTopic('\n\n  Ajoute   un README\npuis commite')).toBe('Ajoute un README');
  });
  it('cuts at TOPIC_MAX with an ellipsis', () => {
    const long = 'a'.repeat(100);
    expect(cleanTopic(long)).toHaveLength(TOPIC_MAX);
    expect(cleanTopic(long).endsWith('…')).toBe(true);
  });
  it('is empty for blank text', () => { expect(cleanTopic('  \n ')).toBe(''); });
});

describe('sessionTitle', () => {
  it('is name · topic, or name · project without a topic', () => {
    expect(sessionTitle({ name: 'Otto', project: 'ledge', topic: 'Hooks Codex' })).toBe('Otto · Hooks Codex');
    expect(sessionTitle({ name: 'Otto', project: 'ledge' })).toBe('Otto · ledge');
    expect(sessionTitle({ name: 'Otto', project: 'ledge', topic: '' })).toBe('Otto · ledge');
  });
});
