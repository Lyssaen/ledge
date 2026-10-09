import { connect } from '../client.js';

export async function printStatus(opts: { port?: number } = {}): Promise<string> {
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
  catch { return 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)'; }
  const snap = await client.next('snapshot');
  await client.close();
  if (snap.sessions.length === 0) return 'no sessions';
  const rows = snap.sessions.map(s => {
    const age = Math.round((Date.now() - Date.parse(s.startedAt)) / 60000);
    const ask = s.pending ? ` · ${s.pending.kind}: ${s.pending.text}` : '';
    return `${s.name.padEnd(8)} ${s.tool.padEnd(7)} ${s.state.padEnd(19)} ${s.project.padEnd(28)} ${age}m${ask}${s.source === 'hook_only' ? ' · read only' : ''}`;
  });
  return rows.join('\n');
}
