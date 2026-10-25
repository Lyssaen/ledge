import { randomUUID } from 'node:crypto';
import { TASK_TEXT_MAX, TASK_TITLE_MAX, type ClientMessage, type Task } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

export const TASK_USAGE = `ledge task give <nom> "<titre>" ["<détail>"]   confier un travail à une session
ledge task list [--all]                         tes tâches (tenues ou confiées), ouvertes ; --all : closes aussi
ledge task show <id>                            une tâche, son détail et son historique
ledge task take <id>                            la prendre
ledge task done <id> ["<résultat>"]             la terminer (la session qui l'a confiée est prévenue)
ledge task refuse <id> "<raison>"               la refuser, ou l'annuler si tu l'as confiée
ledge task pass <id> <nom> ["<note>"]           la passer à une autre session`;
/** One deadline for connect and answer: Codex kills a hook after 5 s, and the hook calls this in-process. */
const TASK_MS = 4000;
const ID = /^t[0-9a-f]{6}$/;

type Op = Omit<Extract<ClientMessage, { type: 'task.cmd' }>, 'type' | 'rid' | 'by'>;

/** The arguments of `ledge task`, or `undefined` when they do not fit its usage. */
export function taskArgs(args: string[]): Op | undefined {
  const [op, ...rest] = args;
  const id = rest[0] && ID.test(rest[0]) ? rest[0] : undefined;
  const fits = (min: number, max: number) => rest.length >= min && rest.length <= max && rest.slice(0, min).every(a => a.trim() !== '');
  switch (op) {
    case 'give': return fits(2, 3) && rest[1]!.length <= TASK_TITLE_MAX && (rest[2]?.length ?? 0) <= TASK_TEXT_MAX
      ? { op, to: rest[0]!, title: rest[1]!, ...(rest[2] ? { text: rest[2] } : {}) } : undefined;
    case 'list': return rest.length === 0 ? { op } : rest.length === 1 && rest[0] === '--all' ? { op, all: true } : undefined;
    case 'show': case 'take': return fits(1, 1) && id ? { op, task: id } : undefined;
    case 'done': return fits(1, 2) && id && (rest[1]?.length ?? 0) <= TASK_TEXT_MAX ? { op, task: id, ...(rest[1] ? { text: rest[1] } : {}) } : undefined;
    case 'refuse': return fits(2, 2) && id && rest[1]!.length <= TASK_TEXT_MAX ? { op, task: id, text: rest[1]! } : undefined;
    case 'pass': return fits(2, 3) && id && (rest[2]?.length ?? 0) <= TASK_TEXT_MAX ? { op, task: id, to: rest[1]!, ...(rest[2] ? { text: rest[2] } : {}) } : undefined;
    default: return undefined;
  }
}

const STATE: Record<Task['state'], string> = { open: 'à prendre', taken: 'prise', done: 'terminée', refused: 'refusée', dropped: 'abandonnée' };
const time = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/** A task whole: its head, its detail, its result, its history. */
export function formatTask(t: Task): string {
  return [
    `${t.id} · ${STATE[t.state]} · de ${t.giverName} à ${t.ownerName} · ${time(t.at)}`,
    t.title,
    ...(t.text ? ['', t.text] : []),
    ...(t.result ? ['', `${t.state === 'done' ? 'Résultat' : 'Raison'} : ${t.result}`] : []),
    '', 'Historique :',
    ...t.log.map(l => `  ${time(l.at)} ${l.by} : ${l.what}`)
  ].join('\n');
}

/** `ledge task …` over an already-connected client, as session `by`. */
export async function taskOnClient(client: Client, args: string[], by: string, ms: number): Promise<{ line: string; code: number }> {
  const op = taskArgs(args);
  if (!op) return { line: TASK_USAGE, code: 1 };
  try {
    client.send({ type: 'task.cmd', rid: randomUUID(), by, ...op });
    const r = await client.next('task.result', ms);
    if (r.reason !== undefined) return { line: `refusé : ${r.reason}`, code: 1 };
    if (op.op === 'list') {
      const list = r.tasks ?? [];
      if (!list.length) return { line: op.all ? 'aucune tâche' : 'aucune tâche ouverte', code: 0 };
      return { line: list.map(t => `${t.id}  ${STATE[t.state].padEnd(10)} ${t.giverName} → ${t.ownerName}  ${t.title}`).join('\n'), code: 0 };
    }
    const t = r.task!;
    switch (op.op) {
      case 'give': return { line: `tâche ${t.id} confiée à ${t.ownerName} : elle lui arrive à son prochain moment libre`, code: 0 };
      case 'take': return { line: `tâche ${t.id} prise`, code: 0 };
      case 'done': return { line: `tâche ${t.id} terminée ; Ledge prévient ${t.giverName}`, code: 0 };
      case 'refuse': return { line: t.giver === by ? `tâche ${t.id} annulée ; Ledge prévient ${t.ownerName}` : `tâche ${t.id} refusée ; Ledge prévient ${t.giverName}`, code: 0 };
      case 'pass': return { line: `tâche ${t.id} passée à ${t.ownerName}`, code: 0 };
      default: return { line: formatTask(t), code: 0 };
    }
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  }
}

/** `ledge task …` from a session Ledge launched (its id from the environment, as `ledge send`). */
export async function runTask(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ line: string; code: number }> {
  if (!taskArgs(args)) return { line: TASK_USAGE, code: args.length ? 1 : 0 };
  const env = opts.env ?? process.env;
  const by = env[CODEX_HOOK_VAR] || env.LEDGE_SESSION;
  if (!by) return { line: 'ledge task ne marche que dans une session lancée par Ledge', code: 1 };
  const deadline = Date.now() + (opts.timeoutMs ?? TASK_MS);
  const left = () => Math.max(0, deadline - Date.now());
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: left() }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try { return await taskOnClient(client, args, by, left()); }
  finally { await client.close(); }
}
