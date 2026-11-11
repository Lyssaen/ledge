import { describe, it, expect } from 'vitest';
import { alwaysScope, offers } from '../src/decisions.js';

describe('alwaysScope: what an offered « always » grants', () => {
  it('Claude Code: a command goes to the project, a file change or a file tool to the session\'s edits, a plan to auto mode', () => {
    expect(alwaysScope('claude', { kind: 'permission', tool: 'Bash' })).toBe('project');
    expect(alwaysScope('claude', { kind: 'permission', tool: 'WebFetch' })).toBe('project');
    expect(alwaysScope('claude', { kind: 'diff', tool: 'Edit' })).toBe('edits');
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) expect(alwaysScope('claude', { kind: 'permission', tool })).toBe('edits');
    expect(alwaysScope('claude', { kind: 'plan' })).toBe('plan');
  });

  it('Codex: until the session ends, whatever is asked', () => {
    expect(alwaysScope('codex', { kind: 'permission', tool: 'shell' })).toBe('session');
    expect(alwaysScope('codex', { kind: 'diff', tool: 'apply_patch' })).toBe('session');
  });

  it('is only asked where « always » is offered: not for Cursor, OMP, or a Codex plan', () => {
    expect(offers('cursor', 'permission', 'always')).toBe(false);
    expect(offers('omp', 'permission', 'always')).toBe(false);
    expect(offers('codex', 'plan', 'always')).toBe(false);
    expect(offers('claude', 'question', 'always')).toBe(false);
  });
});
