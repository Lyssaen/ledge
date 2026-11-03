/* Claude Code's `<task-notification>`: a prompt the harness writes when a background agent or command stopped or ended.
   Read here once for both screens that show it as a task card (the desktop's thread, the phone's). */

export type TaskStatus = 'killed' | 'completed' | 'failed' | 'other';
export interface TaskNotice {
  id?: string; output?: string; status: TaskStatus; summary: string;
  /** What the summary is about, when it is one of Claude Code's known sentences. */
  about: { kind: 'agent'; name: string } | { kind: 'command'; command: string; code?: string } | null;
  /** The notification as it came, for « Notification brute ». */
  raw: string;
}

const field = (xml: string, name: string): string | undefined => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim();

/** A prompt that is a `<task-notification>` (a background agent or command that stopped or ended), else null. */
export function taskOf(text: string): TaskNotice | null {
  const raw = text.trim();
  if (!raw.startsWith('<task-notification>')) return null;
  const status = field(raw, 'status');
  const summary = field(raw, 'summary') ?? '';
  const agent = summary.match(/^Agent "(.+)" (?:was |has )?(?:stopped|killed|completed|finished|failed)/);
  const command = summary.match(/^Background command "(.+)" (?:completed|failed|was stopped|was killed)(?: \(exit code (\d+)\))?/);
  return {
    ...(field(raw, 'task-id') !== undefined && { id: field(raw, 'task-id') }),
    ...(field(raw, 'output-file') !== undefined && { output: field(raw, 'output-file') }),
    status: status === 'killed' || status === 'completed' || status === 'failed' ? status : 'other',
    summary,
    about: agent ? { kind: 'agent', name: agent[1]! } : command ? { kind: 'command', command: command[1]!, ...(command[2] !== undefined && { code: command[2] }) } : null,
    raw
  };
}
