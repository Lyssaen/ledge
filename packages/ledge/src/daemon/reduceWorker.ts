import { parentPort } from 'node:worker_threads';
import { AttachmentError } from './attachments.js';
import { reduceCapture } from './reduce.js';

/** The reduce worker (CaptureReducer starts it): one raw capture in, `{ image, preview? }` or `{ reason }` out. Anything else thrown kills it. */
parentPort!.on('message', (raw: Uint8Array) => {
  try {
    parentPort!.postMessage(reduceCapture(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)));
  } catch (e) {
    if (!(e instanceof AttachmentError)) throw e;
    parentPort!.postMessage({ reason: e.reason });
  }
});
