import React from 'react';

/** Plant species that can stand around a table. Purely decorative: aria-hidden, never interactive. */
const SPECIES: Record<string, () => React.ReactElement> = {
  monstera: () => <span className="p-monstera"><i /><i /><i /><i /><i /><b /></span>,
  fern: () => <span className="p-fern">{[0, 1, 2, 3, 4, 5, 6].map(k => <i key={k} />)}<b /></span>,
  snake: () => <span className="p-snake"><i /><i /><i /><i /><b /></span>,
  ficus: () => <span className="p-ficus"><i /><i /><i /><i /><em /><b /></span>,
  succulent: () => <span className="p-succulent"><i /><i /><i /><i /><i /><b /></span>
};
const KINDS = Object.keys(SPECIES);
/** Free spots on the rug: its corners (bottom-left holds the project label) and the middle of each short side. */
const SPOTS = ['tl', 'tr', 'br', 'ml', 'mr'];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** One or two plants per table, species and spots picked from the project id so each room looks different but stable. */
export function Plants({ seed, left, width, avoid = [] }: { seed: string; left: string; width: number; avoid?: string[] }) {
  const h = hash(seed);
  const count = 1 + (h % 2);
  const spots = SPOTS.filter(s => !avoid.includes(s)).sort((a, b) => hash(seed + a) - hash(seed + b)).slice(0, count);
  return <div className="plants" aria-hidden="true" style={{ left, width }}>
    {spots.map((spot, i) => { const Kind = SPECIES[KINDS[(h + i * 7) % KINDS.length]]; return <span key={spot} className={`plant-spot spot-${spot} ${(h >> i) & 1 ? 'flip' : ''}`}><Kind /></span>; })}
  </div>;
}
