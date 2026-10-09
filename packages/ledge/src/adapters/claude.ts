import type { Adapter, KeyPlan, PanePromptMatch } from './types.js';

// A live prompt is a box whose first inner line is the question and whose next lines are numbered options.
// Quoted file contents are prefixed by the Read tool's "│" gutter at column 5, so we only accept
// box lines that start at column 0 with the box character.
const BOX_LINE = /^│\s(.*?)\s*│$/;
const OPTION = /^(?:❯\s)?(\d+)\.\s(.+)$/;
const PERMISSION_QUESTION = /^Do you want to proceed\??$/;
const TOOL_CALL = /^●\s([A-Z][A-Za-z]+\([^)]*\))/;

function boxLines(pane: string): string[] {
  return pane.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => BOX_LINE.test(l)).map(l => l.match(BOX_LINE)![1]!.trim());
}

function parseBox(pane: string): { question: string; options: string[] } | null {
  const lines = boxLines(pane);
  if (lines.length < 2) return null;
  const question = lines[0]!;
  const options: string[] = [];
  for (const l of lines.slice(1)) {
    const m = l.match(OPTION);
    if (m) options.push(m[2]!.trim());
  }
  if (options.length === 0) return null;
  return { question, options };
}

// The tool call being approved is the last one above the box, not the first in scrollback.
function lastToolCallBeforeBox(pane: string): string | null {
  const lines = pane.split('\n');
  const boxStart = lines.findIndex(l => BOX_LINE.test(l.replace(/\s+$/, '')));
  for (let i = (boxStart < 0 ? lines.length : boxStart) - 1; i >= 0; i--) {
    const m = lines[i]!.match(TOOL_CALL);
    if (m) return m[1]!;
  }
  return null;
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const box = parseBox(pane);
  if (!box) return null;
  if (PERMISSION_QUESTION.test(box.question)) {
    const call = lastToolCallBeforeBox(pane);
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
