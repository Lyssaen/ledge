import { isRecord, readJson, writeJson } from '../../state/storage';

/** `byBranch`: the tree goes project › branch › agent (pressed, the default); released, each project lists its agents, a branch tag on their rows. */
export interface SidebarPrefs { hideDone: boolean; dense: boolean; byBranch: boolean }
export const SIDEBAR_KEY = 'desktop.sidebar';

export function loadSidebarPrefs(): SidebarPrefs {
  const raw = readJson(SIDEBAR_KEY);
  const r = isRecord(raw) ? raw : {};
  return {
    hideDone: typeof r.hideDone === 'boolean' ? r.hideDone : true,
    dense: typeof r.dense === 'boolean' ? r.dense : false,
    byBranch: typeof r.byBranch === 'boolean' ? r.byBranch : true,
  };
}

export function saveSidebarPrefs(p: SidebarPrefs): void {
  writeJson(SIDEBAR_KEY, p);
}
