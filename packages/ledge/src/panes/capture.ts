import type { IBuffer } from '@xterm/headless';

/** `tmux capture-pane -p -J -S -<lines>` on an xterm buffer: soft-wrapped rows joined to the row above, trailing blanks
 *  trimmed, the last `lines` lines of history and screen. `join: false` keeps every row apart: behind ConPTY a row is
 *  flagged wrapped whenever the one above filled the width, newline or not, and the agents wrap their own text. */
export function captureLines(buffer: IBuffer, lines: number, opts: { join?: boolean } = {}): string {
  const join = opts.join ?? true;
  const out: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    if (join && line.isWrapped && out.length) out[out.length - 1] += text; else out.push(text);
  }
  return out.join('\n').replace(/\s+$/, '').split('\n').slice(-lines).join('\n');
}
