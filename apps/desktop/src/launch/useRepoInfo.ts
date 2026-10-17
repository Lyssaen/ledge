import { useEffect, useRef, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { RepoInfo } from '@ledge/protocol';

const NONE: ReadonlyMap<string, RepoInfo> = new Map();
let next = 0;

/** What the machine says of these folders (existence, Git branch): one `repos.inspect` per (machine, paths), with its own requestId;
 *  an answer to another request is ignored. Empty while it is asked, and when there is no machine or no path. */
export function useRepoInfo(client: DaemonClient, machine: string | null, paths: readonly string[]): ReadonlyMap<string, RepoInfo> {
  // The key only says when to ask again; the paths sent are the ones given, never read back from it.
  const key = machine === null || paths.length === 0 ? null : JSON.stringify([machine, paths]);
  const given = useRef(paths);
  given.current = paths;
  const [answer, setAnswer] = useState<{ key: string; infos: ReadonlyMap<string, RepoInfo> } | null>(null);
  useEffect(() => {
    if (key === null || machine === null) return;
    const asked = [...given.current];
    const requestId = `repos-${++next}`;
    const off = client.onMessage(m => {
      if (m.type === 'repos.info' && m.requestId === requestId) setAnswer({ key, infos: new Map(m.repos.map(r => [r.path, r])) });
    });
    client.send({ type: 'repos.inspect', requestId, paths: asked, machineId: machine });
    return off;
  }, [client, key, machine]);
  return answer && answer.key === key ? answer.infos : NONE;
}
