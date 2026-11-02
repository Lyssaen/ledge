import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AttachmentError, type AttachmentErrorReason } from './attachments.js';

export interface Reduced { image: Buffer; preview?: Buffer }
interface Job { raw: Buffer; resolve: (r: Reduced) => void; reject: (e: AttachmentError) => void }
type Answer = { image: Uint8Array; preview?: Uint8Array } | { reason: AttachmentErrorReason };

const buf = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

/** The built daemon has `reduceWorker.js` beside its bundle (a tsup entry); from the sources, the `.ts` runs through tsx. */
function defaultWorker(): { script: URL; execArgv?: string[] } {
  const built = new URL('./reduceWorker.js', import.meta.url);
  return existsSync(fileURLToPath(built)) ? { script: built } : { script: new URL('./reduceWorker.ts', import.meta.url), execArgv: ['--import', 'tsx'] };
}

/**
 * Runs `reduceCapture` (seconds of pure-JS codec work on a big page) in a worker thread, so the daemon keeps serving
 * meanwhile: one long-lived worker, started on the first capture, one job at a time in arrival order. A worker that dies
 * answers its job `unreadable`; the next job starts a new one.
 */
export class CaptureReducer {
  private worker: Worker | undefined;
  private readonly queue: Job[] = [];
  private busy: Job | undefined;
  private closed = false;
  private readonly target: { script: URL; execArgv?: string[] };

  constructor(script?: URL) { this.target = script ? { script } : defaultWorker(); }

  reduce(raw: Buffer): Promise<Reduced> {
    if (this.closed) return Promise.reject(new AttachmentError('unreadable'));
    return new Promise((resolve, reject) => { this.queue.push({ raw, resolve, reject }); this.pump(); });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new AttachmentError('unreadable'));
    const w = this.worker; this.worker = undefined;
    await w?.terminate();
  }

  private pump(): void {
    if (this.busy || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = job;
    (this.worker ??= this.spawn()).postMessage(job.raw);
  }

  private spawn(): Worker {
    const w = new Worker(this.target.script, this.target.execArgv ? { execArgv: this.target.execArgv } : {});
    w.unref(); // the daemon's server keeps the process alive; an idle worker must not
    w.on('message', (a: Answer) => {
      const job = this.busy; this.busy = undefined;
      if ('reason' in a) job?.reject(new AttachmentError(a.reason));
      else job?.resolve({ image: buf(a.image), ...(a.preview ? { preview: buf(a.preview) } : {}) });
      this.pump();
    });
    w.on('error', () => { /* the exit that follows answers the job */ });
    w.on('exit', () => {
      if (this.worker === w) this.worker = undefined;
      const job = this.busy; this.busy = undefined;
      job?.reject(new AttachmentError('unreadable'));
      this.pump();
    });
    return w;
  }
}
