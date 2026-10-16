import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFolder, createFolder } from '../src/daemon/folders.js';

describe('folders: the launch form browser', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-folders-')); });

  it('lists the subfolders by name, case-insensitive and numeric, without hidden ones or files', async () => {
    for (const d of ['web', 'Api', 'app10', 'app9', '.git']) mkdirSync(join(home, d));
    writeFileSync(join(home, 'README.md'), 'x');
    expect(await listFolder(home, home)).toEqual({ type: 'folder.listing', path: home, parent: join(home, '..'), entries: ['Api', 'app9', 'app10', 'web'] });
  });
  it('follows a link to a folder and skips a dangling one', async () => {
    mkdirSync(join(home, 'real'));
    symlinkSync(join(home, 'real'), join(home, 'linked'));
    symlinkSync(join(home, 'gone'), join(home, 'dangling'));
    expect((await listFolder(home, home)).entries).toEqual(['linked', 'real']);
  });
  it('starts at home with no path, expands ~, and has no parent at the root', async () => {
    mkdirSync(join(home, 'w'));
    expect((await listFolder(undefined, home)).path).toBe(home);
    expect((await listFolder('', home)).path).toBe(home);
    expect((await listFolder('~/w', home)).path).toBe(join(home, 'w'));
    expect((await listFolder('/', home)).parent).toBeNull();
  });
  it('answers a bad path with the reason, keeping the asked path', async () => {
    expect(await listFolder('~/nope', home)).toEqual({ type: 'folder.listing', path: '~/nope', parent: null, entries: [], error: `no such folder: ${join(home, 'nope')}` });
    expect((await listFolder('relative', home)).error).toMatch(/not an absolute path/);
  });
  it('lists a folder whose name has edge whitespace and echoes its path exactly, never the trimmed sibling', async () => {
    for (const d of ['trail ', 'trail', ' lead']) mkdirSync(join(home, d));
    mkdirSync(join(home, 'trail ', 'inside'));
    expect((await listFolder(home, home)).entries).toEqual([' lead', 'trail', 'trail ']);
    expect(await listFolder(join(home, 'trail '), home)).toEqual({ type: 'folder.listing', path: join(home, 'trail '), parent: home, entries: ['inside'] });
    expect((await listFolder(join(home, ' lead'), home)).path).toBe(join(home, ' lead'));
    // A refusal echoes the asked path byte for byte too, so the browser waiting for it stops waiting.
    expect(await listFolder(`${home}/gone `, home)).toMatchObject({ path: `${home}/gone `, error: `no such folder: ${home}/gone ` });
    expect((await listFolder('  ', home)).path).toBe('  ');
  });
  it('creates a folder and lists it', async () => {
    const got = await createFolder('~', ' new-project ', home);
    expect(got).toEqual({ type: 'folder.listing', path: join(home, 'new-project'), parent: home, entries: [] });
    expect(statSync(join(home, 'new-project')).isDirectory()).toBe(true);
  });
  it('refuses an invalid name, an existing folder and a missing parent, listing the parent with the reason', async () => {
    mkdirSync(join(home, 'taken'));
    for (const bad of ['..', '.', 'a/b', '   ', 'a\0b']) {
      const got = await createFolder(home, bad, home);
      expect(got.error).toMatch(/invalid folder name/);
      expect(got).toMatchObject({ path: home, entries: ['taken'] });
    }
    expect((await createFolder(home, 'taken', home)).error).toBe('already exists: taken');
    expect((await createFolder('~/nope', 'x', home)).error).toMatch(/no such folder/);
    expect(existsSync(join(home, 'nope'))).toBe(false);
  });
});
