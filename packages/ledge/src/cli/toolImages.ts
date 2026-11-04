import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { ATTACHMENTS_MAX, CAPTURE_RAW_MAX, IMAGE_MIMES, type ImageMime } from '@ledge/protocol';
import { imageInfo } from '../imageInfo.js';

export type ToolImage = { mime: ImageMime; data: string };
const isMime = (v: unknown): v is ImageMime => (IMAGE_MIMES as readonly string[]).includes(v as string);
const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' ? v as Record<string, unknown> : undefined);

/** Claude Code prints `[Image: source: <path>]` after an image it saved in its own project store. */
// An absolute path: POSIX, or Windows (`C:\\…`, `c:/…`) where Claude Code runs natively.
const SOURCE_LINE = /^\[Image: source: ((?:\/|[A-Za-z]:[\\/]).+)\]$/;

/** The file a `[Image: source: <path>]` line names, when the path is absolute. */
export const imageSourceOf = (line: string): string | undefined => SOURCE_LINE.exec(line.trim())?.[1];

/** The file such a line names, only when it really lies under `<home>/.claude/projects/` (symlinks resolved); one over CAPTURE_RAW_MAX is not read: `'too_large'`. */
function readSource(path: string, home: string): ToolImage | 'too_large' | undefined {
  try {
    const root = realpathSync(join(home, '.claude', 'projects')) + sep;
    const real = realpathSync(path);
    if (!real.startsWith(root)) return undefined;
    if (statSync(real).size > CAPTURE_RAW_MAX) return 'too_large';
    const bytes = readFileSync(real);
    const info = imageInfo(bytes);
    return info ? { mime: info.mime, data: bytes.toString('base64') } : undefined;
  } catch { return undefined; }
}

/**
 * The images a tool response carries, in order, at most ATTACHMENTS_MAX, base64: Claude blocks
 * `{type:'image', source:{type:'base64', media_type, data}}` and MCP blocks `{type:'image', data, mimeType}`.
 * Mimes outside IMAGE_MIMES are skipped. Only when the response holds no image block, the `[Image: source: <path>]` lines
 * of its text blocks name files, read when they lie under the Claude project store. `dropped` says images were left out:
 * past ATTACHMENTS_MAX, or a named file over CAPTURE_RAW_MAX.
 */
export function toolImages(response: unknown, home: string = homedir()): { images: ToolImage[]; dropped: boolean } {
  if (!Array.isArray(response)) return { images: [], dropped: false };
  const blocks = response.map(obj).filter((b): b is Record<string, unknown> => !!b);
  const found: ToolImage[] = [];
  let sawImageBlock = false, dropped = false;
  for (const b of blocks) {
    if (b.type !== 'image') continue;
    sawImageBlock = true;
    const src = obj(b.source);
    const mime = src?.type === 'base64' ? src.media_type : b.mimeType;
    const data = src?.type === 'base64' ? src.data : b.data;
    if (isMime(mime) && typeof data === 'string' && data) found.push({ mime, data });
  }
  if (!sawImageBlock) {
    for (const b of blocks) {
      if (b.type !== 'text' || typeof b.text !== 'string') continue;
      for (const line of b.text.split('\n')) {
        const path = imageSourceOf(line);
        const image = path ? readSource(path, home) : undefined;
        if (image === 'too_large') dropped = true;
        else if (image) found.push(image);
      }
    }
  }
  return { images: found.slice(0, ATTACHMENTS_MAX), dropped: dropped || found.length > ATTACHMENTS_MAX };
}
