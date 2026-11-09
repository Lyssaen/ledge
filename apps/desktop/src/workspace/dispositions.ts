import { useSyncExternalStore } from 'react';
import { isRecord, readJson, writeJson } from '../state/storage';
import { deserialize, MAIN, type Tab, type Workspace } from './model';

/**
 * « Dispositions » (docs/ide-workspace.md, « La fenêtre » › barre d'état; Réglages › Espace de travail): named snapshots of the
 * workspace — its windows, groups, tabs and links (lot 9) — and of the bottom and right panels. Pure functions, plus their
 * persisted form (`ledge.ide.dispositions`, the one applied last in `ledge.ide.disposition`, the start choice in `ledge.ide.boot`).
 */
export interface Disposition { name: string; ws: Workspace; bottom: boolean; right: boolean }
export type Boot = { kind: 'last' } | { kind: 'fixed'; name: string } | { kind: 'atelier' };

export const DISPOSITIONS_KEY = 'ledge.ide.dispositions';
export const CURRENT_KEY = 'ledge.ide.disposition';
export const BOOT_KEY = 'ledge.ide.boot';

/** The panels a disposition keeps (the rest of the panel layout — widths, the sidebar — is the user's, not the disposition's). */
export interface Panels { bottom: boolean; right: boolean }

export const capture = (name: string, ws: Workspace, panels: Panels): Disposition => ({ name, ws, bottom: panels.bottom, right: panels.right });

/** The number of groups a disposition shows in its menu (« 3 groupes »): every window's. */
export const groupCount = (d: Disposition): number => d.ws.groups.length;

/** Saves `d`; one already under its name is replaced where it was (the menu keeps its order). */
export function upsert(list: readonly Disposition[], d: Disposition): Disposition[] {
  const i = list.findIndex(x => x.name === d.name);
  return i < 0 ? [...list, d] : list.map((x, j) => (j === i ? d : x));
}

export const remove = (list: readonly Disposition[], name: string): Disposition[] => list.filter(x => x.name !== name);

/** A name the user typed: trimmed; empty gives null (nothing is saved). */
export function cleanName(raw: string): string | null {
  const n = raw.trim();
  return n === '' ? null : n;
}

/** The workspace « L'atelier seul » starts on: the main window, one group, the atelier's tab. */
export function atelierOnly(atelier: Tab): Workspace {
  return { version: 1, windows: [MAIN], groups: [{ id: 'g1', window: MAIN, tabs: [atelier], active: 0, link: null }], focus: 'g1', next: 2 };
}

/** What the IDE opens on: the last workspace (`last`, what the store saved), a fixed disposition (gone: the last one), or the
 *  atelier alone. `panels` null: the panels stay as saved; `current` absent: the name shown stays as saved. */
export function bootWorkspace(boot: Boot, last: Workspace, list: readonly Disposition[], atelier: Tab): { ws: Workspace; panels: Panels | null; current?: string | null } {
  if (boot.kind === 'atelier') return { ws: atelierOnly(atelier), panels: null, current: null };
  if (boot.kind === 'fixed') {
    const d = list.find(x => x.name === boot.name);
    if (d) return { ws: d.ws, panels: { bottom: d.bottom, right: d.right }, current: d.name };
  }
  return { ws: last, panels: null };
}

function parseOne(v: unknown): Disposition | null {
  if (!isRecord(v) || typeof v.name !== 'string' || v.name.trim() === '' || typeof v.ws !== 'string') return null;
  const ws = deserialize(v.ws);
  if (!ws) return null;
  return { name: v.name, ws, bottom: v.bottom === true, right: v.right !== false };
}

/** The saved dispositions; one unreadable is dropped, the others kept. A name met twice keeps its first. */
export function parseDispositions(raw: unknown): Disposition[] {
  if (!Array.isArray(raw)) return [];
  const out: Disposition[] = [];
  for (const v of raw) { const d = parseOne(v); if (d && !out.some(x => x.name === d.name)) out.push(d); }
  return out;
}

/** Stored as `{ name, ws, bottom, right }`, `ws` being the model's own serialised JSON (deserialize checks it on the way back). */
const toStored = (d: Disposition) => ({ name: d.name, ws: JSON.stringify(d.ws), bottom: d.bottom, right: d.right });

export function parseBoot(raw: unknown): Boot {
  if (!isRecord(raw)) return { kind: 'last' };
  if (raw.kind === 'atelier') return { kind: 'atelier' };
  if (raw.kind === 'fixed' && typeof raw.name === 'string' && raw.name !== '') return { kind: 'fixed', name: raw.name };
  return { kind: 'last' };
}

/* ---------- Persisted, shared ---------- */

const listeners = new Set<() => void>();
const tell = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// useSyncExternalStore needs a stable snapshot: the parsed list is kept until its raw JSON changes.
let cache: { raw: string; list: Disposition[] } | null = null;
export function loadDispositions(): Disposition[] {
  const raw = readJson(DISPOSITIONS_KEY);
  const key = JSON.stringify(raw ?? null);
  if (cache?.raw !== key) cache = { raw: key, list: parseDispositions(raw) };
  return cache.list;
}
export function saveDispositions(list: readonly Disposition[]): void { writeJson(DISPOSITIONS_KEY, list.map(toStored)); tell(); }

export const loadCurrent = (): string | null => { const v = readJson(CURRENT_KEY); return typeof v === 'string' ? v : null; };
export function saveCurrent(name: string | null): void { writeJson(CURRENT_KEY, name); tell(); }

let bootCache: { raw: string; boot: Boot } | null = null;
export function loadBoot(): Boot {
  const raw = readJson(BOOT_KEY);
  const key = JSON.stringify(raw ?? null);
  if (bootCache?.raw !== key) bootCache = { raw: key, boot: parseBoot(raw) };
  return bootCache.boot;
}
export function saveBoot(b: Boot): void { writeJson(BOOT_KEY, b); tell(); }

export const useDispositions = (): Disposition[] => useSyncExternalStore(subscribe, loadDispositions);
export const useCurrentDisposition = (): string | null => useSyncExternalStore(subscribe, loadCurrent);
export const useBoot = (): Boot => useSyncExternalStore(subscribe, loadBoot);
