import { z } from 'zod';

/** A size of the island or of its windows, as both fronts offer it (`@ledge/ui/scale`'s UI_SCALES). */
export const IslandScaleSchema = z.union([z.literal('auto'), z.literal(1), z.literal(1.25), z.literal(1.5), z.literal(2)]);

/** What the closed notch shows of the track playing on this PC. Off unless the user turns it on. */
export const MusicPrefsSchema = z.object({
  enabled: z.boolean(),
  /** `controls`: previous, play/pause, next. `controls-title`: those, plus the title and the artist. */
  hover: z.enum(['controls', 'controls-title']),
  /** How long the cover stays after a pause. `5min` is 300 000 ms (`MUSIC_PAUSED_MS`). */
  paused: z.enum(['always', '5min', 'hide'])
});
export type MusicPrefs = z.infer<typeof MusicPrefsSchema>;
export const DEFAULT_MUSIC_PREFS: MusicPrefs = { enabled: false, hover: 'controls', paused: '5min' };
/** How long a paused cover stays when `paused` is `5min`. */
export const MUSIC_PAUSED_MS = 300_000;

/** The track Windows reports, or the payload of `ledge://media`. `cover` is a data URL, or null. */
export const NowPlayingSchema = z.object({
  title: z.string(),
  artist: z.string(),
  playing: z.boolean(),
  cover: z.string().nullable(),
  canPrev: z.boolean(),
  canNext: z.boolean(),
  source: z.string()
});
export type NowPlaying = z.infer<typeof NowPlayingSchema>;
/** Emitted to every window when the current track changes. `null` means nothing is playing. */
export const MEDIA_EVENT = 'ledge://media';
export type MediaAction = 'prev' | 'toggle' | 'next';

/** The island's settings, set in Ledge Desktop › Settings › Island and applied by the island (atelier spec §7, sober island §4). */
export const IslandPrefsSchema = z.object({
  /** Shown at the top of the screen; hidden, Desktop still notifies. */
  visible: z.boolean(),
  /** `primary` (whichever it is after a reconfiguration), or a monitor's id as the shell lists it (`list_monitors`: the OS
   *  name, `#index` without one). `second`, written by older fronts, is the first monitor that is not the primary. */
  screen: z.string().trim().min(1).max(200),
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
  shortcut: z.string().trim().min(1).max(40),
  /** The track in the closed notch. Absent in a file written before it: off. */
  music: MusicPrefsSchema.default(DEFAULT_MUSIC_PREFS)
});
export type IslandPrefs = z.infer<typeof IslandPrefsSchema>;

export const DEFAULT_ISLAND_PREFS: IslandPrefs = {
  visible: true, screen: 'primary', position: 'center', discreet: true, islandScale: 'auto', panelScale: 'auto',
  shows: { quick: true, finished: true, say: true, helpers: true }, shortcut: 'Ctrl Alt L',
  music: DEFAULT_MUSIC_PREFS
};
