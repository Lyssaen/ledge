// A stand-in for the reduce worker: answers `<n>:<text>` (n counts the jobs this worker ran), dies on `crash`, refuses `refuse`.
import { parentPort } from 'node:worker_threads';

let n = 0;
parentPort.on('message', raw => {
  const text = Buffer.from(raw).toString();
  if (text === 'crash') throw new Error('boom');
  if (text === 'refuse') return parentPort.postMessage({ reason: 'not_image' });
  parentPort.postMessage({ image: Buffer.from(`${n++}:${text}`) });
});
