import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/**
 * OMP's `--mode rpc-ui`: one JSON object per line on stdin and stdout (not JSON-RPC 2.0). A command carries an `id` and is
 * answered by the `response` frame with that id, whatever the order; every other frame is an event, in stream order.
 * Spec 2026-10-20 §4. Protocol 1 only: the 1 MiB frame limit it announces is enforced, a frame past it is reported, never half-read.
 */

export type Frame = { type: string; [k: string]: unknown };
export interface Ready { protocolVersion: number; supportedProtocolVersions: number[]; maxFrameBytes: number; maxReassembledFrameBytes: number }

export const DEFAULT_MAX_FRAME = 1024 * 1024;
const STDERR_TAIL = 4000;

/** A command OMP refused (`success: false`), or could not take (the process ended, no answer in time). */
export class RpcError extends Error {
  constructor(message: string, readonly code: 'refused' | 'closed' | 'timeout' | 'write') { super(message); }
}

/** Splits a byte stream into lines: UTF-8 strict, `\r\n` tolerated, a line past `max` bytes dropped whole and reported once. */
export function lineReader(max: number, onLine: (line: string) => void, onBad: (reason: string) => void): (chunk: Buffer) => void {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let parts: Buffer[] = []; let size = 0; let skipping = false;
  const flush = () => {
    const whole = parts.length === 1 ? parts[0]! : Buffer.concat(parts); parts = []; size = 0;
    let text: string;
    try { text = decoder.decode(whole); } catch { return onBad('invalid UTF-8'); }
    const line = text.endsWith('\r') ? text.slice(0, -1) : text;
    if (line.trim() !== '') onLine(line);
  };
  return chunk => {
    let from = 0;
    for (;;) {
      const nl = chunk.indexOf(0x0a, from);
      const end = nl === -1 ? chunk.length : nl;
      if (!skipping) {
        size += end - from;
        if (size > max) { skipping = true; parts = []; size = 0; onBad(`frame over ${max} bytes`); }
        else if (end > from) parts.push(chunk.subarray(from, end));
      }
      if (nl === -1) return;
      if (skipping) skipping = false; else flush();
      from = nl + 1;
    }
  };
}

/**
 * Protocol 2's `rpc_chunk`: a frame past the physical limit travels as `count` chunks `{chunkId, index, count, byteLength, data}`
 * (base64 of consecutive byte slices of the frame's UTF-8 JSON), in order. Reassembled strictly: indices one after the other,
 * the total exactly `byteLength` and within `maxBytes`, base64 and UTF-8 valid; a set that breaks any of it is dropped whole and
 * reported, never delivered half-read. Bounded: few sets at once.
 */
export class ChunkAssembler {
  private sets = new Map<string, { count: number; byteLength: number; next: number; parts: Buffer[]; size: number }>();
  constructor(private readonly maxBytes: number, private readonly maxSets = 8) {}

  /** The whole frame's text once its last chunk is in; null while more are due; throws the reason a set is dropped. */
  add(f: Frame): string | null {
    const { chunkId, index, count, byteLength, data } = f as { chunkId?: unknown; index?: unknown; count?: unknown; byteLength?: unknown; data?: unknown };
    if (typeof chunkId !== 'string' || !Number.isInteger(index) || !Number.isInteger(count) || !Number.isInteger(byteLength) || typeof data !== 'string') throw new Error('malformed rpc_chunk');
    const i = index as number, n = count as number, total = byteLength as number;
    let set = this.sets.get(chunkId);
    if (!set) {
      if (i !== 0) throw new Error('rpc_chunk set does not start at 0');
      if (n < 1 || total < 0 || total > this.maxBytes) throw new Error(`rpc_chunk set over the limit (${total} bytes)`);
      if (this.sets.size >= this.maxSets) throw new Error('too many rpc_chunk sets at once');
      set = { count: n, byteLength: total, next: 0, parts: [], size: 0 };
      this.sets.set(chunkId, set);
    }
    const drop = (why: string): never => { this.sets.delete(chunkId); throw new Error(why); };
    if (n !== set.count || total !== set.byteLength) drop('rpc_chunk set changed shape');
    if (i !== set.next) drop('rpc_chunk out of order');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) drop('invalid rpc chunk data');
    const part = Buffer.from(data, 'base64');
    set.size += part.length;
    if (set.size > set.byteLength) drop('rpc_chunk set longer than announced');
    set.parts.push(part); set.next++;
    if (set.next < set.count) return null;
    this.sets.delete(chunkId);
    if (set.size !== set.byteLength) throw new Error('rpc_chunk set shorter than announced');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(set.parts)); } catch { throw new Error('rpc_chunk set is not UTF-8'); }
  }
}

export interface RpcOptions {
  /** The binary and its leading arguments (`['omp']`); tests run a fake. */
  command: string[];
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  spawn?: typeof nodeSpawn;
  readyMs?: number;
}

export interface RpcExit { code: number | null; signal: NodeJS.Signals | null; stderr: string }

export class OmpRpc {
  private seq = 0;
  private pending = new Map<string, { resolve: (f: Frame) => void; reject: (e: Error) => void; timer: NodeJS.Timeout | null }>();
  private frameListeners = new Set<(f: Frame) => void>();
  private badListeners = new Set<(reason: string) => void>();
  private exitListeners = new Set<(e: RpcExit) => void>();
  private stderr = '';
  private exited: RpcExit | null = null;
  private closing = false;
  private readyFrame: Ready | null = null;
  private chunks = new ChunkAssembler(0);
  /** The protocol in use: 1 until `negotiate_protocol` is accepted. */
  protocol = 1;
  private readyWaiters: Array<{ ok: (r: Ready) => void; fail: (e: Error) => void }> = [];

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    const feed = lineReader(DEFAULT_MAX_FRAME, line => this.onLine(line), reason => { for (const l of this.badListeners) l(reason); });
    child.stdout.on('data', feed);
    child.stderr.on('data', (d: Buffer) => { this.stderr = (this.stderr + d.toString('utf8')).slice(-STDERR_TAIL); });
    child.stdin.on('error', () => undefined); // an EPIPE after the exit is the exit's business
    child.on('error', e => this.handleExit({ code: null, signal: null, stderr: e.message }));
    child.on('close', (code, signal) => this.handleExit({ code, signal, stderr: this.stderr }));
  }

  /** Spawns the process and waits for its `ready` frame. */
  static async start(o: RpcOptions): Promise<OmpRpc & { ready: Ready }> {
    const [file, ...lead] = o.command;
    const child = (o.spawn ?? nodeSpawn)(file!, [...lead, ...o.args], { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    const rpc = new OmpRpc(child);
    const ready = await new Promise<Ready>((ok, fail) => {
      const timer = setTimeout(() => fail(new RpcError('OMP did not become ready', 'timeout')), o.readyMs ?? 30_000);
      rpc.readyWaiters.push({ ok: r => { clearTimeout(timer); ok(r); }, fail: e => { clearTimeout(timer); fail(e); } });
      if (rpc.exited) fail(new RpcError(rpc.exitText(), 'closed'));
    }).catch(async e => { await rpc.close(); throw e; });
    // Protocol 2 when announced: a frame past 1 MiB then arrives as chunks instead of being refused (the limit also holds for what we send).
    if (ready.supportedProtocolVersions.includes(2)) {
      rpc.chunks = new ChunkAssembler(ready.maxReassembledFrameBytes);
      try { await rpc.request('negotiate_protocol', { protocolVersion: 2 }, 10_000); rpc.protocol = 2; }
      catch { /* a refusal keeps protocol 1: no chunk will come */ }
    }
    return Object.assign(rpc, { ready });
  }

  get pid(): number | undefined { return this.child.pid; }
  get stderrTail(): string { return this.stderr; }
  get hasExited(): boolean { return this.exited !== null; }

  /** Event frames, in order (responses go to their request). */
  onFrame(fn: (f: Frame) => void): () => void { this.frameListeners.add(fn); return () => this.frameListeners.delete(fn); }
  /** A line that was not a frame (not JSON, too long, not UTF-8): never delivered, reported. */
  onBad(fn: (reason: string) => void): () => void { this.badListeners.add(fn); return () => this.badListeners.delete(fn); }
  onExit(fn: (e: RpcExit) => void): () => void {
    if (this.exited) { fn(this.exited); return () => undefined; }
    this.exitListeners.add(fn); return () => this.exitListeners.delete(fn);
  }

  /** Sends a command; resolves with the response's `data`, rejects with OMP's own error text when it refuses. */
  request<T = unknown>(type: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (this.exited || this.closing) return Promise.reject(new RpcError('OMP has ended', 'closed'));
    const id = `l${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => { this.pending.delete(id); reject(new RpcError(`${type}: no answer`, 'timeout')); }, timeoutMs) : null;
      this.pending.set(id, {
        timer, reject,
        resolve: f => {
          if (f.success === false) return reject(new RpcError(String(f.error ?? `${type} refused`), 'refused'));
          resolve(f.data as T);
        }
      });
      this.write({ id, type, ...params }).catch(e => { clearTimeout(timer ?? undefined); this.pending.delete(id); reject(e as Error); });
    });
  }

  /** A frame that expects no response (`extension_ui_response`). */
  write(frame: Record<string, unknown>): Promise<void> {
    if (this.exited) return Promise.reject(new RpcError('OMP has ended', 'closed'));
    return new Promise((ok, fail) => this.child.stdin.write(`${JSON.stringify(frame)}\n`, e => (e ? fail(new RpcError(e.message, 'write')) : ok())));
  }

  /** Ends stdin so OMP persists and leaves; a process that stays is terminated, then killed. Resolves with its exit. */
  async close(graceMs = 3000): Promise<RpcExit> {
    this.closing = true;
    if (!this.exited) {
      this.child.stdin.end();
      const gone = new Promise<void>(res => this.onExit(() => res()));
      const wait = (ms: number) => Promise.race([gone.then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), ms).unref())]);
      if (!(await wait(graceMs))) { this.child.kill('SIGTERM'); if (!(await wait(2000))) { this.child.kill('SIGKILL'); await gone; } }
    }
    return this.exited!;
  }

  private exitText(): string { return `OMP exited${this.exited?.code != null ? ` (${this.exited.code})` : ''}${this.stderr.trim() ? `: ${this.stderr.trim().split('\n').pop()}` : ''}`; }

  private onLine(line: string): void {
    let f: Frame;
    try { const v = JSON.parse(line) as unknown; if (!v || typeof v !== 'object' || typeof (v as Frame).type !== 'string') throw new Error('not a frame'); f = v as Frame; }
    catch { for (const l of this.badListeners) l('not JSON'); return; }
    if (f.type === 'rpc_chunk') {
      if (this.protocol !== 2) { for (const l of this.badListeners) l('rpc_chunk before protocol 2'); return; }
      let whole: string | null;
      try { whole = this.chunks.add(f); } catch (e) { for (const l of this.badListeners) l((e as Error).message); return; }
      if (whole !== null) this.onLine(whole);
      return;
    }
    if (f.type === 'ready' && !this.readyFrame) {
      this.readyFrame = f as unknown as Ready;
      const r: Ready = { ...({ maxFrameBytes: DEFAULT_MAX_FRAME, maxReassembledFrameBytes: 0, supportedProtocolVersions: [1] } as Partial<Ready>), ...(f as unknown as Ready) };
      for (const w of this.readyWaiters.splice(0)) w.ok(r);
      return;
    }
    if (f.type === 'response' && typeof f.id === 'string') {
      const p = this.pending.get(f.id);
      if (p) { this.pending.delete(f.id); if (p.timer) clearTimeout(p.timer); p.resolve(f); return; }
    }
    for (const l of this.frameListeners) l(f);
  }

  private handleExit(e: RpcExit): void {
    if (this.exited) return;
    this.exited = e;
    const gone = new RpcError(this.exitText(), 'closed');
    for (const w of this.readyWaiters.splice(0)) w.fail(gone);
    for (const [id, p] of this.pending) { if (p.timer) clearTimeout(p.timer); p.reject(gone); this.pending.delete(id); }
    for (const l of [...this.exitListeners]) l(e);
    this.exitListeners.clear();
  }
}
