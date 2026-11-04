// The user's own notes (`~/.ledge/context/*.md`, read by brain/notes.ts): copied into the chat's folder at each question, with
// an index the model reads first, so it opens only the notes that bear on the question and cites the one it used, with its date.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatStep } from '@ledge/protocol';
import { forChat, NOTE_MAX, NOTES_MAX, oldFor, readNotes } from '../brain/notes.js';

export { frontMatter, NOTE_MAX, NOTES_MAX } from '../brain/notes.js';
export const NOTES_INDEX = 'context-index.md';

/** The copy's name: `context-<name>.md`, the name kept to letters, digits, `.`, `_` and `-`, made unique among `taken`. */
function copyName(file: string, taken: Set<string>): string {
  const base = file.replace(/\.md$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'note';
  let name = `context-${base}.md`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `context-${base}-${n}.md`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Copies each note of `from` the chat is offered (not `scope: sessions`) into `dir` as `context-<name>.md` and writes
 * `context-index.md`: one line per note with its file, its title, when to read it, its modification date and, when the note
 * gives one, the date it was checked; a note without front matter gives its file name and its first line. A missing folder
 * gives an index that says how to add notes. Each copy is a step, named after the user's file.
 */
export async function writeNotes(dir: string, from: string, steps: Map<string, ChatStep>, max = NOTE_MAX): Promise<void> {
  const { notes: all, more } = await readNotes(from, max);
  const notes = forChat(all);
  const lines = ['# Your notes', '', `The user's notes from \`${from}\`, one line per note: the file in this folder, its title, when to read it, its last modification. Read only the notes the question needs, and cite the note and its date.`, ''];
  if (!all.length) lines.push(`- (none: the user can add Markdown files to \`${from}\`, with an optional front matter \`title\` and \`when\`)`);
  const taken = new Set<string>();
  for (const n of notes) {
    const name = copyName(n.file, taken);
    await writeFile(join(dir, name), n.truncated ? `${n.text}\n\n[truncated by Ledge: the first ${max} of ${n.size} bytes]\n` : n.text);
    steps.set(name, { kind: 'repo', name: n.file, path: n.path });
    const when = n.when ? `when: ${n.when}` : `first line: ${n.firstLine || '(empty)'}`;
    lines.push(`- ${name} — « ${n.title} » — ${when} — modified ${n.modifiedAt}${n.checkedAt ? ` — checked ${n.checkedAt}` : ''}${n.truncated ? ` — TRUNCATED: only the first ${max} of ${n.size} bytes are copied` : ''}${oldFor(n) ? ` — OLD: neither checked nor changed for ${oldFor(n)} days, say so if you rely on it` : ''}${n.flag ? ` — TO CHECK (the user agreed it may be wrong): ${n.flag.replace(/\s*[\r\n]+\s*/g, ' ')}` : ''}`);
  }
  if (more > 0) lines.push(`- (${more} more notes not copied: Ledge copies ${NOTES_MAX} at most)`);
  await writeFile(join(dir, NOTES_INDEX), [...lines, ''].join('\n'));
}
