/** Release versions compared as the island and Desktop read them (x.y.z, a pre-release before its release). */
const parts = (v: string) => v.split('-')[0]!.split('.').map(n => Number.parseInt(n, 10) || 0);
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = parts(a); const y = parts(b);
  for (let i = 0; i < 3; i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d > 0 ? 1 : -1; }
  // Same numbers: a pre-release (0.0.0-dev) comes before the release.
  return a === b ? 0 : a.includes('-') ? -1 : b.includes('-') ? 1 : 0;
}
