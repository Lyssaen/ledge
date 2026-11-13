import { DatabaseSync } from 'node:sqlite';
import type { OperatorEventKind } from '@ledge/protocol';
import { RETENTION_DAYS } from './constants.js';

/** A front that reads the journal; same values as `ChatThreadId`. */
export type DeviceId = 'desktop' | `device:${string}`;

export interface JournalEvent {
  id: number; at: string; machine: string; kind: OperatorEventKind; subjectKind: string; subjectId: string; subjectName: string;
  urgency: 'immediate' | 'grouped' | 'none'; payload: Record<string, unknown>; settledAt: string | null;
}

export interface WakeRow {
  id: number; startedAt: string; endedAt: string | null; firstEvent: number; lastEvent: number;
  outcome: 'posted' | 'empty' | 'failed' | 'cancelled' | null; qids: string[];
}

export interface Journal {
  record(e: Omit<JournalEvent, 'id' | 'settledAt'>): JournalEvent;
  /** Marks the open events of a subject settled; `payload` is merged into theirs. */
  settle(subjectKind: string, subjectId: string, at: string, payload?: Record<string, unknown>): JournalEvent[];
  since(afterId: number, limit?: number): JournalEvent[];
  /** Unsettled events whose urgency is not `none`. */
  open(): JournalEvent[];
  /** The id of the newest event, 0 when none. */
  lastId(): number;
  cursor(device: DeviceId): number;
  /** A cursor never moves back. */
  setCursor(device: DeviceId, id: number, at: string): void;
  lastWake(): WakeRow | undefined;
  startWake(first: number, last: number, at: string): WakeRow;
  endWake(id: number, outcome: NonNullable<WakeRow['outcome']>, qids: string[], at: string): void;
  /** Marks the wakes left unfinished `failed` and returns them. */
  recover(at: string): WakeRow[];
  wakesSince(at: string): number;
  /** Drops the events older than `RETENTION_DAYS` and returns how many. */
  prune(now: string): number;
  close(): void;
}

const SCHEMA_VERSION = 1;

interface EventRow {
  id: number; at: string; machine: string; kind: string; subject_kind: string; subject_id: string; subject_name: string;
  urgency: string; payload: string; settled_at: string | null;
}
interface WakeDbRow {
  id: number; started_at: string; ended_at: string | null; first_event: number; last_event: number; outcome: string | null; qid: string | null;
}

function toEvent(r: EventRow): JournalEvent {
  return {
    id: r.id, at: r.at, machine: r.machine, kind: r.kind as OperatorEventKind, subjectKind: r.subject_kind, subjectId: r.subject_id,
    subjectName: r.subject_name, urgency: r.urgency as JournalEvent['urgency'], payload: JSON.parse(r.payload) as Record<string, unknown>,
    settledAt: r.settled_at
  };
}

function toWake(r: WakeDbRow): WakeRow {
  return {
    id: r.id, startedAt: r.started_at, endedAt: r.ended_at, firstEvent: r.first_event, lastEvent: r.last_event,
    outcome: r.outcome as WakeRow['outcome'], qids: r.qid ? (JSON.parse(r.qid) as string[]) : []
  };
}

export function openJournal(path: string | ':memory:'): Journal {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL');
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version < SCHEMA_VERSION) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, at TEXT NOT NULL, machine TEXT NOT NULL, kind TEXT NOT NULL, subject_kind TEXT NOT NULL,
        subject_id TEXT NOT NULL, subject_name TEXT NOT NULL, urgency TEXT NOT NULL, payload TEXT NOT NULL, settled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS events_subject ON events(subject_kind, subject_id);
      CREATE TABLE IF NOT EXISTS reads (device TEXT PRIMARY KEY, last_event_id INTEGER NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wakes (
        id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT, first_event INTEGER NOT NULL, last_event INTEGER NOT NULL,
        outcome TEXT, qid TEXT
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  const insertEvent = db.prepare(
    'INSERT INTO events (at, machine, kind, subject_kind, subject_id, subject_name, urgency, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const openOfSubject = db.prepare('SELECT * FROM events WHERE subject_kind = ? AND subject_id = ? AND settled_at IS NULL ORDER BY id');
  const settleOne = db.prepare('UPDATE events SET settled_at = ?, payload = ? WHERE id = ?');
  const newest = db.prepare('SELECT MAX(id) AS id FROM events');
  const eventsSince = db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?');
  const openEvents = db.prepare("SELECT * FROM events WHERE settled_at IS NULL AND urgency != 'none' ORDER BY id");
  const getCursor = db.prepare('SELECT last_event_id FROM reads WHERE device = ?');
  const putCursor = db.prepare(`INSERT INTO reads (device, last_event_id, at) VALUES (?, ?, ?)
    ON CONFLICT(device) DO UPDATE SET last_event_id = excluded.last_event_id, at = excluded.at WHERE excluded.last_event_id > last_event_id`);
  const latestWake = db.prepare('SELECT * FROM wakes ORDER BY id DESC LIMIT 1');
  const insertWake = db.prepare('INSERT INTO wakes (started_at, first_event, last_event) VALUES (?, ?, ?)');
  const finishWake = db.prepare('UPDATE wakes SET ended_at = ?, outcome = ?, qid = ? WHERE id = ?');
  const unfinished = db.prepare('SELECT * FROM wakes WHERE ended_at IS NULL ORDER BY id');
  const countWakes = db.prepare('SELECT COUNT(*) AS n FROM wakes WHERE started_at >= ?');
  const deleteOld = db.prepare('DELETE FROM events WHERE at < ?');

  return {
    record(e) {
      const r = insertEvent.run(e.at, e.machine, e.kind, e.subjectKind, e.subjectId, e.subjectName, e.urgency, JSON.stringify(e.payload));
      return { ...e, id: Number(r.lastInsertRowid), settledAt: null };
    },
    settle(subjectKind, subjectId, at, payload) {
      const rows = (openOfSubject.all(subjectKind, subjectId) as unknown as EventRow[]).map(toEvent);
      return rows.map((e) => {
        const merged = payload ? { ...e.payload, ...payload } : e.payload;
        settleOne.run(at, JSON.stringify(merged), e.id);
        return { ...e, payload: merged, settledAt: at };
      });
    },
    since: (afterId, limit = 1000) => (eventsSince.all(afterId, limit) as unknown as EventRow[]).map(toEvent),
    open: () => (openEvents.all() as unknown as EventRow[]).map(toEvent),
    lastId: () => (newest.get() as { id: number | null }).id ?? 0,
    cursor: (device) => (getCursor.get(device) as { last_event_id: number } | undefined)?.last_event_id ?? 0,
    setCursor(device, id, at) { putCursor.run(device, id, at); },
    lastWake() {
      const r = latestWake.get() as unknown as WakeDbRow | undefined;
      return r ? toWake(r) : undefined;
    },
    startWake(first, last, at) {
      const r = insertWake.run(at, first, last);
      return { id: Number(r.lastInsertRowid), startedAt: at, endedAt: null, firstEvent: first, lastEvent: last, outcome: null, qids: [] };
    },
    endWake(id, outcome, qids, at) { finishWake.run(at, outcome, JSON.stringify(qids), id); },
    recover(at) {
      const rows = (unfinished.all() as unknown as WakeDbRow[]).map(toWake);
      return rows.map((w) => {
        finishWake.run(at, 'failed', JSON.stringify(w.qids), w.id);
        return { ...w, endedAt: at, outcome: 'failed' as const };
      });
    },
    wakesSince: (at) => (countWakes.get(at) as { n: number }).n,
    prune(now) {
      const cutoff = new Date(Date.parse(now) - RETENTION_DAYS * 86_400_000).toISOString();
      return Number(deleteOld.run(cutoff).changes);
    },
    close() { db.close(); }
  };
}
