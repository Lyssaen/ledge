import { useSyncExternalStore } from 'react';
import { isRecord, readJson, writeJson } from '../state/storage';
import type { ShellKind } from '../term/shells';
import { close, deserialize, keyOf, MAIN, type Tab, type Workspace } from './model';

/**
 * « Dispositions » (docs/ide-workspace.md, « La fenêtre » › barre d'état; Réglages › Espace de travail; validated states:
 * docs/mockups/ledge-ide-layouts-palette.html): named snapshots of the workspace — its windows, groups, tabs and links (lot 9) —,
 * of the bottom panel's terminals and of the bottom and right panels' visibility. A shell is a process: a disposition keeps its
 * type and folder, and applying it opens a new one where it is gone. Pure functions, plus their persisted form
 * (`ledge.ide.dispositions`, the one applied last in `ledge.ide.disposition`, the start choice in `ledge.ide.boot`).
 */
export interface ShellSpec { kind: ShellKind; dir: string }
export interface Disposition {
  name: string; ws: Workspace; bottom: boolean; right: boolean;
  /** The bottom panel's terminals, in column order: shells (`shell:…`) and agents' terminals (`agent:…`). */
  panel: string[];
  /** Each shell the disposition holds (a tab or the panel), by its ref: what opens it again. */
  shells: Record<string, ShellSpec>;
}
export type Boot = { kind: 'last' } | { kind: 'fixed'; name: string } | { kind: 'atelier' };
/** The disposition applied (or saved) last, and its signature then: the workspace differs from it once the user changes it. */
export interface Current { name: string; sig: string }

export const DISPOSITIONS_KEY = 'ledge.ide.dispositions';
export const CURRENT_KEY = 'ledge.ide.disposition';
export const BOOT_KEY = 'ledge.ide.boot';

/** The panels a disposition keeps (the rest of the panel layout — widths, the sidebar — is the user's, not the disposition's). */
export interface Panels { bottom: boolean; right: boolean }

const isShell = (ref: string) => ref.startsWith('shell:');
const shellRefsOf = (ws: Workspace): string[] => ws.groups.flatMap(g => g.tabs.filter(t => t.kind === 'terminal' && isShell(t.ref)).map(t => t.ref));

export function capture(name: string, ws: Workspace, panels: Panels, panel: readonly string[] = [], shellOf: (ref: string) => ShellSpec | undefined = () => undefined): Disposition {
  const shells: Record<string, ShellSpec> = {};
  for (const ref of [...shellRefsOf(ws), ...panel.filter(isShell)]) { const s = shellOf(ref); if (s) shells[ref] = { kind: s.kind, dir: s.dir }; }
  return { name, ws, bottom: panels.bottom, right: panels.right, panel: [...panel], shells };
}

/** « 3 groupes · 1 fenêtre »: every window's groups, and the detached windows (none: not said). */
export const shapeOf = (d: Disposition): { groups: number; windows: number } => ({ groups: d.ws.groups.length, windows: d.ws.windows.length - 1 });

/** What « modifiée » compares: the windows, the groups with their tabs and links, the panels' visibility. Not the focus, the tab in
 *  front, a tab's view, nor the ids the model numbers. */
export function signature(ws: Workspace, panels: Panels): string {
  const wins = ws.windows.map(win => ws.groups.filter(g => g.window === win).map(g => [g.link, g.tabs.map(keyOf)]));
  return JSON.stringify([wins, panels.bottom, panels.right]);
}

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

function mapRefs(ws: Workspace, to: (ref: string) => string): Workspace {
  return { ...ws, groups: ws.groups.map(g => ({ ...g, tabs: g.tabs.map(t => (t.kind === 'terminal' && isShell(t.ref) ? { ...t, ref: to(t.ref) } : t)) })) };
}

export interface ApplyDeps {
  /** Whether a tab's subject still exists (a session the daemon no longer lists, a machine removed: no). */
  keep(t: Tab): boolean;
  /** Whether a shell is still running under this ref. */
  live(ref: string): boolean;
  /** Opens a new shell, and gives its ref. */
  spawn(spec: ShellSpec): string;
  /** The shells open now, in their order: those the disposition does not hold go to the bottom panel (none is killed). */
  open: readonly string[];
}

/** What applying `d` gives: its workspace, its shells kept or opened again, its tabs whose subject is gone left out (`dropped`
 *  counts them), a group emptied gone, a detached window emptied not opened; the panel's terminals, then the open shells it does
 *  not hold. */
export function plan(d: Disposition, deps: ApplyDeps): { ws: Workspace; panel: string[]; dropped: number } {
  const renamed = new Map<string, string>();
  const ref = (r: string): string | null => {
    if (!isShell(r)) return r;
    if (deps.live(r)) return r;
    const known = renamed.get(r);
    if (known) return known;
    const spec = d.shells[r];
    if (!spec) return null;
    const fresh = deps.spawn(spec);
    renamed.set(r, fresh);
    return fresh;
  };
  let dropped = 0;
  let ws = d.ws;
  // A shell without its spec (it cannot open again) goes like a tab whose subject is gone.
  for (const r of shellRefsOf(ws)) if (ref(r) === null) { ws = close(ws, `terminal:${r}`); dropped += 1; }
  ws = mapRefs(ws, r => ref(r) ?? r);
  for (const g of ws.groups) for (const t of g.tabs) if (!deps.keep(t)) { ws = close(ws, keyOf(t)); dropped += 1; }
  const panel: string[] = [];
  for (const r of d.panel) {
    const to = ref(r);
    if (to === null || (!isShell(to) && !deps.keep({ kind: 'terminal', ref: to }))) { dropped += 1; continue; }
    if (!panel.includes(to)) panel.push(to);
  }
  const held = new Set([...shellRefsOf(ws), ...panel]);
  for (const r of deps.open) if (!held.has(r)) panel.push(r);
  return { ws, panel, dropped };
}

/** The workspace « L'atelier seul » starts on: the main window, one group, the atelier's tab. */
export function atelierOnly(atelier: Tab): Workspace {
  return { version: 1, windows: [MAIN], groups: [{ id: 'g1', window: MAIN, tabs: [atelier], active: 0, link: null }], focus: 'g1', next: 2 };
}

/** What the IDE opens on: the last workspace (`last`, what the store saved), a fixed disposition (gone: the last one), or the
 *  atelier alone. `panels` null: the panels stay as saved; `current` absent: the disposition shown stays as saved. A fixed
 *  disposition's shells and panel terminals open with it (App, `plan`): none survives a restart. */
export function bootWorkspace(boot: Boot, last: Workspace, list: readonly Disposition[], atelier: Tab): { ws: Workspace; panels: Panels | null; current?: string | null; disposition?: Disposition } {
  if (boot.kind === 'atelier') return { ws: atelierOnly(atelier), panels: null, current: null };
  if (boot.kind === 'fixed') {
    const d = list.find(x => x.name === boot.name);
    if (d) return { ws: d.ws, panels: { bottom: d.bottom, right: d.right }, current: d.name, disposition: d };
  }
  return { ws: last, panels: null };
}

/** « Au démarrage » as the setting shows it: a fixed disposition deleted reads as « La dernière disposition », with its name to say so. */
export function bootShown(boot: Boot, list: readonly Disposition[]): { boot: Boot; deleted: string | null } {
  if (boot.kind === 'fixed' && !list.some(x => x.name === boot.name)) return { boot: { kind: 'last' }, deleted: boot.name };
  return { boot, deleted: null };
}

const KINDS: readonly string[] = ['wsl', 'powershell', 'cmd', 'gitbash', 'ledge'];
const isShellKind = (v: unknown): v is ShellKind => typeof v === 'string' && (KINDS.includes(v) || (v.startsWith('ssh:') && v.length > 4));

function parseOne(v: unknown): Disposition | null {
  if (!isRecord(v) || typeof v.name !== 'string' || v.name.trim() === '' || typeof v.ws !== 'string') return null;
  const ws = deserialize(v.ws);
  if (!ws) return null;
  const panel = Array.isArray(v.panel) ? v.panel.filter((x): x is string => typeof x === 'string') : [];
  const shells: Record<string, ShellSpec> = {};
  if (isRecord(v.shells)) for (const [k, s] of Object.entries(v.shells)) if (isRecord(s) && isShellKind(s.kind) && typeof s.dir === 'string') shells[k] = { kind: s.kind, dir: s.dir };
  return { name: v.name, ws, bottom: v.bottom === true, right: v.right !== false, panel, shells };
}

/** The saved dispositions; one unreadable is dropped, the others kept. A name met twice keeps its first. */
export function parseDispositions(raw: unknown): Disposition[] {
  if (!Array.isArray(raw)) return [];
  const out: Disposition[] = [];
  for (const v of raw) { const d = parseOne(v); if (d && !out.some(x => x.name === d.name)) out.push(d); }
  return out;
}

/** Stored with `ws` as the model's own serialised JSON (deserialize checks it on the way back). */
const toStored = (d: Disposition) => ({ name: d.name, ws: JSON.stringify(d.ws), bottom: d.bottom, right: d.right, panel: d.panel, shells: d.shells });

export function parseBoot(raw: unknown): Boot {
  if (!isRecord(raw)) return { kind: 'last' };
  if (raw.kind === 'atelier') return { kind: 'atelier' };
  if (raw.kind === 'fixed' && typeof raw.name === 'string' && raw.name !== '') return { kind: 'fixed', name: raw.name };
  return { kind: 'last' };
}

export function parseCurrent(raw: unknown): Current | null {
  return isRecord(raw) && typeof raw.name === 'string' && raw.name !== '' && typeof raw.sig === 'string' ? { name: raw.name, sig: raw.sig } : null;
}

/* ---------- Persisted, shared ---------- */

const listeners = new Set<() => void>();
const tell = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** A stored value parsed once per raw JSON: useSyncExternalStore needs the same snapshot until it changes. */
function cached<T>(key: string, parse: (raw: unknown) => T): () => T {
  let memo: { raw: string; value: T } | null = null;
  return () => {
    const raw = readJson(key);
    const k = JSON.stringify(raw ?? null);
    if (memo?.raw !== k) memo = { raw: k, value: parse(raw) };
    return memo.value;
  };
}

export const loadDispositions = cached(DISPOSITIONS_KEY, parseDispositions);
export function saveDispositions(list: readonly Disposition[]): void { writeJson(DISPOSITIONS_KEY, list.map(toStored)); tell(); }

export const loadCurrent = cached(CURRENT_KEY, parseCurrent);
export function saveCurrent(c: Current | null): void { writeJson(CURRENT_KEY, c); tell(); }

export const loadBoot = cached(BOOT_KEY, parseBoot);
export function saveBoot(b: Boot): void { writeJson(BOOT_KEY, b); tell(); }

export const useDispositions = (): Disposition[] => useSyncExternalStore(subscribe, loadDispositions);
export const useCurrentDisposition = (): Current | null => useSyncExternalStore(subscribe, loadCurrent);
export const useBoot = (): Boot => useSyncExternalStore(subscribe, loadBoot);
