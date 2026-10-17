import { describe, expect, it } from 'vitest';
import type { FileChange, ThreadItem, ToolItem } from '@ledge/protocol';
import { T0 } from '@ledge/fleet/test/mockDaemon';
import { diffRows, parseDiff, type ParsedDiff } from '../src/session/diff';
import { byFolder, changedFiles, relativeTo } from '../src/session/changes';

const lines = (d: ParsedDiff) => d.hunks.flatMap(h => h.lines.map(l => `${l.t}:${l.o ?? ''}:${l.n ?? ''}:${l.text}`));

describe('session diffs', () => {
  it('a Claude edit: no header, the space after each sign dropped, no line numbers', () => {
    const d = parseDiff('- const a = 1;\n+ const a = 2;\n+ export { a };');
    expect(lines(d)).toEqual(['del:::const a = 1;', 'add:::const a = 2;', 'add:::export { a };']);
    expect([d.plus, d.minus, d.cut, d.hunks[0]!.o]).toEqual([2, 1, false, undefined]);
  });
  it('a Codex hunk: a bare @@, the sign glued to the text, context kept', () => {
    expect(lines(parseDiff('@@ fn main\n-a\n+b\n c'))).toEqual(['del:::a', 'add:::b', 'ctx:::c']);
    expect(parseDiff('@@ fn main\n-a').hunks[0]!.ctx).toBe('fn main');
  });
  it('a numbered hunk numbers its lines', () => {
    expect(lines(parseDiff('@@ -10,4 +10,5 @@ fn x()\n a\n-d\n+e\n+f\n g'))).toEqual(['ctx:10:10:a', 'del:11::d', 'add::11:e', 'add::12:f', 'ctx:12:13:g']);
  });
  it('the 80-line cut is a flag, not a line; nothing is nothing', () => {
    const cut = parseDiff([...Array.from({ length: 80 }, (_, i) => `+ l${i}`), '…'].join('\n'));
    expect([cut.plus, cut.cut, cut.hunks[0]!.lines.length]).toEqual([80, true, 80]);
    expect(parseDiff('')).toEqual({ hunks: [], plus: 0, minus: 0, cut: false });
  });
  it('unchanged runs keep three lines around a change and fold the rest; a gap separates numbered hunks', () => {
    const ctx = (n: number) => Array.from({ length: n }, (_, i) => ` c${i}`).join('\n');
    const d = parseDiff(`@@ -1,12 +1,12 @@\n-a\n+b\n${ctx(10)}\n-y\n+z\n@@ -40,1 +40,1 @@\n-p\n+q`);
    const kinds = (shown: Set<string>) => diffRows(d, shown).map(r => r.kind === 'line' ? r.line.t : r.kind === 'fold' ? `fold${r.hidden}` : r.kind === 'gap' ? `gap${r.from}-${r.to}` : 'hunk');
    expect(kinds(new Set())).toEqual(['hunk', 'del', 'add', 'ctx', 'ctx', 'ctx', 'fold4', 'ctx', 'ctx', 'ctx', 'del', 'add', 'gap13-39', 'hunk', 'del', 'add']);
    const fold = diffRows(d, new Set()).find(r => r.kind === 'fold')!;
    expect(kinds(new Set([(fold as { key: string }).key])).filter(k => k === 'ctx')).toHaveLength(10);
  });
});

const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const edit = (id: string, s: number, turn: number, files: FileChange[], status: ToolItem['status'] = 'success'): ToolItem =>
  ({ kind: 'tool', id, at: at(s), turn, tool: files[0]?.from ? 'apply_patch' : 'Edit', label: files[0]!.path, status, files });
const items: ThreadItem[] = [
  edit('e1', 1, 1, [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }]),
  edit('e2', 2, 1, [{ path: '/w/ledge/docs/guide.md', change: 'write', diff: '+ # Guide\n+ Bonjour' }]),
  edit('e3', 3, 1, [{ path: '/w/ledge/src/gone.ts', change: 'edit' }], 'failed'),
  edit('e4', 4, 2, [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- c\n+ d\n+ e' }]),
  edit('e5', 5, 2, [{ path: 'src/b.ts', from: 'src/a.ts', change: 'edit', diff: '@@\n-x\n+y' }]),
  edit('e6', 6, 2, [{ path: '/w/ledge/notes.ipynb', change: 'edit' }]),
  { ...edit('h1e', 7, 2, [{ path: '/w/ledge/src/helper.ts', change: 'add', diff: '+x' }]), helperId: 'h1' }
];

describe('session changed files', () => {
  it('files of successful actions, first touched first, relative to the session folder, summed over their touches', () => {
    const files = changedFiles(items, '/w/ledge');
    expect(files.map(f => [f.shown, f.change, f.plus, f.minus, f.touches.map(t => `${t.tool.id}@${t.turn}`).join(',')])).toEqual([
      ['src/App.tsx', 'edit', 3, 2, 'e1@1,e4@2'],
      ['docs/guide.md', 'write', 2, 0, 'e2@1'],
      ['src/b.ts', 'rename', 1, 1, 'e5@2'],
      ['notes.ipynb', 'edit', 0, 0, 'e6@2']
    ]);
    expect(files[2]!.from).toBe('src/a.ts');
    expect(files[3]!.touches[0]!.diff).toBeNull();
    expect(changedFiles(items, '/w/ledge', 'h1').map(f => [f.shown, f.change])).toEqual([['src/helper.ts', 'add']]);
    expect([relativeTo('/w/ledge/src/a.ts', '/w/ledge'), relativeTo('/w/ledger/a.ts', '/w/ledge'), relativeTo('src/a.ts', '/w/ledge')]).toEqual(['src/a.ts', '/w/ledger/a.ts', 'src/a.ts']);
  });
  it('grouped by folder in order of appearance, the root as « . »', () => {
    expect(byFolder(changedFiles(items, '/w/ledge')).map(g => [g.dir, g.files.map(f => f.shown)])).toEqual([
      ['src', ['src/App.tsx', 'src/b.ts']], ['docs', ['docs/guide.md']], ['.', ['notes.ipynb']]
    ]);
  });
});
