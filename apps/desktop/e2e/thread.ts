import type { ThreadItem } from '@ledge/protocol';
import { eight, T0 } from './daemon';

/** The fleet of the session specs: Otto waits on `npm test` with a helper at work, Luna on a question. */
export const fleet = eight.map(s => s.id === 'otto'
  ? { ...s, pending: { kind: 'permission' as const, text: 'npm test', tool: 'Bash', source: 'hook' as const }, helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'working' as const }] }
  : s.id === 'luna' ? { ...s, pending: { kind: 'question' as const, text: 'Quel port ?', source: 'hook' as const } } : s);

const base = new Date(T0).getTime();
export const at = (s: number) => new Date(base + s * 1000).toISOString();
export const tool = (id: string, s: number, name: string, label: string, extra: Record<string, unknown> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: at(s), turn: 1, tool: name, label, status: 'success', files: [], ...extra }) as ThreadItem;
export const ottoThread: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(-600), turn: 1, text: 'Câble la liste' },
  tool('t1', -590, 'Read', '/w/ledge/src/App.tsx', { durationMs: 400 }),
  tool('t2', -580, 'Grep', 'useKeys', { durationMs: 300 }),
  tool('t3', -570, 'Edit', '/w/ledge/src/App.tsx', { durationMs: 200, files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }] }),
  { kind: 'message', id: 'msg-1', at: at(-560), turn: 1, text: 'Je lance les tests.' },
  { kind: 'permission', id: 'perm-1', at: at(-550), turn: 1, tool: 'Bash', text: 'npm test', decision: 'accept' },
  tool('t4', -540, 'Bash', 'npm test', { status: 'failed', error: 'exit 1', durationMs: 6800 }),
  { kind: 'helper', id: 'h1', at: at(-530), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'working' },
  { kind: 'message', id: 'msg-h', at: at(-525), turn: 1, helperId: 'h1', text: 'Je lis.' },
  { kind: 'reply', id: 'reply-1', at: at(-520), turn: 1, text: 'Deux tests échouent.' },
  { kind: 'prompt', id: 'prompt-2', at: at(-10), turn: 2, text: 'Corrige-les' },
  { kind: 'permission', id: 'perm-2', at: at(-9), turn: 2, tool: 'Bash', text: 'npm test' },
  tool('t5', -8, 'Bash', 'npm test', { turn: 2, status: 'running' })
];
