import { isRecord, readJson, writeJson } from '../state/storage';
import type { GroupBy } from './model';

/** The List's preferences that survive a restart: how it groups and how dense its rows are. The text filter, the state
 *  chip, the collapsed groups and the unfolded subagents live in the List only. */
export type Density = 'comfy' | 'tight';
export interface ListPrefs { group: GroupBy; density: Density }
export const LIST_KEY = 'desktop.list';

export function loadListPrefs(): ListPrefs {
  const raw = readJson(LIST_KEY);
  const r = isRecord(raw) ? raw : {};
  return {
    group: r.group === 'machine' || r.group === 'state' ? r.group : 'project',
    density: r.density === 'tight' ? 'tight' : 'comfy'
  };
}
export function saveListPrefs(p: ListPrefs): void { writeJson(LIST_KEY, p); }
