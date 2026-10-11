import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readDocument } from '../src/daemon/documents.js';

const dirs: string[] = [];
async function dir() { const d = await mkdtemp(join(tmpdir(), 'ledge-doc-')); dirs.push(d); return d; }
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const req = (path: string, basePath?: string) => ({ type: 'document.read' as const, requestId: 'r1', path, ...(basePath ? { basePath } : {}) });

describe('readDocument', () => {
  it('resolves relative paths from the session and returns exact UTF-8 bytes', async () => {
    const root = await dir(); const cwd = join(root, 'work'); await mkdir(cwd);
    await writeFile(join(root, 'plan.md'), '# Café\n');
    expect(await readDocument(req('../plan.md'), { cwd, home: root })).toMatchObject({ type: 'document.content', path: join(root, 'plan.md'), text: '# Café\n', bytes: 8 });
  });
  it('resolves a link from its containing document ahead of the session cwd', async () => {
    const root = await dir(); const base = join(root, 'notes', 'index.md'); await mkdir(dirname(base)); await writeFile(join(root, 'notes', 'next.md'), '# Next');
    expect(await readDocument(req('next.md', base), { cwd: root, home: root })).toMatchObject({ type: 'document.content', path: join(root, 'notes', 'next.md'), text: '# Next' });
  });
  it('reads home, absolute skills, names with spaces and regular symlink targets', async () => {
    const root = await dir(); await writeFile(join(root, 'My Skill.md'), 'étape'); await symlink(join(root, 'My Skill.md'), join(root, 'SKILL.md'));
    expect(await readDocument(req('~/My Skill.md'), { home: root })).toMatchObject({ type: 'document.content', text: 'étape' });
    expect(await readDocument(req(join(root, 'SKILL.md')), { home: root })).toMatchObject({ type: 'document.content', text: 'étape' });
  });
  it('rejects ambiguous, missing, non-Markdown and non-files without blocking', async () => {
    const root = await dir(); await mkdir(join(root, 'folder.md')); await writeFile(join(root, 'note.txt'), 'x');
    expect(await readDocument(req('note.md'), { home: root })).toMatchObject({ type: 'document.error', code: 'ambiguous_path' });
    expect(await readDocument(req(join(root, 'missing.md')), { home: root })).toMatchObject({ type: 'document.error', code: 'not_found' });
    expect(await readDocument(req(join(root, 'folder.md')), { home: root })).toMatchObject({ type: 'document.error', code: 'not_file' });
    expect(await readDocument(req(join(root, 'note.txt')), { home: root })).toMatchObject({ type: 'document.error', code: 'unsupported_type' });
  });
  it('accepts 1 MiB exactly and rejects one byte more or malformed UTF-8', async () => {
    const root = await dir(); const file = join(root, 'limit.md');
    await writeFile(file, Buffer.alloc(1_048_576, 97));
    expect(await readDocument(req(file), { home: root })).toMatchObject({ type: 'document.content', bytes: 1_048_576 });
    await writeFile(file, Buffer.alloc(1_048_577, 97));
    expect(await readDocument(req(file), { home: root })).toMatchObject({ type: 'document.error', code: 'too_large' });
    await writeFile(file, Buffer.from([0xc3, 0x28]));
    expect(await readDocument(req(file), { home: root })).toMatchObject({ type: 'document.error', code: 'invalid_utf8' });
  });
});
