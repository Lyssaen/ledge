import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, dirname, extname, resolve } from 'node:path';
import type { DocumentRead, DocumentContent, DocumentError, DocumentErrorCode } from '@ledge/protocol';
import { DOCUMENT_MAX_BYTES } from '@ledge/protocol';

const markdown = (path: string) => /^\.(?:md|markdown)$/i.test(extname(path));
const failure = (request: DocumentRead, code: DocumentErrorCode): DocumentError => ({
  type: 'document.error', requestId: request.requestId, path: request.path, code
});
const errorCode = (e: unknown): DocumentErrorCode => {
  const code = (e as NodeJS.ErrnoException).code;
  return code === 'ENOENT' ? 'not_found' : code === 'EACCES' || code === 'EPERM' ? 'permission_denied'
    : code === 'EISDIR' || code === 'ENXIO' ? 'not_file' : 'read_failed';
};

/** Read one WSL Markdown file for the requesting socket. Never spawns a process or writes to the file. */
export async function readDocument(request: DocumentRead, context: { cwd?: string; home: string }): Promise<DocumentContent | DocumentError> {
  const source = request.path;
  if (/^(?:file:|[a-zA-Z]:[\\/]|\\\\)/.test(source) || source.includes('\0')) return failure(request, 'unsupported_path');
  if (request.basePath && (!isAbsolute(request.basePath) || !markdown(request.basePath))) return failure(request, 'unsupported_path');
  const expanded = source === '~' ? context.home : source.startsWith('~/') ? resolve(context.home, source.slice(2)) : source;
  const base = request.basePath ? dirname(request.basePath) : context.cwd;
  if (!isAbsolute(expanded) && !base) return failure(request, 'ambiguous_path');
  const path = resolve(base ?? context.home, expanded);
  if (!markdown(path)) return failure(request, 'unsupported_type');
  let file;
  try {
    // O_NONBLOCK also makes a path replaced by a FIFO between resolution and open safe to reject.
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
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
