import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEADER_ROLE } from '@ledge/protocol';

/** The rule « a team has exactly one lead »: null when a seat has the `leader` role, else the reason. A role is never seated twice
 *  (`SeatsSchema`), so « exactly one » is « one is there ». Kept in the daemon, never in a wire schema. */
export function leaderIssue(seats: readonly { role: string }[]): string | null {
  return seats.some(s => s.role === LEADER_ROLE) ? null : `il manque le siège @${LEADER_ROLE} : une équipe a exactement un lead (ajoute un siège de rôle ${LEADER_ROLE})`;
}

const DEFAULT_LEADER = `---
label: Lead
tool: claude
---
Tu mènes l'équipe. Tu reçois l'objectif comme une tâche : prends-la, découpe le travail, et confie chaque morceau au siège qui convient (ledge task give @<rôle> "<titre>" "<détail>"). Les résultats te reviennent : relis-les, redonne ce qui ne va pas. Quand l'objectif est atteint, rends le résultat final (ledge task done <id> "<ce qui est fait, où, tests>"). Ne code toi-même que ce qui ne se délègue pas.
`;

/** Seeds the default `leader` role once: written only when neither `leader.md` nor the marker is there, so a user who deletes it does not see it back. */
export function ensureLeaderRole(dir: string): boolean {
  const file = join(dir, `${LEADER_ROLE}.md`); const marker = join(dir, '.leader-seeded');
  if (existsSync(file) || existsSync(marker)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, DEFAULT_LEADER);
  writeFileSync(marker, '');
  return true;
}
