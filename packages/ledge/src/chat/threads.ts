import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatRelay, Tool } from '@ledge/protocol';
import { createChat, type Chat, type ChatDeps, type ChatMessage } from './service.js';

export type ChatThreadId = 'desktop' | `device:${string}`;
type Emit = (m: ChatMessage) => void;
/** A device id is its key's fingerprint (base64url): never a path. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const checkId = (id: string) => { if (!SAFE_ID.test(id)) throw new Error('invalid device id'); };

/** A pool of places shared by the threads: `take` is refused once `max` questions run. */
export function createSlots(max = 3): { take(): boolean; give(): void } {
  let used = 0;
  return {
    take() { if (used >= max) return false; used++; return true; },
    give() { if (used > 0) used--; }
  };
}

/** One chat for the desktop and one per paired device, under a common cap on running questions. */
export function createChatThreads(deps: Omit<ChatDeps, 'slots'> & { max?: number }) {
  const { max, ...rest } = deps;
  const slots = createSlots(max);
  const desktop = createChat({ ...rest, slots });
  const devices = new Map<string, Chat>();
  const emitters = new Map<ChatThreadId, Emit>();
  const dropping = new Map<string, Promise<void>>();
  const deviceHome = (id: string) => join(deps.home, 'mobile', 'chat', id);

  const device = (id: string): Chat => {
    checkId(id);
    if (dropping.has(id)) throw new Error('device thread is being dropped');
    let c = devices.get(id);
    if (!c) { c = createChat({ ...rest, home: deviceHome(id), slots }); devices.set(id, c); }
    return c;
  };
  const all = (): Array<[ChatThreadId, Chat]> => [['desktop', desktop], ...[...devices].map(([id, c]): [ChatThreadId, Chat] => [`device:${id}`, c])];
  return {
    desktop,
    device,
    all,
    /** The device's thread if there is one: unlike `device`, never creates it (a late message of a dropped thread must not bring it back). */
    peek(id: string): Chat | undefined { return devices.get(id); },
    setEmitter(thread: ChatThreadId, emit: Emit): void { emitters.set(thread, emit); },
    emitterOf(thread: ChatThreadId): Emit | undefined { return emitters.get(thread); },
    /** The PC's tool of the day file, whatever its day: `claude` without one. */
    async deviceTool(): Promise<Tool> {
      try {
        const t = (JSON.parse(await readFile(join(deps.home, 'chat.json'), 'utf8')) as { tool?: unknown }).tool;
        return t === 'claude' || t === 'codex' || t === 'cursor' || t === 'omp' ? t : 'claude';
      } catch { return 'claude'; }
    },
    /** Forgets the device's thread (a later question starts a fresh one), stops its question, and removes its folder once nothing runs. */
    drop(id: string): Promise<void> {
      checkId(id);
      const running = dropping.get(id); if (running) return running;
      const c = devices.get(id);
      devices.delete(id); emitters.delete(`device:${id}`);
      const p = (async () => {
        try {
          if (c) { for (const t of c.history()) c.cancel(t.qid); await c.idle(); }
          await rm(deviceHome(id), { recursive: true, force: true });
        } finally { dropping.delete(id); }
      })();
      dropping.set(id, p);
      return p;
    },
    /** Every thread's queued instructions (each thread's day roll is told to its own emitter), the desktop's first. */
    queuedRelays(): Array<{ thread: ChatThreadId; qid: string; relay: ChatRelay; askedAt: string }> {
      return all().flatMap(([thread, c]) => c.queuedRelays(emitters.get(thread)).map(q => ({ thread, ...q })));
    },
    /** The ids of the images every thread's turns hold. */
    attachmentIds(): Set<string> { return new Set(all().flatMap(([, c]) => c.attachmentIds())); },
    owner(qid: string): ChatThreadId | undefined {
      for (const [id, c] of all()) if (c.history().some(t => t.qid === qid)) return id;
      return undefined;
    }
  };
}

export type ChatThreads = ReturnType<typeof createChatThreads>;
