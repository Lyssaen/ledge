import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ATTACHMENT_ID, AttachmentRefSchema, PREVIEW_MAX, type AttachmentRef, type ImageMime } from '@ledge/protocol';
import { imageInfo } from '../imageInfo.js';

export type AttachmentErrorReason = 'too_large' | 'not_image' | 'unreadable' | 'not_found';

export class AttachmentError extends Error {
  constructor(readonly reason: AttachmentErrorReason) { super(`attachment: ${reason}`); this.name = 'AttachmentError'; }
}

const EXT: Record<ImageMime, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
const MAX_AGE_MS = 24 * 3_600_000;

/** Content-addressed images under one directory: `<id>.<ext>`, `<id>.preview.<ext>` and `<id>.json` (the ref), with an in-memory index of the refs. */
export class AttachmentStore {
  private index = new Map<string, AttachmentRef>();

  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {}

  async load(): Promise<void> {
    this.index.clear();
    let names: string[];
    try { names = await readdir(this.dir); } catch { return; }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const ref = AttachmentRefSchema.parse(JSON.parse(await readFile(join(this.dir, name), 'utf8')));
        if (name === `${ref.id}.json`) this.index.set(ref.id, ref);
      } catch { /* unreadable meta: not indexed */ }
    }
  }

  async put(image: Buffer, preview: Buffer | undefined, max: number): Promise<AttachmentRef> {
    if (image.length > max) throw new AttachmentError('too_large');
    const info = imageInfo(image);
    if (!info) throw new AttachmentError('not_image');
    const previewInfo = preview ? imageInfo(preview) : null;
    if (preview) {
      if (!previewInfo) throw new AttachmentError('not_image');
      if (preview.length > PREVIEW_MAX) throw new AttachmentError('too_large');
    }
    const id = createHash('sha256').update(image).digest('hex');
    const ref: AttachmentRef = { id, mime: info.mime, width: info.width, height: info.height, bytes: image.length, preview: preview !== undefined };
    try {
      await mkdir(this.dir, { recursive: true });
      await this.write(`${id}.${EXT[info.mime]}`, image);
      if (preview && previewInfo) await this.write(`${id}.preview.${EXT[previewInfo.mime]}`, preview);
      await this.write(`${id}.json`, Buffer.from(JSON.stringify(ref)));
    } catch { throw new AttachmentError('unreadable'); }
    this.index.set(id, ref);
    return ref;
  }

  ref(id: string): AttachmentRef | null { return ATTACHMENT_ID.test(id) ? this.index.get(id) ?? null : null; }

  path(id: string): string | null {
    const ref = this.ref(id);
    return ref ? join(this.dir, `${ref.id}.${EXT[ref.mime]}`) : null;
  }

  async read(id: string, preview = false): Promise<{ mime: ImageMime; data: Buffer } | null> {
    const ref = this.ref(id);
    if (!ref || (preview && !ref.preview)) return null;
    // The preview's own type is not in the ref: find it by extension.
    const names = preview ? Object.values(EXT).map(e => `${id}.preview.${e}`) : [`${id}.${EXT[ref.mime]}`];
    for (const name of names) {
      let data: Buffer;
      try { data = await readFile(join(this.dir, name)); } catch { continue; }
      const info = imageInfo(data);
      if (info) return { mime: info.mime, data };
    }
    return null;
  }

  /** Deletes images last put over 24 h ago that `referenced` does not name; returns their ids. */
  async sweep(referenced: ReadonlySet<string>): Promise<string[]> {
    const swept: string[] = [];
    for (const [id, ref] of [...this.index]) {
      if (referenced.has(id)) continue;
      let mtime: number;
      try { mtime = (await stat(join(this.dir, `${id}.${EXT[ref.mime]}`))).mtimeMs; } catch { mtime = 0; }
      if (this.now() - mtime <= MAX_AGE_MS) continue;
      for (const ext of Object.values(EXT)) {
        await unlink(join(this.dir, `${id}.${ext}`)).catch(() => {});
        await unlink(join(this.dir, `${id}.preview.${ext}`)).catch(() => {});
      }
      await unlink(join(this.dir, `${id}.json`)).catch(() => {});
      this.index.delete(id);
      swept.push(id);
    }
    return swept;
  }

  /** Atomic write (temp + rename); rewriting identical content refreshes the mtime, which the sweep reads. */
  private async write(name: string, data: Buffer): Promise<void> {
    const file = join(this.dir, name);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, file);
    const t = new Date(this.now());
    await utimes(file, t, t);
  }
}
