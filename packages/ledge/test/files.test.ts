import { describe, it, expect } from 'vitest';
import { filesOf, DIFF_LINES } from '../src/daemon/files.js';

describe('filesOf', () => {
  it('reads a Claude Edit as a diff of the old and new strings', () => {
    expect(filesOf('Edit', { file_path: '/w/a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;\nexport { a };' }))
      .toEqual([{ path: '/w/a.ts', change: 'edit', diff: '- const a = 1;\n+ const a = 2;\n+ export { a };' }]);
  });
  it('reads a Write as added lines, capped, and a MultiEdit as one file', () => {
    const content = Array.from({ length: DIFF_LINES + 5 }, (_, i) => `l${i}`).join('\n');
    const [w] = filesOf('Write', { file_path: '/w/new.ts', content });
    expect(w).toMatchObject({ path: '/w/new.ts', change: 'write' });
    expect(w!.diff!.split('\n')).toHaveLength(DIFF_LINES + 1);
    expect(w!.diff!.endsWith('…')).toBe(true);
    expect(filesOf('MultiEdit', { file_path: '/w/b.ts', edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: 'q' }] }))
      .toEqual([{ path: '/w/b.ts', change: 'edit', diff: '- x\n+ y\n- p\n+ q' }]);
    expect(filesOf('NotebookEdit', { notebook_path: '/w/n.ipynb' })).toEqual([{ path: '/w/n.ipynb', change: 'edit' }]);
  });
  it('reads a Codex apply_patch, one file per header', () => {
    const patch = '*** Begin Patch\n*** Add File: src/new.ts\n+export const x = 1;\n*** Update File: src/old.ts\n@@\n-a\n+b\n*** Delete File: src/gone.ts\n*** End Patch';
    expect(filesOf('apply_patch', { patch })).toEqual([
      { path: 'src/new.ts', change: 'add', diff: '+export const x = 1;' },
      { path: 'src/old.ts', change: 'edit', diff: '@@\n-a\n+b' },
      { path: 'src/gone.ts', change: 'delete' }
    ]);
    expect(filesOf('shell', { command: ['apply_patch', patch] })).toHaveLength(3);
  });
  it('gives nothing for a tool without files or without input', () => {
    expect(filesOf('Bash', { command: 'ls' })).toEqual([]);
    expect(filesOf('Write', undefined)).toEqual([]);
    expect(filesOf(undefined, { file_path: '/x' })).toEqual([]);
  });
  it('a Codex patch that moves a file names both paths', () => {
    const patch = '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: src/b.ts\n@@\n-x\n+y\n*** End Patch';
    expect(filesOf('apply_patch', { input: patch })).toEqual([{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-x\n+y' }]);
  });
});
