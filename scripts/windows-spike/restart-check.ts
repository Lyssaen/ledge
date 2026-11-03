// The pane host's promise, checked on the PC: an agent outlives its daemon.
//   tsx restart-check.ts before            launches Claude in the work folder, gives it a ~20 s task; prints {"id"}
//   tsx restart-check.ts after <id>        against the new daemon: the session is still there and ends its turn idle
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Session, ServerMessage } from '@ledge/protocol';
import { connect } from '../../packages/ledge/src/client.js';

const [phase, given] = process.argv.slice(2);
const WORK = join(tmpdir(), 'ledge-spike', 'work');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
const out = (o: object) => console.log(JSON.stringify({ ms: Date.now() - t0, ...o }));

const client = await connect({ timeoutMs: 3000 });
const sessions = new Map<string, Session>();
void (async () => {
  for (;;) {
    let m: ServerMessage;
    try { m = await client.nextOf(['snapshot', 'session.updated'] as const, 3_600_000) as ServerMessage; } catch { return; }
    if (m.type === 'snapshot') for (const s of m.sessions) sessions.set(s.id, s);
    else if (m.type === 'session.updated') sessions.set(m.session.id, m.session);
  }
})();
const until = async (id: string, pred: (s: Session) => boolean, ms: number, label: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = sessions.get(id); if (s && pred(s)) return s; await sleep(100); }
  throw new Error(`${label}: timeout, state ${sessions.get(id)?.state}`);
};
await sleep(300);

if (phase === 'before') {
  client.send({ type: 'session.launch', tool: 'claude', cwd: WORK });
  const { id } = await client.next('session.launched', 30_000) as Extract<ServerMessage, { type: 'session.launched' }>;
  let s = await until(id, x => x.state === 'idle' || !!x.pending, 90_000, 'launch');
  if (s.pending?.kind === 'permission' && /trust/i.test(s.pending.text)) { client.send({ type: 'session.decide', id, decision: 'accept' }); s = await until(id, x => x.state === 'idle', 90_000, 'trusted'); }
  client.send({ type: 'session.reply', id, text: "Écris les nombres de 1 à 120 en toutes lettres, un par ligne, sans rien d'autre." });
  await until(id, x => x.state === 'working', 30_000, 'working');
  out({ id, state: 'working' });
} else if (phase === 'after' && given) {
  const s = await until(given, () => true, 10_000, 'known');
  out({ id: given, stateAfterRestart: s.state });
  const end = await until(given, x => x.state === 'idle' || x.state === 'exited', 180_000, 'turn end');
  out({ id: given, stateAtEnd: end.state, exitCode: end.exitCode ?? null });
} else throw new Error('usage: restart-check.ts before | after <id>');
await client.close();
process.exit(0);
