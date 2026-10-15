import type { MachineState } from '@ledge/fleet';
import type { Recent, Tool } from '@ledge/protocol';
import { isRecord, readJson, writeJson } from '../state/storage';

export const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor'];
export const isTool = (v: unknown): v is Tool => typeof v === 'string' && (TOOLS as readonly string[]).includes(v);
/** The default harness (spec §7). Settings writes it (lot 7); the form only reads it. */
export const TOOL_KEY = 'desktop.tool';
/** The last form that did not launch (spec §7). */
export const LAUNCH_KEY = 'desktop.launch';
/** The mockup's limits (launch.js: maxlength). */
export const CWD_MAX = 500;
export const PROMPT_MAX = 10_000;
/** The project select's « Autre dossier… » option. */
export const CUSTOM = 'custom';

export function loadTool(): Tool {
  const v = readJson(TOOL_KEY);
  return isTool(v) ? v : 'claude';
}

/** What was typed and not launched. `cwd` belongs to `machine`; null until typed or picked there (the form then shows the latest project). */
export interface LaunchDraft { machine: string | null; cwd: string | null; tool: Tool; prompt: string }
export const emptyDraft = (): LaunchDraft => ({ machine: null, cwd: null, tool: loadTool(), prompt: '' });

/** Field by field, each with its fallback (spec §7): a bad field never costs the others. */
export function loadLaunch(): LaunchDraft {
  const d = emptyDraft();
  const raw = readJson(LAUNCH_KEY);
  if (!isRecord(raw)) return d;
  const machine = typeof raw.machine === 'string' && raw.machine ? raw.machine : null;
  return {
    machine,
    cwd: machine && typeof raw.cwd === 'string' && raw.cwd.length <= CWD_MAX ? raw.cwd : null,
    tool: isTool(raw.tool) ? raw.tool : d.tool,
    prompt: typeof raw.prompt === 'string' && raw.prompt.length <= PROMPT_MAX ? raw.prompt : ''
  };
}
export function saveLaunch(d: LaunchDraft): void { writeJson(LAUNCH_KEY, d); }
/** Only a launch that succeeded forgets the form. */
export function clearLaunch(): void {
  try { localStorage.removeItem(LAUNCH_KEY); } catch { /* storage unavailable: nothing to forget */ }
}

/** Spec §9.2: absolute, or starting with `~`; the daemon does the final check (`resolveFolder`). */
export function isPathAccepted(cwd: string): boolean {
  const p = cwd.trim();
  return p.length > 0 && p.length <= CWD_MAX && (p.startsWith('/') || p.startsWith('~'));
}

/** The machine's past folders, newest first, one per folder (the project select). */
export function recentsOf(m: MachineState | undefined): Recent[] {
  const seen = new Set<string>();
  return [...(m?.recents ?? [])].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).filter(r => !seen.has(r.cwd) && !!seen.add(r.cwd));
}

/** What the form shows: the remembered machine while it is ready, else the first ready one; its folder only on its own machine. */
export interface LaunchForm { machine: string | null; cwd: string; tool: Tool; prompt: string }
export function resolveForm(d: LaunchDraft, machines: MachineState[]): LaunchForm {
  const own = machines.find(m => m.id === d.machine && m.ready);
  const target = own ?? machines.find(m => m.ready);
  const cwd = own && d.cwd !== null ? d.cwd : (recentsOf(target)[0]?.cwd ?? '');
  return { machine: target?.id ?? null, cwd, tool: d.tool, prompt: d.prompt };
}
/** An edit keeps what the person sees (a fallback machine, a suggested project), then applies the change. */
export function editDraft(form: LaunchForm, patch: Partial<LaunchDraft>): LaunchDraft {
  return { machine: form.machine, cwd: form.cwd, tool: form.tool, prompt: form.prompt, ...patch };
}

export interface LaunchRequest { machine: string; tool: Tool; cwd: string; prompt: string }
export type LaunchProblem = 'machine' | 'cwd' | 'prompt';
/** The mockup's checks, in its order: a connected machine, an accepted folder, a non-empty instruction. */
export function checkForm(form: LaunchForm, machines: MachineState[]): { ok: true; request: LaunchRequest } | { ok: false; problem: LaunchProblem } {
  if (!form.machine || !machines.some(m => m.id === form.machine && m.ready)) return { ok: false, problem: 'machine' };
  if (!isPathAccepted(form.cwd)) return { ok: false, problem: 'cwd' };
  const prompt = form.prompt.trim();
  if (!prompt || form.prompt.length > PROMPT_MAX) return { ok: false, problem: 'prompt' };
  return { ok: true, request: { machine: form.machine, tool: form.tool, cwd: form.cwd.trim(), prompt } };
}

/** `sendTo` only reaches a ready machine; one that is open but has not sent its snapshot is still connecting. */
export type Availability = 'ready' | 'connecting' | 'unreachable';
export function availability(m: MachineState): Availability {
  return m.ready ? 'ready' : m.status === 'unreachable' ? 'unreachable' : 'connecting';
}
