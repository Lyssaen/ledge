import type { Adapter, KeyPlan, PanePromptMatch } from './types.js';

// A live prompt is a box whose first inner line is the question and whose next lines are numbered options.
// Quoted file contents are prefixed by the Read tool's "│" gutter at column 5, so we only accept
// box lines that start at column 0 with the box character.
const BOX_LINE = /^│\s(.*?)\s*│$/;
const OPTION = /^(?:❯\s)?(\d+)\.\s(.+)$/;
const PERMISSION_QUESTION = /^Do you want to proceed\??$/;
const TOOL_CALL = /^●\s([A-Z][A-Za-z]+\([^)]*\))/;

const isBoxLine = (l: string) => BOX_LINE.test(l.replace(/\s+$/, ''));

/** The last contiguous run of box lines: a stale box higher in the capture is never merged in. */
function lastBox(pane: string): { start: number; lines: string[] } | null {
  const all = pane.split('\n');
  let end = all.length - 1;
  while (end >= 0 && !isBoxLine(all[end]!)) end--;
  if (end < 0) return null;
  let start = end;
  while (start > 0 && isBoxLine(all[start - 1]!)) start--;
  const lines = all.slice(start, end + 1).map(l => l.replace(/\s+$/, '').match(BOX_LINE)![1]!.trim());
  return { start, lines };
}

function parseBox(pane: string): { start: number; question: string; options: string[] } | null {
  const box = lastBox(pane);
  if (!box || box.lines.length < 2) return null;
  const question = box.lines[0]!;
  const options: string[] = [];
  for (const l of box.lines.slice(1)) {
    const m = l.match(OPTION);
    if (m) options.push(m[2]!.trim());
  }
  if (options.length === 0) return null;
  return { start: box.start, question, options };
}

// The tool call being approved is the last one above the box, not the first in scrollback.
function lastToolCallBefore(pane: string, boxStart: number): string | null {
  const lines = pane.split('\n');
  for (let i = boxStart - 1; i >= 0; i--) {
    const m = lines[i]!.match(TOOL_CALL);
    if (m) return m[1]!;
  }
  return null;
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const box = parseBox(pane);
  if (!box) return null;
  if (PERMISSION_QUESTION.test(box.question)) {
    const call = lastToolCallBefore(pane, box.start);
    return { kind: 'permission', text: call ?? box.question, options: box.options };
  }
  return { kind: 'question', text: box.question, options: box.options };
}

function numberThenEnter(n: string): KeyPlan { return [{ text: n }, { keys: ['Enter'] }]; }

export const claudeAdapter: Adapter = {
  tool: 'claude',
  detectPrompt,
  promptStillVisible: pane => parseBox(pane) !== null,
  keysFor(decision) {
    return decision === 'accept' ? numberThenEnter('1') : [{ keys: ['Escape'] }];
  },
  replyPlan(text) {
    // Tmux.sendText rejects newlines: flatten here, Enter is a separate key step.
    const flat = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    return [{ text: flat }, { keys: ['Enter'] }];
  },
  interruptKeys: () => ['Escape']
};
