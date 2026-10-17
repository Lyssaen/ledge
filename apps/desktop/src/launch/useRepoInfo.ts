import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { RepoInfo } from '@ledge/protocol';

const NONE: ReadonlyMap<string, RepoInfo> = new Map();
let next = 0;

/** What the machine says of these folders (existence, Git branch): one `repos.inspect` per (machine, paths), with its own requestId;
 *  an answer to another request is ignored. Empty while it is asked, and when there is no machine or no path. */
export function useRepoInfo(client: DaemonClient, machine: string | null, paths: readonly string[]): ReadonlyMap<string, RepoInfo> {
  const key = machine === null || paths.length === 0 ? null : `${machine}\n${paths.join('\n')}`;
  const [answer, setAnswer] = useState<{ key: string; infos: ReadonlyMap<string, RepoInfo> } | null>(null);
  useEffect(() => {
    if (key === null) return;
    const [id, ...asked] = key.split('\n');
    const requestId = `repos-${++next}`;
    const off = client.onMessage(m => {
      if (m.type === 'repos.info' && m.requestId === requestId) setAnswer({ key, infos: new Map(m.repos.map(r => [r.path, r])) });
    });
    client.send({ type: 'repos.inspect', requestId, paths: asked, machineId: id! });
    return off;
  }, [client, key]);
  return answer && answer.key === key ? answer.infos : NONE;
}
