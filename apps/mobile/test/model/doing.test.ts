import { describe, expect, it } from 'vitest';
import { doingLine } from '../../src/model/sessions';
import { copy } from '../../src/copy';
import { session } from './fixtures';

describe('what an agent at work is doing (doingLine, Q68)', () => {
  it('shows the label the PC sends, as it is', () => {
    expect(doingLine(session('a', { state: 'working', doing: { tool: 'Read', label: 'Read e2e/workspace.spec.ts', since: '2026-10-14T10:00:00.000Z' } }))).toBe('Read e2e/workspace.spec.ts');
  });

  it('says « Réfléchit… » between two tools, not the last reply', () => {
    expect(doingLine(session('a', { state: 'working', lastReply: { text: 'Fini.', at: '2026-10-14T10:00:00.000Z' } }))).toBe(copy.sessions.line.thinking);
  });
});
