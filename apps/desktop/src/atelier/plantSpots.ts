import { seedHash } from '@ledge/ui/bots/poseFor';

export type Species = 'monstera' | 'fern' | 'snake' | 'ficus' | 'succulent';
export type Spot = 'tl' | 'tr' | 'br' | 'ml' | 'mr';

const KINDS: Species[] = ['monstera', 'fern', 'snake', 'ficus', 'succulent'];
const SPOTS: Spot[] = ['tl', 'tr', 'br', 'ml', 'mr'];

/** One or two plants per table, from the project id (decor.tsx's Plants, unchanged); 'bl' carries the label. */
export function plantsFor(projectId: string, avoid: readonly Spot[]): { spot: Spot; species: Species; flip: boolean }[] {
  const h = seedHash(projectId);
  const count = 1 + (h % 2);
  return SPOTS.filter(s => !avoid.includes(s)).sort((a, b) => seedHash(projectId + a) - seedHash(projectId + b)).slice(0, count)
    .map((spot, i) => ({ spot, species: KINDS[(h + i * 7) % KINDS.length]!, flip: Boolean((h >> i) & 1) }));
}
