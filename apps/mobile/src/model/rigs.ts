import type { PhoneEscalation, PhoneRig, PhoneTeam, PhoneThreadItem } from '@ledge/protocol';

/** The teams engine in force, as the snapshot says it (lot F); a daemon that does not say it predates the choice: OpenRig. */
export const teamsEngine = (daemon: { teamsEngine?: 'ledge' | 'openrig' } | null): 'ledge' | 'openrig' => daemon?.teamsEngine ?? 'openrig';
/** What a card says of the definition a team came from: a Ledge team's template (« modèle »), an OpenRig rig's spec. */
export const specLabel = (r: PhoneRig): string => r.spec ? `${r.engine === 'ledge' ? 'modèle' : 'spec'} ${r.spec}` : '';
/** A Ledge team's id, for its live-team screen: the one the daemon sends, else the live team of that name in that project. */
export const teamIdOf = (r: PhoneRig, teams: readonly PhoneTeam[] | null): string | undefined =>
  r.engine !== 'ledge' ? undefined : r.teamId ?? teams?.find(t => t.name === r.name && t.project === r.project)?.id;

export const rigPlace = (r: PhoneRig): string => r.project ? `dans ${r.project}` : 'hors projet';
export const rigProgress = (r: PhoneRig) => ({ working: r.seats.filter(s => ['working', 'starting', 'trust'].includes(s.state)).length, total: r.seats.length });
const colors = ['violet', 'blue', 'green', 'amber', 'rose', 'cyan'];
export const rigColor = (key: string): string => colors[Array.from(key).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0) % colors.length]!;
export const rigCopyName = (name: string): string => `.worktrees/rig-${name}`;
/** Active non-kernel rigs first; retain the daemon's ordering within each group. */
export const sortRigs = (rigs: readonly PhoneRig[], escalations: readonly PhoneEscalation[] = []): PhoneRig[] => [...rigs].sort((a, b) => {
  const rank = (r: PhoneRig) => r.kernel ? 10 : escalations.some(e => e.rigKey === r.key && e.state === 'pending') ? 0 : r.lifecycle === 'running' || r.lifecycle === 'partial' ? 1 : r.lifecycle === 'launching' ? 2 : 3;
  return rank(a) - rank(b);
});
export const foldLabel = (i: Extract<PhoneThreadItem, { kind: 'exchanges' }>): string => {
  const time = (s: string) => new Date(s).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const from = time(i.from), to = time(i.to);
  return `${i.count} échange${i.count > 1 ? 's' : ''} · ${from}${from === to ? '' : ` → ${to}`}`;
};
