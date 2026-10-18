import { isRecord, readJson, writeJson } from '../../state/storage';

export interface SidebarPrefs { hideDone: boolean; dense: boolean }
export const SIDEBAR_KEY = 'desktop.sidebar';

export function loadSidebarPrefs(): SidebarPrefs {
  const raw = readJson(SIDEBAR_KEY);
  const r = isRecord(raw) ? raw : {};
  return {
    hideDone: typeof r.hideDone === 'boolean' ? r.hideDone : true,
    dense: typeof r.dense === 'boolean' ? r.dense : false,
  };
}

export function saveSidebarPrefs(p: SidebarPrefs): void {
  writeJson(SIDEBAR_KEY, p);
}
