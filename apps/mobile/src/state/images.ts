// The phone's images: stored one at a time (the PC answers each before the next goes), and fetched through a single
// queue (one request in flight), so a thread full of pictures never floods the sealed link. Object URLs are cached
// per (id, preview) for the page's life; a failed fetch is not cached.
import type { AttachmentRef, ImageMime, ImageUpload, PhoneClientMessage, PhoneServerMessage } from '@ledge/protocol';

/** A put or a get gives up after this long without an answer, and the queue moves on. */
export const IMAGE_TIMEOUT_MS = 30_000;

export interface Images {
  /** Stores the image on the PC; resolves with its ref. Rejects with the server's `reason`, `timeout`, or `offline`. */
  putImage(image: ImageUpload): Promise<AttachmentRef>;
  /** An object URL for the image (its preview when `preview`). One request is in flight across all calls. */
  imageUrl(id: string, preview: boolean): Promise<string>;
  /** The ref of an image this device stored. */
  knownImage(id: string): AttachmentRef | undefined;
  /** Takes the PC's answers; true when `m` was one of them. */
  handle(m: PhoneServerMessage): boolean;
  /** The link dropped: what is in flight gets no answer. */
  lost(): void;
  close(): void;
}

interface Job<T> { build(requestId: string): PhoneClientMessage; resolve(v: T): void; reject(e: Error): void; pick(m: PhoneServerMessage): T | undefined }

/** One request at a time: the next goes out once the current one is answered, failed or timed out. */
function createQueue<T>(send: (m: PhoneClientMessage) => boolean, prefix: string) {
  const waiting: Job<T>[] = [];
  let current: { job: Job<T>; requestId: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let counter = 0;
  const finish = (settle: (job: Job<T>) => void) => {
    const c = current;
    if (!c) return;
    current = null;
    clearTimeout(c.timer);
    settle(c.job);
    next();
  };
  function next() {
    if (current) return;
    const job = waiting.shift();
    if (!job) return;
    const requestId = `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
    current = { job, requestId, timer: setTimeout(() => finish(j => j.reject(new Error('timeout'))), IMAGE_TIMEOUT_MS) };
    if (!send(job.build(requestId))) finish(j => j.reject(new Error('offline')));
  }
  return {
    add(job: Job<T>) { waiting.push(job); next(); },
    handle(m: PhoneServerMessage): boolean {
      if (!current || !('requestId' in m) || m.requestId !== current.requestId) return false;
      if (m.type === 'attachment.error') { const reason = m.reason; finish(j => j.reject(new Error(reason))); return true; }
      const value = current.job.pick(m);
      if (value === undefined) return false;
      finish(j => j.resolve(value));
      return true;
    },
    /** Fails what is in flight and what waits. */
    fail(reason: string) {
      const rest = waiting.splice(0);
      finish(j => j.reject(new Error(reason)));
      for (const j of rest) j.reject(new Error(reason));
    }
  };
}

function objectUrl(mime: ImageMime, data: string): string {
  // jsdom and old webviews have no object URLs: a data URL does the same job.
  if (typeof URL.createObjectURL !== 'function') return `data:${mime};base64,${data}`;
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export function createImages(send: (m: PhoneClientMessage) => boolean): Images {
  const known = new Map<string, AttachmentRef>();
  const urls = new Map<string, Promise<string>>();
  const puts = createQueue<AttachmentRef>(send, 'put');
  const gets = createQueue<{ mime: ImageMime; data: string }>(send, 'get');
  return {
    putImage(image) {
      return new Promise<AttachmentRef>((resolve, reject) => puts.add({
        build: requestId => ({ type: 'attachment.put', requestId, image }),
        pick: m => m.type === 'attachment.stored' ? m.ref : undefined,
        resolve: ref => { known.set(ref.id, ref); resolve(ref); },
        reject
      }));
    },
    imageUrl(id, preview) {
      const key = `${id}|${preview}`;
      const cached = urls.get(key);
      if (cached) return cached;
      const p = new Promise<string>((resolve, reject) => gets.add({
        build: requestId => ({ type: 'attachment.get', requestId, attachment: id, ...(preview ? { preview: true } : {}) }),
        pick: m => m.type === 'attachment.data' ? { mime: m.mime, data: m.data } : undefined,
        resolve: d => resolve(objectUrl(d.mime, d.data)),
        reject
      }));
      urls.set(key, p);
      p.catch(() => { if (urls.get(key) === p) urls.delete(key); });
      return p;
    },
    knownImage: id => known.get(id),
    handle: m => (m.type === 'attachment.stored' || m.type === 'attachment.data' || m.type === 'attachment.error') && (puts.handle(m) || gets.handle(m)),
    lost() { puts.fail('offline'); gets.fail('offline'); },
    close() { puts.fail('offline'); gets.fail('offline'); }
  };
}
