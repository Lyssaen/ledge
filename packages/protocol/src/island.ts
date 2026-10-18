import { z } from 'zod';

/** A size of the island or of its windows, as both fronts offer it (`@ledge/ui/scale`'s UI_SCALES). */
export const IslandScaleSchema = z.union([z.literal('auto'), z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(2)]);

/** The island's settings, set in Ledge Desktop › Settings › Island and applied by the island (atelier spec §7, sober island §4). */
export const IslandPrefsSchema = z.object({
  /** Shown at the top of the screen; hidden, Desktop still notifies. */
  visible: z.boolean(),
  /** The primary screen, or the first other one. */
  screen: z.enum(['primary', 'second']),
  position: z.enum(['center', 'left', 'right']),
  /** A strip under a maximised window. */
  discreet: z.boolean(),
  islandScale: IslandScaleSchema,
  panelScale: IslandScaleSchema,
  /** What the island shows besides asks and questions, which it always shows. */
  shows: z.object({
    /** Allow, deny or answer in a line from the island; off, its cards only say « Open in Ledge ». */
    quick: z.boolean(),
    /** The 6 s bubble when an agent finishes. */
    finished: z.boolean(),
    /** An agent's sentence in a bubble. */
    say: z.boolean(),
    /** The sub-agents next to their main agent. */
    helpers: z.boolean()
  }),
  /** The global shortcut that opens the island, as shown (`Ctrl Alt L`). */
  shortcut: z.string().trim().min(1).max(40)
});
export type IslandPrefs = z.infer<typeof IslandPrefsSchema>;

export const DEFAULT_ISLAND_PREFS: IslandPrefs = {
  visible: true, screen: 'primary', position: 'center', discreet: true, islandScale: 'auto', panelScale: 'auto',
  shows: { quick: true, finished: true, say: true, helpers: true }, shortcut: 'Ctrl Alt L'
};
