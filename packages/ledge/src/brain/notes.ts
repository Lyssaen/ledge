// The brain (spec 2026-11-04): the user's notes (`~/.ledge/context/*.md`) read once for both readers, the chat (copied into
// its folder) and the sessions Ledge launched (an index in their start context, a note at a time with `ledge brain <name>`).
import { open, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { paths } from '../paths.js';

/** The longest note read, in bytes: past it the text is cut, and the index says so. */
export const NOTE_MAX = 32 * 1024;
/** The most notes read: the others are counted, never read. */
export const NOTES_MAX = 200;

/** Who a note is offered to: `chat` keeps it out of the sessions' index and of `ledge brain`, `sessions` out of the chat. */
export type NoteScope = 'all' | 'chat' | 'sessions';

export interface Note {
  /** The file name without `.md`: what `ledge brain <name>` takes. */
  name: string;
  file: string; path: string;
  /** `title`, else the file name. */
  title: string;
  /** `when`, else null (the index then gives the first line of the body). */
  when: string | null;
  firstLine: string;
  scope: NoteScope;
  /** `projects`: the project names or ids it is offered to (lower case); empty is every project. */
  projects: string[];
  modifiedAt: string;
  /** `checked` (`YYYY-MM-DD`), when the content was last verified. */
  checkedAt?: string;
  size: number;
  /** The whole file (front matter included), at most `max` bytes. */
  text: string;
  /** The body, front matter left out. */
  body: string;
  truncated: boolean;
  /** « à revoir » : what a flag the user validated says, until the note changes by another hand than Ledge's. */
  flag?: string;
}

/** What Ledge keeps beside the notes: the flags the user validated, and the date each note had once Ledge last wrote it. */
export interface BrainState { flags: Array<{ note: string; what: string; by: string; at: string }>; written: Record<string, string> }
export const brainFile = (from = notesDir()): string => join(dirname(from), 'brain.json');

export function readBrainState(from = notesDir()): BrainState {
  try {
    const raw = JSON.parse(readFileSync(brainFile(from), 'utf8')) as Partial<BrainState>;
    return { flags: Array.isArray(raw.flags) ? raw.flags : [], written: raw.written && typeof raw.written === 'object' ? raw.written : {} };
  } catch { return { flags: [], written: {} }; }
}
/** A note's flag still stands until the note changes by another hand than Ledge's: its latest one, or none. */
export function activeFlag(state: BrainState, note: string, modifiedAt: string): string | undefined {
  const flag = state.flags.filter(f => f.note === note).at(-1);
  if (!flag) return undefined;
  return modifiedAt <= flag.at || state.written[note] === modifiedAt ? flag.what : undefined;
}

/** Where the user's notes are. */
export const notesDir = (): string => join(paths().dir, 'context');

const unquote = (v: string): string => (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1) : v);

/** A front matter value: a trailing ` # comment` dropped from an unquoted value only, quotes taken off. */
function scalarValue(raw: string): string {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    if (end > 0 && /^(\s+#.*)?$/.test(v.slice(end + 1))) return v.slice(1, end);
  }
  return unquote(v.replace(/(^|\s)#.*$/, '').trim());
}

/** `key: value` lines between two `---` at the top, and the body after them. A value may be quoted. */
export function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { fields: {}, body: src.trim() };
  const fields: Record<string, string> = {};
  for (const raw of m[1]!.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i <= 0) throw new Error(`front matter line without a key: ${line.replace(/\s+#.*$/, '').slice(0, 60)}`);
    fields[line.slice(0, i).trim()] = scalarValue(line.slice(i + 1));
  }
  return { fields, body: src.slice(m[0].length).trim() };
}

/** One line of Markdown, at most `max` characters. */
export const oneLine = (text: string, max = 200): string => { const t = text.replace(/\s*[\r\n]+\s*/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** The first `max` bytes of a file as text, a character cut in half dropped. */
async function head(path: string, max: number): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return new TextDecoder('utf-8').decode(buf.subarray(0, bytesRead)).replace(/�$/, '');
  } finally { await fh.close(); }
}

const scopeOf = (v: string | undefined): NoteScope => (v === 'chat' || v === 'sessions' ? v : 'all');
const dateOf = (v: string | undefined): string | undefined => (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined);

/**
 * The notes of `from`, sorted by file name: only regular `.md` files directly in it (no subfolder, no symbolic link), at most
 * NOTES_MAX (`more` counts the others), each cut at `max` bytes. A missing folder has none; an unreadable file is skipped;
 * an unreadable front matter reads the file as plain text.
 */
export async function readNotes(from = notesDir(), max = NOTE_MAX): Promise<{ notes: Note[]; more: number }> {
  let files: string[] = [];
  try { files = (await readdir(from, { withFileTypes: true })).filter(e => e.isFile() && /\.md$/i.test(e.name)).map(e => e.name).sort(); } catch { /* no notes folder */ }
  const notes: Note[] = [];
  const state = readBrainState(from);
  for (const file of files.slice(0, NOTES_MAX)) {
    const path = join(from, file);
    let text: string; let size: number; let modifiedAt: string;
    try { const st = await stat(path); size = st.size; modifiedAt = st.mtime.toISOString(); text = await head(path, max); } catch { continue; }
    let fields: Record<string, string> = {}; let body = text;
    try { ({ fields, body } = frontMatter(text)); } catch { /* read as plain text */ }
    const checkedAt = dateOf(fields.checked);
    const name = file.replace(/\.md$/i, '');
    const flag = activeFlag(state, name, modifiedAt);
    notes.push({
      name, file, path,
      title: fields.title?.trim() ? oneLine(fields.title) : file,
      when: fields.when?.trim() ? oneLine(fields.when) : null,
      firstLine: oneLine(body.split('\n').find(l => l.trim()) ?? ''),
      scope: scopeOf(fields.scope?.trim()),
      projects: (fields.projects ?? '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean),
      modifiedAt, ...(checkedAt ? { checkedAt } : {}), size, text, body, truncated: size > max, ...(flag ? { flag } : {})
    });
  }
  return { notes, more: Math.max(0, files.length - NOTES_MAX) };
}

/** The notes offered to the chat. */
export const forChat = (notes: readonly Note[]): Note[] => notes.filter(n => n.scope !== 'sessions');

/** The notes offered to a session of `project` (its id and name; null: none): never a `chat` note, a `projects` note only to those. */
export function forSession(notes: readonly Note[], project: { id: string; name: string } | null): Note[] {
  const mine = project ? [project.id.toLowerCase(), project.name.toLowerCase()] : [];
  return notes.filter(n => n.scope !== 'chat' && (n.projects.length === 0 || n.projects.some(p => mine.includes(p))));
}

/** « vérifiée le … » when the note says so, else « modifiée le … » (its file's date). */
export const noteDate = (n: Note): string => (n.checkedAt ? `vérifiée le ${n.checkedAt}` : `modifiée le ${n.modifiedAt.slice(0, 10)}`);
