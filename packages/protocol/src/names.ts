/** The bots' first names, in the order they are handed out. Shared so the overlay can offer a free one before launching. */
export const NAMES: readonly string[] = [
  'Otto', 'Pim', 'Nova', 'Bix', 'Lu', 'Max', 'Ida', 'Rex', 'Zoe', 'Kit',
  'Ari', 'Bo', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jax',
  'Kai', 'Lio', 'Mo', 'Nia', 'Oz', 'Pax', 'Quin', 'Rae', 'Sol', 'Tad',
  'Uma', 'Vic', 'Wyn', 'Xen', 'Yan', 'Zia', 'Abe', 'Bea', 'Cy', 'Dot',
  'Eva', 'Fin', 'Gil', 'Hen', 'Iro', 'Jo', 'Kip', 'Lex', 'Mia', 'Ned',
  'Ola', 'Pat', 'Rio', 'Sam', 'Tia', 'Ulf', 'Val', 'Wes', 'Yui', 'Zed',
  'Ash', 'Bry', 'Cleo', 'Dax'
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** The first free name, or the preferred one (capitalized, suffixed `-2`, `-3`… while taken). */
export function pickName(taken: Iterable<string>, preferred?: string): string {
  const used = new Set(taken);
  const free = (n: string) => !used.has(n);
  // A blank --name is no preference, not an empty name (which the session schema rejects).
  const wanted = preferred?.trim();
  if (wanted) {
    const base = cap(wanted);
    if (free(base)) return base;
    for (let i = 2; ; i++) if (free(`${base}-${i}`)) return `${base}-${i}`;
  }
  const first = NAMES.find(free);
  if (first) return first;
  for (let i = 2; ; i++) if (free(`${NAMES[0]}-${i}`)) return `${NAMES[0]}-${i}`;
}
