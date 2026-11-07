export const WEBGL_DEFAULT = 12, WEBGL_MIN = 1, WEBGL_MAX = 16;

/** Les terminaux qui rendent en WebGL : les `max` derniers montrés (`shown` dans l'ordre où ils l'ont été, le plus récent à la fin). */
export function webglPick(shown: readonly string[], max: number): ReadonlySet<string> {
  const n = Math.max(WEBGL_MIN, Math.min(WEBGL_MAX, Math.floor(max) || WEBGL_MIN));
  return new Set(shown.slice(-n));
}
