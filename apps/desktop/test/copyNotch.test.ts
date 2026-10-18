import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: a plain node script, untyped on purpose
import { copyNotch } from '../scripts/copy-notch.mjs';

describe('copyNotch', () => {
  let tmp: string;
  let from: string;
  let to: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'copy-notch-'));
    from = join(tmp, 'from');
    to = join(tmp, 'to');
    mkdirSync(join(from, 'assets'), { recursive: true });
    writeFileSync(join(from, 'index.html'), '<html>notch</html>');
    writeFileSync(join(from, 'assets', 'a.js'), 'a');
    mkdirSync(to);
    writeFileSync(join(to, 'stale.js'), 'old');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('copies the notch build into dist/notch, replacing the previous one', () => {
    copyNotch(from, to);
    expect(readFileSync(join(to, 'index.html'), 'utf8')).toBe('<html>notch</html>');
    expect(existsSync(join(to, 'assets', 'a.js'))).toBe(true);
    expect(existsSync(join(to, 'stale.js'))).toBe(false);
  });
  it('throws when the notch was not built', () => {
    expect(() => copyNotch(join(tmp, 'missing'), to)).toThrow(/overlay/);
  });
});
