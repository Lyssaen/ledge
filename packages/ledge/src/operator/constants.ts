/** Quiet time after the first grouped event before a wake fires. */
export const DEBOUNCE_MS = 60_000;
/** Shortest gap between two wakes, even for immediate events. */
export const MIN_WAKE_GAP_MS = 60_000;
/** Hourly cap on wakes. */
export const MAX_WAKES_PER_HOUR = 30;
/** A task without news for this long is reported stale. */
export const STALE_TASK_MS = 30 * 60_000;
/** Days the journal keeps events before pruning them. */
export const RETENTION_DAYS = 30;
/** Most lines the point's lead text may hold. */
export const LEAD_LINES_MAX = 12;
/** Most items a point may hold. */
export const POINT_ITEMS_MAX = 40;
