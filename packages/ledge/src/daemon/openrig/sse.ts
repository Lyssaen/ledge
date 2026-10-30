import { log } from '../../log.js';
import type { Fetch } from './http.js';

export interface OpenRigEvent { seq: number; type: string; rigId?: string; [k: string]: unknown }
export interface EventStream { close(): void }

/** Parses one SSE frame (`id:`, `data:` lines, `:` comments); null when it has no usable JSON event. */
function parseFrame(frame: string): OpenRigEvent | null {
  let id: string | undefined; const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue;
    const i = line.indexOf(':'); const field = i < 0 ? line : line.slice(0, i); let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') id = value; else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  let json: unknown; try { json = JSON.parse(data.join('\n')); } catch { return null; }
  if (!json || typeof json !== 'object' || typeof (json as { type?: unknown }).type !== 'string') return null;
  const seq = id !== undefined ? Number(id) : Number((json as { seq?: unknown }).seq);
  if (!Number.isFinite(seq)) return null;
  return { ...(json as object), seq } as OpenRigEvent;
}

/** One connection to `/api/events`, a single attempt: reconnecting is the bridge's job. `onEnd` fires exactly once when the
 *  stream stops by itself (server closed it, network failure, non-200); it does NOT fire after an explicit `close()`. */
export function openEventStream(opts: { base: string; fetch?: Fetch; lastEventId: number | null;
  onEvent(e: OpenRigEvent): void; onOpen(): void; onEnd(error?: Error): void }): EventStream {
  const doFetch = opts.fetch ?? fetch; const ac = new AbortController();
  let closed = false; let ended = false; let max = -Infinity;
  const end = (error?: Error) => { if (closed || ended) return; ended = true; ac.abort(); opts.onEnd(error); }; // abort releases the socket (non-200 body, throwing onOpen)
  const url = `${opts.base}/api/events${opts.lastEventId === null ? '?replay=0' : ''}`;
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (opts.lastEventId !== null) headers['last-event-id'] = String(opts.lastEventId);

  (async () => {
    try {
      const res = await doFetch(url, { headers, signal: ac.signal });
      if (!res.ok || !res.body) return end(new Error(`OpenRig /api/events answered ${res.status}`));
      if (closed) return;
      opts.onOpen();
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (closed) return;
        if (done) break;
        buf += dec.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const e = parseFrame(buf.slice(0, i)); buf = buf.slice(i + 2);
          if (!e || e.seq <= max) continue;
          max = e.seq;
          try { opts.onEvent(e); } catch (err) { log(`openrig: event handler threw: ${(err as Error).message}`); }
        }
      }
      end();
    } catch (e) { end(e instanceof Error ? e : new Error(String(e))); }
  })();

  return { close() { if (closed) return; closed = true; ac.abort(); } };
}
