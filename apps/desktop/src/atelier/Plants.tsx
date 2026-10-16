import type { JSX } from 'react';
import { plantsFor, type Species, type Spot } from './plants';

/** The mockup's plant drawings (decor.tsx), unchanged: purely decorative, aria-hidden, never interactive. */
const SPECIES: Record<Species, () => JSX.Element> = {
  monstera: () => <span className="p-monstera"><i /><i /><i /><i /><i /><b /></span>,
  fern: () => <span className="p-fern">{[0, 1, 2, 3, 4, 5, 6].map(k => <i key={k} />)}<b /></span>,
  snake: () => <span className="p-snake"><i /><i /><i /><i /><b /></span>,
  ficus: () => <span className="p-ficus"><i /><i /><i /><i /><em /><b /></span>,
  succulent: () => <span className="p-succulent"><i /><i /><i /><i /><i /><b /></span>
};

/** One or two plants on a table's rug, species and spots picked from the project id (stable, different per table). */
export function Plants({ projectId, left, width, avoid }: { projectId: string; left: string; width: number; avoid: readonly Spot[] }): JSX.Element {
  return (
    <div className="plants" aria-hidden="true" style={{ left, width }}>
      {plantsFor(projectId, avoid).map(({ spot, species, flip }) => {
        const Kind = SPECIES[species];
        return <span key={spot} className={`plant-spot spot-${spot}${flip ? ' flip' : ''}`}><Kind /></span>;
      })}
    </div>
  );
}
