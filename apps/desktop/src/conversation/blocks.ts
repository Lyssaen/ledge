import type { ThreadItem, ToolItem } from '@ledge/protocol';
import { turns } from '@ledge/ui/thread/turns';
import { target } from '@ledge/ui/thread/tools';

/** What the thread shows (mockup conversation.js `message`): the user's prompts, the agent's words, each run of tool calls
 *  folded into one « N actions » block, decided permissions and helpers as notices. */
export type Block =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; text: string }
  | { kind: 'actions'; id: string; lines: string[] }
  | { kind: 'permission'; id: string; tool: string; accepted: boolean }
  | { kind: 'helper'; id: string; task: string; done: boolean };

/** One line per call: the tool and its short target, marked when it failed. */
export function actionLine(i: ToolItem): string {
  const what = target(i);
  return `${i.tool}${what ? ` · ${what}` : ''}${i.status === 'failed' ? ' · ✕' : ''}`;
}

/** The main thread by turn (island `turns`: helper items left out, the reply's echo dropped), in blocks. A permission still
 *  undecided is the pending request, rendered apart. */
export function threadBlocks(items: readonly ThreadItem[]): Block[] {
  const out: Block[] = [];
  for (const turn of turns([...items])) {
    let run: ToolItem[] = [];
    const flush = () => {
      if (run.length) out.push({ kind: 'actions', id: `actions-${run[0]!.id}`, lines: run.map(actionLine) });
      run = [];
    };
    for (const it of turn.items) {
      if (it.kind === 'tool') { run.push(it); continue; }
      if (it.kind === 'permission' && (it.decision === undefined || it.decision === 'unknown')) continue;
      flush();
      if (it.kind === 'prompt') out.push({ kind: 'user', id: it.id, text: it.text });
      else if (it.kind === 'message' || it.kind === 'reply') out.push({ kind: 'agent', id: it.id, text: it.text });
      else if (it.kind === 'permission') out.push({ kind: 'permission', id: it.id, tool: it.tool, accepted: it.decision === 'accept' });
      else out.push({ kind: 'helper', id: it.id, task: it.task, done: it.state === 'exited' });
    }
    flush();
  }
  return out;
}
