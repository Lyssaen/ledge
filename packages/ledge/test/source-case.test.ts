import { readdirSync } from 'node:fs';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every directory under `dir`, itself included. */
function dirs(dir: string): string[] {
  return [dir, ...readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(d => dirs(join(dir, d.name)))];
}

describe('source file names', () => {
  // Two modules whose names differ only by case (`PairingDialog.tsx` and `pairingDialog.ts`) make an import of one resolve
  // to the other: the build broke on Linux while the typecheck passed.
  it('never differ only by case within a directory', () => {
    const clashes: string[] = [];
    for (const dir of dirs(SRC)) {
      const seen = new Map<string, string>();
      for (const f of readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile())) {
        const key = parse(f.name).name.toLowerCase();
        const other = seen.get(key);
        if (other) clashes.push(`${join(dir, other)} / ${f.name}`); else seen.set(key, f.name);
      }
    }
    expect(clashes).toEqual([]);
  });
});
