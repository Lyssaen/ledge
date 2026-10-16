import { isRecord, readJson, writeJson } from '../state/storage';
import type { View } from './state';

/** The overview preferences that survive a restart: which view, helpers shown, agents paused. */
export interface Overview { view: View; helpers: boolean; paused: boolean }
export const OVERVIEW_KEY = 'desktop.overview';

export function loadOverview(): Overview {
  const raw = readJson(OVERVIEW_KEY);
  const r = isRecord(raw) ? raw : {};
  return {
    view: r.view === 'list' ? 'list' : 'atelier',
    helpers: typeof r.helpers === 'boolean' ? r.helpers : true,
    paused: typeof r.paused === 'boolean' ? r.paused : false
  };
}
export function saveOverview(o: Overview): void { writeJson(OVERVIEW_KEY, o); }
