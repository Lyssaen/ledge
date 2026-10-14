import { REMOTE_PORT } from '@ledge/protocol';
import { connect } from '../client.js';
import { parseOrigin } from '../mobile/config.js';

const USAGE = 'usage: ledge mobile enable --origin https://<machine>.<tailnet>.ts.net | disable | status';

export async function runMobile(argv: string[], deps: { connect?: typeof connect; print?: (s: string) => void } = {}): Promise<number> {
  const open = deps.connect ?? connect;
  const print = deps.print ?? ((s: string) => console.log(s));
  const [sub, ...rest] = argv;
  if (sub !== 'enable' && sub !== 'disable' && sub !== 'status') { print(USAGE); return sub ? 1 : 0; }

  let origin: string | undefined;
  if (sub === 'enable') {
    const i = rest.indexOf('--origin');
    const value = i >= 0 ? rest[i + 1] : rest.find(a => a.startsWith('--origin='))?.slice('--origin='.length);
    if (!value) { print(`--origin is required\n${USAGE}`); return 1; }
    try { origin = parseOrigin(value).origin; } catch (e) { print(`ledge: ${(e as Error).message}`); return 1; }
  }

  let client;
  try { client = await open({ timeoutMs: 800 }); }
  catch { print('daemon not running (start a session with `ledge claude`, or run `ledge daemon`)'); return 1; }
  try {
    if (sub === 'enable') {
      client.send({ type: 'mobile.configure', origin: origin! });
      print(`Mobile access enabled for ${origin}. On Windows, run:`);
      print(`  tailscale serve --bg --https=443 http://127.0.0.1:${REMOTE_PORT}`);
      return 0;
    }
    if (sub === 'disable') {
      client.send({ type: 'mobile.configure', origin: null });
      print('Mobile access disabled. To stop publishing it on Windows, run: tailscale serve --https=443 off');
      return 0;
    }
    client.send({ type: 'devices' });
    const d = await client.next('devices');
    print(`origin:    ${d.origin ?? 'not configured'}`);
    print(`listening: ${d.listening ? 'yes' : 'no'}`);
    print(d.devices.length === 0 ? 'devices:   none' : 'devices:');
    for (const x of d.devices) print(`  ${x.name}  paired ${x.createdAt}${x.lastSeenAt ? `  last seen ${x.lastSeenAt}` : ''}${x.hasKey ? '' : '  (no key)'}`);
    return 0;
  } catch (e) {
    print(`ledge: ${(e as Error).message}`);
    return 1;
  } finally { await client.close(); }
}
