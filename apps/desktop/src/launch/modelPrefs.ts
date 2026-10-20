import { readJson, writeJson, isRecord } from '../state/storage';
import { NO_PICK, type ModelPick, type Tool } from './model';

/** The last model and effort launched, per project and agent (#58): a desktop preference, never sent to the daemon. */
const KEY = 'desktop.launch.models';
const keyOf = (project: string | null, tool: Tool) => `${project ?? ''}|${tool}`;
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

function all(): Record<string, unknown> { const v = readJson(KEY); return isRecord(v) ? v : {}; }

/** The pick remembered for this project and agent, and whether there is one. */
export function loadPick(project: string | null, tool: Tool): ModelPick & { remembered: boolean } {
  const v = all()[keyOf(project, tool)];
  if (!isRecord(v)) return { ...NO_PICK, remembered: false };
  return { model: str(v.model), effort: str(v.effort), remembered: true };
}
/** The agent's own default forgets the entry: the next form starts from the default too. */
export function savePick(project: string | null, tool: Tool, pick: ModelPick): void {
  const next = { ...all() };
  if (pick.model === null && pick.effort === null) delete next[keyOf(project, tool)];
  else next[keyOf(project, tool)] = { ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}) };
  writeJson(KEY, next);
}
