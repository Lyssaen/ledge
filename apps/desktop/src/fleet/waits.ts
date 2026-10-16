import { useMemo, useRef } from 'react';
import type { Session } from '@ledge/protocol';
import { trackWaits, type Wait } from '../list/time';

/** Le début de chaque attente (trackWaits), tenu par la coquille : il survit à la Liste et à la page de session. */
export function useWaits(sessions: readonly Session[]): ReadonlyMap<string, Wait> {
  const tracked = useRef<ReadonlyMap<string, Wait>>(new Map());
  return useMemo(() => (tracked.current = trackWaits(tracked.current, sessions)), [sessions]);
}
