import { parse } from 'yaml';
import type { RigSpecInfo, RigSpecSeat } from '@ledge/protocol';
import type { OpenRigHttp } from './http.js';
import { log } from '../../log.js';

const CONCURRENCY = 8;
const str = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined;
const rec = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const readYaml = (yaml: string): Record<string, unknown> | null => { try { return rec(parse(yaml)); } catch { return null; } };

/** The members of every pod of a rig spec, address `@member`. An unreadable YAML gives []. Reused by the launch plan (lot 5). */
export function specSeats(yaml: string): RigSpecSeat[] {
  const doc = readYaml(yaml); const pods = doc?.pods;
  if (!Array.isArray(pods)) return [];
  const seats: RigSpecSeat[] = [];
  for (const p of pods) {
    const pod = rec(p); const podId = str(pod?.id); const members = pod?.members;
    if (!pod || !podId || !Array.isArray(members)) continue;
    for (const m of members) {
      const member = rec(m); const id = str(member?.id); const runtime = str(member?.runtime);
      if (!member || !id || !runtime) continue;
      const model = str(member.model), effort = str(member.effort), profile = str(member.profile);
      seats.push({ address: `@${id}`, member: id, pod: podId, runtime, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(profile ? { profile } : {}) });
    }
  }
  return seats;
}

/** The rig specs OpenRig knows (built-in and the user's library), seats read from each YAML. The registry is not queried (no network). */
export async function listSpecs(http: OpenRigHttp): Promise<RigSpecInfo[]> {
  const entries = await http.specs();
  const out: RigSpecInfo[] = new Array(entries.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < entries.length; i = next++) {
      const e = entries[i]!; let seats: RigSpecSeat[] = []; let summary = str(e.summary);
      try {
        const { yaml } = await http.spec(e.id); seats = specSeats(yaml);
        const s = str(readYaml(yaml)?.summary)?.replace(/\s+/g, ' ').trim(); if (s) summary = s;
      } catch (err) { log(`openrig: spec ${e.id} not read: ${(err as Error).message}`); }
      out[i] = { id: e.id, name: e.name, ...(summary ? { summary } : {}), source: e.sourceType === 'builtin' ? 'builtin' : 'library', ...(e.sourcePath ? { path: e.sourcePath } : {}), seats };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return out;
}
