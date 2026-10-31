// The user's own notes (`~/.ledge/context/*.md`): copied into the chat's folder at each question, with an index the
// model reads first, so it opens only the notes that bear on the question and cites the one it used, with its date.
import { open, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatStep } from '@ledge/protocol';
import { frontMatter } from '../daemon/roles.js';

/** The longest note copied, in bytes: past it the copy is cut, and the index says so. */
export const NOTE_MAX = 32 * 1024;
/** The most notes copied: the others are counted in the index, never read. */
export const NOTES_MAX = 200;
export const NOTES_INDEX = 'context-index.md';

/** One line of Markdown, at most `max` characters. */
const line = (text: string, max = 200): string => { const t = text.replace(/\s*[\r\n]+\s*/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** The copy's name: `context-<name>.md`, the name kept to letters, digits, `.`, `_` and `-`, made unique among `taken`. */
function copyName(file: string, taken: Set<string>): string {
  const base = file.replace(/\.md$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'note';
  let name = `context-${base}.md`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `context-${base}-${n}.md`;
  taken.add(name.toLowerCase());
  return name;
}

/** The first `max` bytes of a file as text, a character cut in half dropped. */
async function head(path: string, max: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return new TextDecoder('utf-8').decode(buf.subarray(0, bytesRead)).replace(/�$/, '');
  } finally { await fh.close(); }
}

/**
 * Copies each note of `from` into `dir` as `context-<name>.md` and writes `context-index.md`: one line per note with its
 * file, its title, when to read it and its modification date; a note without front matter gives its file name and its
 * first line. Only regular `.md` files directly in `from` are read (no subfolder, no symbolic link); a missing folder gives
 * an index that says how to add notes. Each copy is a step, named after the user's file.
 */
export async function writeNotes(dir: string, from: string, steps: Map<string, ChatStep>, max = NOTE_MAX): Promise<void> {
  let files: string[] = [];
  try { files = (await readdir(from, { withFileTypes: true })).filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => e.name).sort(); } catch { /* no notes folder */ }
  const lines = ['# Your notes', '', `The user's notes from \`${from}\`, one line per note: the file in this folder, its title, when to read it, its last modification. Read only the notes the question needs, and cite the note and its date.`, ''];
  if (!files.length) lines.push(`- (none: the user can add Markdown files to \`${from}\`, with an optional front matter \`title\` and \`when\`)`);
  const taken = new Set<string>();
  for (const file of files.slice(0, NOTES_MAX)) {
    const path = join(from, file);
    let text: string; let size: number; let mtime: string;
    try { const st = await stat(path); size = st.size; mtime = st.mtime.toISOString(); text = await head(path, max); } catch { continue; }
    let fields: Record<string, string> = {}; let body = text;
    try { ({ fields, body } = frontMatter(text)); } catch { /* an unreadable front matter: read as plain text */ }
    const title = fields.title?.trim() ? line(fields.title) : file;
    const when = fields.when?.trim() ? `when: ${line(fields.when)}` : `first line: ${line(body.split('\n').find(l => l.trim()) ?? '') || '(empty)'}`;
    const truncated = size > max;
    const name = copyName(file, taken);
    await writeFile(join(dir, name), truncated ? `${text}\n\n[truncated by Ledge: the first ${max} of ${size} bytes]\n` : text);
    steps.set(name, { kind: 'repo', name: file, path: join(from, file) });
    lines.push(`- ${name} — « ${title} » — ${when} — modified ${mtime}${truncated ? ` — TRUNCATED: only the first ${max} of ${size} bytes are copied` : ''}`);
  }
  if (files.length > NOTES_MAX) lines.push(`- (${files.length - NOTES_MAX} more notes not copied: Ledge copies ${NOTES_MAX} at most)`);
  await writeFile(join(dir, NOTES_INDEX), [...lines, ''].join('\n'));
}
