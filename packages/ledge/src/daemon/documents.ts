import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, isAbsolute, dirname, extname, join, resolve } from 'node:path';
import type { DocumentRead, DocumentContent, DocumentError, DocumentErrorCode } from '@ledge/protocol';
import { DOCUMENT_MAX_BYTES } from '@ledge/protocol';
import { ledgeDir } from '../paths.js';

const markdown = (path: string) => /^\.(?:md|markdown)$/i.test(extname(path));
const yaml = (path: string) => /^\.ya?ml$/i.test(extname(path));
/** A team template where the daemon lists them (#97): a repository's `.ledge/teams`, or the home's (`ledgeDir()/teams`,
 *  `LEDGE_HOME` included); the catalog shows it as it is written. The folder may be a link (dotfiles), not the file's way out. */
const template = (path: string) => yaml(path) && basename(dirname(path)) === 'teams'
  && (basename(dirname(dirname(path))) === '.ledge' || dirname(path) === resolve(join(ledgeDir(), 'teams')));
const readable = (path: string) => markdown(path) || template(path);
const failure = (request: DocumentRead, code: DocumentErrorCode): DocumentError => ({
  type: 'document.error', requestId: request.requestId, path: request.path, code
});
const errorCode = (e: unknown): DocumentErrorCode => {
  const code = (e as NodeJS.ErrnoException).code;
  return code === 'ENOENT' ? 'not_found' : code === 'EACCES' || code === 'EPERM' ? 'permission_denied'
    : code === 'EISDIR' || code === 'ENXIO' ? 'not_file' : 'read_failed';
};

/** Read one WSL Markdown file (or a team template) for the requesting socket. Never spawns a process or writes to the file. */
export async function readDocument(request: DocumentRead, context: { cwd?: string; workdir?: string; home: string }): Promise<DocumentContent | DocumentError> {
  const source = request.path;
  if (/^(?:file:|[a-zA-Z]:[\\/]|\\\\)/.test(source) || source.includes('\0')) return failure(request, 'unsupported_path');
  if (request.basePath && (!isAbsolute(request.basePath) || !markdown(request.basePath))) return failure(request, 'unsupported_path');
  const expanded = source === '~' ? context.home : source.startsWith('~/') ? resolve(context.home, source.slice(2)) : source;
  // A link in a document starts from that document; one from a session, from where the agent works now (a worktree
  // it entered), then from where it started.
  const bases = request.basePath ? [dirname(request.basePath)] : [...new Set([context.workdir, context.cwd].filter((d): d is string => !!d))];
  if (!isAbsolute(expanded) && !bases.length) return failure(request, 'ambiguous_path');
  const paths = isAbsolute(expanded) ? [resolve(expanded)] : bases.map(base => resolve(base, expanded));
  if (!readable(paths[0]!)) return failure(request, 'unsupported_type');
  let read: DocumentContent | DocumentError = failure(request, 'not_found');
  for (const path of paths) {
    read = await readAt(request, path);
    if (read.type === 'document.content' || read.code !== 'not_found') return read;
  }
  return read;
}

async function readAt(request: DocumentRead, path: string): Promise<DocumentContent | DocumentError> {
  let file;
  try {
    // Every candidate is checked, not only the first: a template is named by its folder (`template`), then read only
    // inside it: a file link leading out of it, or to anything but YAML, is refused. What is opened is the real file,
    // never followed again, so no link swapped in between counts.
    let target = path;
    if (!markdown(path)) {
      if (!template(path)) return failure(request, 'unsupported_type');
      target = await realpath(path);
      if (!yaml(target) || dirname(target) !== await realpath(dirname(path))) return failure(request, 'unsupported_type');
    }
    // O_NONBLOCK also makes a path replaced by a FIFO between resolution and open safe to reject.
    file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | (target === path ? 0 : constants.O_NOFOLLOW));
    const stat = await file.stat();
    if (!stat.isFile()) return failure(request, 'not_file');
    if (stat.size > DOCUMENT_MAX_BYTES) return failure(request, 'too_large');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const parts: Buffer[] = [];
    let bytes = 0;
    while (bytes <= DOCUMENT_MAX_BYTES) {
      const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, DOCUMENT_MAX_BYTES + 1 - bytes), null);
      if (!bytesRead) break;
      parts.push(Buffer.from(chunk.subarray(0, bytesRead)));
      bytes += bytesRead;
    }
    if (bytes > DOCUMENT_MAX_BYTES) return failure(request, 'too_large');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts, bytes)); }
    catch { return failure(request, 'invalid_utf8'); }
    return { type: 'document.content', requestId: request.requestId, path: await realpath(path), text,
      bytes, modifiedAt: stat.mtime.toISOString() };
  } catch (e) { return failure(request, errorCode(e)); }
  finally { await file?.close(); }
}
