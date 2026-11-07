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

/** The longest name a session takes: room for the island's bubble, the sidebar row and `-N`. */
export const NAME_MAX = 24;

/** A name as an address: letters, digits, `-` and `_` only (a space, a comma, `@` or ` [ref]` would not resolve as `to`),
 *  cut to NAME_MAX, the first letter capitalised and the rest as typed (« PrixMat » stays PrixMat). '' when nothing is left. */
export function cleanName(raw: string): string {
  const kept = [...raw.normalize('NFC').replace(/[^\p{L}\p{N}_-]/gu, '')].slice(0, NAME_MAX).join('');
  return kept.charAt(0).toUpperCase() + kept.slice(1);
}

/** `ledge` addresses Ledge itself (`ledge task give ledge`): no session takes it. */
const RESERVED = ['ledge'];

/** True when `name` is taken, whatever the case, or a numbered session (`Otto-2`) already holds that base name. */
export function nameTaken(taken: Iterable<string>, name: string): boolean {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  const key = name.toLowerCase();
  if (used.has(key)) return true;
  const prefix = `${key}-`;
  for (const u of used) if (u.startsWith(prefix) && /^\d+$/.test(u.slice(prefix.length))) return true;
  return false;
}

/** What a fresh launch should ask for. A suggestion of a base a numbered session already holds (`Otto` while `Otto-2`
 *  is live) is dropped, so the next list name is chosen. An exact clash is kept and suffixed (`Otto` → `Otto-2`). */
export function openName(taken: Iterable<string>, preferred?: string): string | undefined {
  const wanted = cleanName(preferred ?? '');
  if (!wanted) return undefined;
  const used = new Set([...taken].map(n => n.toLowerCase()));
  if (used.has(wanted.toLowerCase())) return preferred;
  if (nameTaken(taken, wanted)) return undefined;
  return preferred;
}

/** The first free name, or the preferred one (cleaned, suffixed `-2`, `-3`… while that exact name is taken). A name is
 *  taken whatever its case. With no preference, a numbered session holds its base name: `Otto-2` leaves `Otto` for the
 *  session that has it and the next launch takes `Pim`. */
export function pickName(taken: Iterable<string>, preferred?: string): string {
  const used = new Set([...taken].map(n => n.toLowerCase()));
  for (const r of RESERVED) used.add(r);
  const free = (n: string) => !used.has(n.toLowerCase());
  // A blank --name is no preference, not an empty name (which the session schema rejects).
  const wanted = cleanName(preferred ?? '');
  if (wanted) {
    if (free(wanted)) return wanted;
    for (let i = 2; ; i++) if (free(`${wanted}-${i}`)) return `${wanted}-${i}`;
  }
  const first = NAMES.find(n => !nameTaken(taken, n));
  if (first) return first;
  for (let i = 2; ; i++) if (free(`${NAMES[0]}-${i}`)) return `${NAMES[0]}-${i}`;
}

/** The names a new session must not take: those of the sessions still there, neither ended nor archived. An archived one
 *  keeps its name for its own record, but does not hold it: with every past session counted, the 64 names were all taken
 *  and every new session was « Otto-N ». */
export const namesInUse = (sessions: Iterable<{ name: string; state: string; archivedAt?: string }>): string[] =>
  [...sessions].filter(s => s.state !== 'exited' && !s.archivedAt).map(s => s.name);
