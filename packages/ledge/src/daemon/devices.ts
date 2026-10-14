import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Device } from '@ledge/protocol';
import { paths } from '../paths.js';
import { log } from '../log.js';
import type { Pairing } from './pairing.js';

/** The WebAuthn key registered during pairing (decision D5). */
export interface StoredCredential { id: string; publicKey: string; counter: number; transports?: string[] }

/** Only the SHA-256 of the token is kept (decision D6): a stolen file does not open a session. */
export interface DeviceRecord { id: string; name: string; tokenHash: string; createdAt: string; lastSeenAt?: string; credential: StoredCredential }

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The paired phones, in `~/.ledge/devices.json` (0600, written atomically like the session journal). */
export class DeviceStore {
  private records: DeviceRecord[] = [];
  private listeners = new Set<() => void>();
  private saving: Promise<void> = Promise.resolve();
  private readonly path: string;
  private readonly now: () => string;

  constructor(opts: { path?: string; now?: () => string } = {}) {
    this.path = opts.path ?? paths().devices;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /** A missing file is an empty registry; an unreadable one is logged and starts empty (the file is rewritten on the next change). */
  async load(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.path, 'utf8'); } catch { this.records = []; return; }
    try {
      const j = JSON.parse(raw) as { devices?: unknown };
      if (!Array.isArray(j.devices)) throw new Error('no devices list');
      this.records = j.devices as DeviceRecord[];
    } catch (e) {
      log(`devices file unreadable, starting empty: ${(e as Error).message}`);
      this.records = [];
    }
  }

  list(): Device[] {
    return this.records.map(r => ({ id: r.id, name: r.name, createdAt: r.createdAt, ...(r.lastSeenAt ? { lastSeenAt: r.lastSeenAt } : {}), hasKey: true }));
  }

  get(id: string): DeviceRecord | undefined { return this.records.find(r => r.id === id); }

  /** Compares every stored hash in constant time, so the lookup time does not tell how much of a token matched. */
  byToken(token: string): DeviceRecord | undefined {
    const given = Buffer.from(hash(token), 'hex');
    let found: DeviceRecord | undefined;
    for (const r of this.records) {
      const stored = Buffer.from(r.tokenHash, 'hex');
      if (stored.length === given.length && timingSafeEqual(stored, given)) found = r;
    }
    return found;
  }

  /** The token is returned here and nowhere else. */
  async create(name: string, credential: StoredCredential): Promise<{ device: DeviceRecord; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const device: DeviceRecord = { id: randomUUID(), name, tokenHash: hash(token), createdAt: this.now(), credential };
    this.records.push(device);
    await this.save();
    this.emit();
    return { device, token };
  }

  /** Records the last connection. Not announced: it would fire on every connect. */
  async touch(id: string): Promise<void> {
    const r = this.get(id); if (!r) return;
    r.lastSeenAt = this.now();
    await this.save();
  }

  async setCounter(id: string, counter: number): Promise<void> {
    const r = this.get(id); if (!r) return;
    r.credential = { ...r.credential, counter };
    await this.save();
  }

  async revoke(id: string): Promise<boolean> {
    const i = this.records.findIndex(r => r.id === id);
    if (i < 0) return false;
    this.records.splice(i, 1);
    await this.save();
    this.emit();
    return true;
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private emit(): void {
    for (const l of this.listeners) { try { l(); } catch (e) { log(`device listener failed: ${(e as Error).message}`); } }
  }

  private save(): Promise<void> {
    const run = this.saving.then(() => this.write());
    this.saving = run.catch(() => undefined);
    return run;
  }

  private async write(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify({ devices: this.records }, null, 2) + '\n', { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.path);
  }
}

/** What the daemon exposes to its local commands: the https origin and the remote entry's state, the paired devices, the pairing window. */
export interface MobileControl {
  state(): { origin: string | null; listening: boolean };
  /** Saves the origin (`null` turns mobile access off) and starts, restarts or stops the remote entry accordingly. */
  configure(origin: string | null): Promise<void>;
  devices: DeviceStore;
  pairing: Pairing;
}
