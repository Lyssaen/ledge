import { createContext, useContext, useEffect, useRef } from 'react';
import { useWindowSize, type Key } from 'ink';
import type { DaemonClient, DaemonState, Fleet, MachineState } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import type { Actions, Toast } from './actions.js';
import type { Asked } from './model/chat.js';
import type { ClipboardImage } from './clipboard.js';
import type { Glyphs } from './glyphs.js';
import type { Lang, Messages } from './i18n/lang.js';
import type { ThemeChoice, Tone } from './theme.js';

export type Screen = 'overview' | 'session' | 'ask' | 'launch' | 'settings' | 'help';
export const SCREENS: readonly Screen[] = ['overview', 'session', 'ask', 'launch', 'settings'];

/** What the fields keep while the TUI runs, a screen left or not: each one's draft and what it sent, by field (`ask`, or a
 *  session's id). */
export interface Kept { drafts: Map<string, string>; sent: Map<string, string[]>; asked: Asked[] }

/** A screen's keys: true when it took the key (the global keys then leave it alone). */
export type KeyHandler = (input: string, key: Key) => boolean;

export interface Tui {
  client: DaemonClient; fleet: Fleet; d: DaemonState; machines: MachineState[]; projects: Projects | null;
  t: Messages; lang: Lang; setLang(lang: Lang): void; g: Glyphs;
  /** The theme chosen, the tone drawn (what the palette `C` holds now), the terminal's background as found at start
   *  (undefined: not asked, the theme was forced). */
  theme: ThemeChoice; setTheme(theme: ThemeChoice): void; tone: Tone; background: Tone | undefined;
  screen: Screen; go(screen: Screen): void;
  /** The session the overview and the session screen show. */
  selected: Session | null; select(id: string | null): void;
  toast(t: Toast): void; lastToast: Toast | null; actions: Actions;
  /** A field has the keyboard: the global keys are off. */
  editing: boolean; setEditing(on: boolean): void;
  /** Below `MIN`: the screen is not drawn, its keys are off but esc. */
  small: boolean;
  attach(s: Session): void;
  kept: Kept;
  /** Hands the terminal to `argv` (an editor) until it exits. */
  runInTerminal(argv: string[]): void;
  env: NodeJS.ProcessEnv;
  /** The clipboard picture (null when there is none) and the system viewer: injected so tests stub them. */
  readImage(): Promise<ClipboardImage | null>;
  openFile(file: string): Promise<void>;
  /** Registers the screen's key handler (see `useScreenKeys`). */
  keys: { current: KeyHandler | null };
}

export const TuiContext = createContext<Tui | null>(null);
export const useTui = (): Tui => {
  const tui = useContext(TuiContext);
  if (!tui) throw new Error('useTui outside the TUI');
  return tui;
};

/** The room the TUI draws in: the terminal, less its last column under Windows Terminal, which says one column more than it
 *  shows (the last one goes under its scrollbar, and the boxes' right edge with it). */
export function screenSize({ columns, rows }: { columns: number; rows: number }, env: NodeJS.ProcessEnv): { columns: number; rows: number } {
  return { columns: env.WT_SESSION ? Math.max(1, columns - 1) : columns, rows };
}
export const useScreenSize = (): { columns: number; rows: number } => screenSize(useWindowSize(), useTui().env);

/** The screen's keys, asked first by the App; the latest handler is used, so it may read the render's state. */
export function useScreenKeys(handler: KeyHandler): void {
  const { keys } = useTui();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const fn: KeyHandler = (i, k) => latest.current(i, k);
    keys.current = fn;
    return () => { if (keys.current === fn) keys.current = null; };
  }, [keys]);
}

/** While `on`, a field has the keyboard. */
export function useEditing(on: boolean): void {
  const { setEditing } = useTui();
  useEffect(() => { setEditing(on); return () => setEditing(false); }, [on, setEditing]);
}
