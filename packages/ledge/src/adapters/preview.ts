import type { Adapter } from './types.js';

export const PREVIEW_LINES = 30;
/** What the preview captures: the whole visible screen plus some scrollback, independent of prompt detection. */
export const PREVIEW_CAPTURE_LINES = 200;

const isBlank = (l: string) => l.trim() === '';

/** Blank runs collapsed to one blank line, leading and trailing blanks dropped, trailing whitespace trimmed. */
export function tidyLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const l = raw.replace(/\s+$/, '');
    if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(l);
  }
  while (out.length > 0 && isBlank(out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * The terminal preview: the adapter's view of the pane (its input chrome removed) when it has one,
 * else the raw lines; then blank runs collapsed and the last PREVIEW_LINES kept.
 */
export function buildPreview(pane: string, adapter?: Pick<Adapter, 'previewLines'> | null): string[] {
  const lines = adapter?.previewLines ? adapter.previewLines(pane) : pane.split('\n');
  const last = tidyLines(lines).slice(-PREVIEW_LINES);
  while (last.length > 0 && last[0] === '') last.shift(); // the cut can land on a blank line
  return last;
}
