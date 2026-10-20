// The outgoing queue to phones, shared by all devices: it stays under the relay's per-socket rate limit
// (the relay allows 300 frames or 8 MiB per 10 s; this keeps to 200 and 4 MiB), serves devices in turn,
// and lets a newer message with the same key replace a queued one. Logs carry a type and a size, never content.
import type { PhoneServerMessage } from '@ledge/protocol';
import { pad } from './pad.js';

/** One device's queue is cut, and its owner asked to resync, past either bound. */
const QUEUE_MESSAGES_MAX = 300;
const QUEUE_BYTES_MAX = 8 * 1_048_576;

export interface Outbox {
  /** Queues `msg` for the device; a queued message with the same `key` is replaced in place. */
  push(deviceId: string, msg: PhoneServerMessage, key?: string): void;
  /** Forgets everything queued for the device. */
  drop(deviceId: string): void;
  /** Resolves once nothing is queued or being sent for the device (at once if there is nothing), or when the outbox closes. */
  flush(deviceId: string): Promise<void>;
  close(): void;
}

interface Item { key?: string; text: string; cost: number; priority?: true }

/** Base64 of the sealed text plus the frame envelope. */
const costOf = (padded: string) => Math.ceil(Buffer.byteLength(padded, 'utf8') * 4 / 3) + 256;

export function createOutbox(opts: {
  send(deviceId: string, text: string): Promise<boolean>;
  onGone(deviceId: string): void;
  onOverflow(deviceId: string): void;
  log(line: string): void;
  now?: () => number;
  frames?: number;
  bytes?: number;
  windowMs?: number;
}): Outbox {
  const now = opts.now ?? (() => performance.now());
  const frames = opts.frames ?? 200;
  const bytes = opts.bytes ?? 4 * 1_048_576;
  const windowMs = opts.windowMs ?? 10_000;

  const queues = new Map<string, Item[]>();
  const queuedBytes = new Map<string, number>();
  /** Devices with something queued, in turn order. */
  const turn: string[] = [];
  /** Sends started inside the window, oldest first. */
  let window: Array<{ at: number; cost: number }> = [];
  let windowBytes = 0;
  let running = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The device whose text is on its way to the relay. */
  let sending: string | null = null;
  let waiters: Array<{ deviceId: string; done: () => void }> = [];

  const clear = (deviceId: string) => {
    queues.delete(deviceId);
    queuedBytes.delete(deviceId);
    const i = turn.indexOf(deviceId);
    if (i >= 0) turn.splice(i, 1);
  };

  const settle = () => {
    const ready = waiters.filter(w => closed || (!queues.has(w.deviceId) && sending !== w.deviceId));
    waiters = waiters.filter(w => !ready.includes(w));
    for (const w of ready) w.done();
  };

  const prune = () => {
    const limit = now() - windowMs;
    while (window.length > 0 && window[0]!.at <= limit) windowBytes -= window.shift()!.cost;
  };

  const pump = async () => {
    if (running || closed || timer !== null) return;
    running = true;
    try {
      while (!closed && turn.length > 0) {
        prune();
        const deviceId = turn[0]!;
        const queue = queues.get(deviceId)!;
        const item = queue[0]!;
        const full = window.length >= frames || (window.length > 0 && windowBytes + item.cost > bytes);
        if (full) {
          const wait = Math.max(1, window[0]!.at + windowMs - now());
          timer = setTimeout(() => { timer = null; void pump(); }, wait);
          return;
        }
        queue.shift();
        queuedBytes.set(deviceId, (queuedBytes.get(deviceId) ?? 0) - item.cost);
        // Served in turn: this device goes to the back if it has more, and leaves if not.
        turn.shift();
        if (queue.length > 0) turn.push(deviceId);
        else clear(deviceId);
        window.push({ at: now(), cost: item.cost });
        windowBytes += item.cost;
        let ok = false;
        sending = deviceId;
        try { ok = await opts.send(deviceId, item.text); } catch { ok = false; }
        sending = null;
        if (!ok && !closed) {
          clear(deviceId);
          try { opts.onGone(deviceId); } catch (err) {
            opts.log(`phone outbox: onGone failed (${err instanceof Error ? err.name : 'error'})`);
          }
        }
        settle();
      }
    } finally {
      running = false;
    }
  };

  const enqueue = (deviceId: string, text: string, key: string | undefined, priority = false) => {
    const cost = costOf(text);
    let queue = queues.get(deviceId);
    const at = key === undefined ? -1 : (queue?.findIndex((q) => q.key === key) ?? -1);
    if (queue && at >= 0) {
      queuedBytes.set(deviceId, (queuedBytes.get(deviceId) ?? 0) - queue[at]!.cost + cost);
      queue[at] = { key, text, cost, ...(queue[at]!.priority ? { priority: true as const } : {}) };
    } else {
      queue ??= [];
      // An answer to the phone goes ahead of the updates, behind the answers already waiting.
      if (priority) {
        let i = 0;
        while (queue[i]?.priority) i++;
        queue.splice(i, 0, { key, text, cost, priority: true });
      } else queue.push({ key, text, cost });
      queues.set(deviceId, queue);
      queuedBytes.set(deviceId, (queuedBytes.get(deviceId) ?? 0) + cost);
      if (!turn.includes(deviceId)) turn.push(deviceId);
    }
    if (queue.length > QUEUE_MESSAGES_MAX || (queuedBytes.get(deviceId) ?? 0) > QUEUE_BYTES_MAX) {
      clear(deviceId);
      opts.log(`phone outbox: queue overflow for device ${deviceId}`);
      opts.onOverflow(deviceId);
      return;
    }
    void pump();
  };

  return {
    push(deviceId, msg, key) {
      if (closed) return;
      const json = JSON.stringify(msg);
      const padded = pad(json);
      if (padded === null) {
        opts.log(`phone message too large: ${msg.type} ${Buffer.byteLength(json, 'utf8')} bytes`);
        const err = pad(JSON.stringify({ type: 'error', code: 'too_large', request: msg.type } satisfies PhoneServerMessage))!;
        enqueue(deviceId, err, `too_large:${msg.type}`, true);
        return;
      }
      enqueue(deviceId, padded, key, msg.type === 'operation.result' || msg.type === 'error');
    },
    drop(deviceId) { clear(deviceId); settle(); },
    flush: deviceId => new Promise<void>(done => {
      if (closed || (!queues.has(deviceId) && sending !== deviceId)) return done();
      waiters.push({ deviceId, done });
    }),
    close() {
      closed = true;
      settle();
      if (timer) clearTimeout(timer);
      timer = null;
      queues.clear();
      queuedBytes.clear();
      turn.length = 0;
      window = [];
    }
  };
}
