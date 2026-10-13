import type { Readable } from 'node:stream';

export const MAX_FRAME = 4 * 1024 * 1024;

/** Bounded NDJSON, including fragmented UTF-8 from an SSH pipe. Returns listener cleanup. */
export function readFrames(input: Readable, frame: (value: unknown) => void, fail: (e: Error) => void): () => void {
  let buffer = '', stopped = false;
  input.setEncoding('utf8');
  const data = (chunk: string) => {
    if (stopped) return;
    buffer += chunk;
    try {
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        if (Buffer.byteLength(line) > MAX_FRAME) throw new Error('Ledge frame too large');
        if (line.trim()) frame(JSON.parse(line));
      }
      if (Buffer.byteLength(buffer) > MAX_FRAME) throw new Error('Ledge frame too large');
    } catch (e) { stopped = true; fail(e instanceof Error ? e : new Error(String(e))); }
  };
  const end = () => { if (!stopped && buffer.trim()) { stopped = true; fail(new Error('Incomplete Ledge frame')); } };
  input.on('data', data); input.on('end', end);
  return () => { stopped = true; input.off('data', data); input.off('end', end); };
}
