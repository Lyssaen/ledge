import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Module paths that differ only by case, extensions dropped: `./Plants` finds `plants.ts` on Windows and macOS, so the build
 *  breaks there although Linux is happy. Same-spelled pairs (`list.tsx` and `list.css`) are fine. */
export function caseCollisions(files: readonly string[]): string[][] {
  const groups = new Map<string, Set<string>>();
  for (const f of files) {
    const module = f.replace(/\.(d\.ts|tsx?|mts|cts|jsx?|mjs|cjs)$/, '');
    const k = module.toLowerCase();
    groups.set(k, (groups.get(k) ?? new Set()).add(module));
  }
  return [...groups.values()].filter(g => g.size > 1).map(g => [...g].sort());
}

describe('case collisions', () => {
  it('finds two modules that differ only by case', () => {
    expect(caseCollisions(['src/Plants.tsx', 'src/plants.ts', 'src/list.tsx', 'src/list.css'])).toEqual([['src/Plants', 'src/plants']]);
  });

  it('no tracked module differs from another only by case', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(caseCollisions(files)).toEqual([]);
  });
});
