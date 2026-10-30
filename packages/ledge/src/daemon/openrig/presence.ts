import type { OpenRigHttp } from './http.js';
import type { RigCli } from './cli.js';
import { OPENRIG_MIN, SUPPORTED_LINE } from './facts.js';

export type Probe = { state: 'absent' | 'stopped' | 'running' | 'unsupported'; version?: string; detail?: string };

/** 0.6.x with x >= 14 (OPENRIG_MIN). */
export function versionSupported(v: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); if (!m) return false;
  return `${m[1]}.${m[2]}` === SUPPORTED_LINE && Number(m[3]) >= Number(OPENRIG_MIN.split('.')[2]);
}

/**
 * /healthz first; when it answers, version = body semver, else `rig --version`. If no version can be found at all the probe
 * returns `running` without version (cannot gate what is unknown). When /healthz is silent, the CLI tells stopped from absent.
 * Stateless: the bridge caches the CLI version while `pid` is unchanged.
 */
export async function probeOpenRig(deps: { http: OpenRigHttp; cli: RigCli }): Promise<Probe> {
  let version: string | undefined;
  try { const h = await deps.http.health(); version = h.semver ?? undefined; }
  catch { return { state: (await deps.cli.available()) ? 'stopped' : 'absent' }; }
  version ??= (await deps.cli.version()) ?? undefined;
  if (!version) return { state: 'running' };
  return versionSupported(version) ? { state: 'running', version } : { state: 'unsupported', version, detail: `OpenRig ${version} non pris en charge` };
}
