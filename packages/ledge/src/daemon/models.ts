import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ModelChoice, Tool } from '@ledge/protocol';
import { EffortSchema, ModelIdSchema } from '@ledge/protocol';
import { log } from '../log.js';

/**
 * The models each agent offers on this machine (#58), for the launch form. Codex and Cursor Agent print their catalog
 * (`codex debug models`, `cursor-agent models`), which follows the agent's version and the account; Claude Code has none,
 * so its aliases are written here: each always names the latest model of its family.
 */

/** Runs `file args` without a shell; `code` null when the binary could not start. Never throws. */
export type ModelsRun = (file: string, args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const CLAUDE_MODELS: ReadonlyArray<{ id: string; label: string; description: string }> = [
  { id: 'fable', label: 'Fable', description: 'The most capable' },
  { id: 'opus', label: 'Opus', description: 'Very capable, slower' },
  { id: 'sonnet', label: 'Sonnet', description: 'Balanced, everyday use' },
  { id: 'haiku', label: 'Haiku', description: 'Fast and economical' }
];

const TIMEOUT_MS = 15_000;
export const MODELS_TTL_MS = 10 * 60_000;

const isModelId = (s: unknown): s is string => typeof s === 'string' && ModelIdSchema.safeParse(s).success;
const isEffort = (s: unknown): s is string => typeof s === 'string' && EffortSchema.safeParse(s).success;

/** Claude Code's aliases; `settingsModel` (its settings.json `model`) is the default when it names one, else is added. */
export function claudeModels(settingsModel?: string): ModelChoice[] {
  const efforts = [...CLAUDE_EFFORTS];
  const models: ModelChoice[] = CLAUDE_MODELS.map(m => ({ ...m, efforts, ...(m.id === settingsModel ? { isDefault: true } : {}) }));
  if (isModelId(settingsModel) && !models.some(m => m.isDefault)) models.push({ id: settingsModel, label: settingsModel, efforts, isDefault: true });
  return models;
}

/** `codex debug models`: the listed models by priority, with their efforts; `config` (config.toml's `model` and
 *  `model_reasoning_effort`) marks the default model and sets the effort every model starts from. */
export function parseCodexModels(json: string, config: { model?: string; effort?: string } = {}): ModelChoice[] {
  const raw = JSON.parse(json) as unknown;
  const list = (Array.isArray(raw) ? raw : (raw as { models?: unknown }).models) as unknown;
  if (!Array.isArray(list)) throw new Error('no model list');
  return list
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && isModelId((m as Record<string, unknown>).slug) && (m as Record<string, unknown>).visibility !== 'hide')
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
    .map(m => {
      const efforts = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels.map(l => (l as { effort?: unknown })?.effort).filter(isEffort) : [];
      const defaultEffort = isEffort(config.effort) && efforts.includes(config.effort) ? config.effort : isEffort(m.default_reasoning_level) ? m.default_reasoning_level : undefined;
      const id = m.slug as string;
      return {
        id, label: typeof m.display_name === 'string' ? m.display_name : id,
        ...(typeof m.description === 'string' ? { description: m.description } : {}),
        ...(efforts.length ? { efforts } : {}), ...(defaultEffort ? { defaultEffort } : {}),
        ...(id === config.model ? { isDefault: true } : {})
      };
    });
}

/** `cursor-agent models`: one `id - Label` row each, `(default)` or `(current)` after the label of the one it picks. */
export function parseCursorModels(text: string): ModelChoice[] {
  const models: ModelChoice[] = [];
  // eslint-disable-next-line no-control-regex
  for (const line of text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[​-‍﻿]/g, '').split('\n')) {
    const m = /^\s*(\S+) - (.+?)\s*$/.exec(line); if (!m || !isModelId(m[1])) continue;
    const mark = /\s*\((default|current)\)$/.exec(m[2]!);
    models.push({ id: m[1]!, label: mark ? m[2]!.slice(0, mark.index) : m[2]!, ...(mark ? { isDefault: true } : {}) });
  }
  return models;
}

/** config.toml's top-level `model` and `model_reasoning_effort`, before its first table. */
export function codexConfig(toml: string): { model?: string; effort?: string } {
  const top = toml.split(/^\s*\[/m)[0] ?? '';
  const get = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm').exec(top)?.[1];
  const model = get('model'), effort = get('model_reasoning_effort');
  return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}

const execRun = (env: () => Promise<NodeJS.ProcessEnv>): ModelsRun => async (file, args) => {
  const e = { ...(await env()), NO_COLOR: '1', CLICOLOR: '0' };
  return new Promise(res => {
    execFile(file, args, { env: e, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = !err ? 0 : (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : typeof err.code === 'number' ? err.code : 1;
      res({ code, stdout: String(stdout), stderr: String(stderr) || (err && code === null ? err.message : '') });
    });
  });
};

export interface ModelsDeps {
  run?: ModelsRun; env?: () => Promise<NodeJS.ProcessEnv>;
  /** Reads a config file, '' when it is missing. */ readText?: (path: string) => Promise<string>;
  now?: () => number; ttlMs?: number;
}
export interface Models { list(tool: Tool): Promise<{ models: ModelChoice[]; error?: string }> }

/** A catalog is asked once per TTL (and once at a time); a failure is never kept, so the next form asks again. */
export function createModels(deps: ModelsDeps = {}): Models {
  const env = deps.env ?? (async () => process.env);
  const run = deps.run ?? execRun(env);
  const readText = deps.readText ?? (p => readFile(p, 'utf8').catch(() => ''));
  const now = deps.now ?? Date.now, ttl = deps.ttlMs ?? MODELS_TTL_MS;
  const cache = new Map<Tool, { at: number; models: ModelChoice[] }>();
  const flying = new Map<Tool, Promise<{ models: ModelChoice[]; error?: string }>>();

  async function ask(tool: Tool): Promise<ModelChoice[]> {
    const e = await env(); const home = e.HOME ?? homedir();
    if (tool === 'claude') {
      const settings = await readText(join(e.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'settings.json'));
      let model: unknown; try { model = settings ? (JSON.parse(settings) as { model?: unknown }).model : undefined; } catch { /* not JSON: no default */ }
      return claudeModels(typeof model === 'string' ? model : undefined);
    }
    const r = tool === 'codex' ? await run('codex', ['debug', 'models']) : await run('cursor-agent', ['models']);
    if (r.code === null) throw new Error('not installed');
    if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').pop() || `exit ${r.code}`);
    if (tool === 'cursor') return parseCursorModels(r.stdout);
    return parseCodexModels(r.stdout, codexConfig(await readText(join(e.CODEX_HOME ?? join(home, '.codex'), 'config.toml'))));
  }

  return {
    list(tool) {
      const hit = cache.get(tool);
      if (hit && now() - hit.at < ttl) return Promise.resolve({ models: hit.models });
      const inFlight = flying.get(tool); if (inFlight) return inFlight;
      const p = ask(tool)
        .then(models => { cache.set(tool, { at: now(), models }); return { models }; })
        .catch((e: Error) => { log(`models.list ${tool} failed: ${e.message}`); return { models: [], error: e.message.slice(0, 200) }; })
        .finally(() => flying.delete(tool));
      flying.set(tool, p);
      return p;
    }
  };
}
