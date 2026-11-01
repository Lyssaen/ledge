import { createContext, useContext, useEffect, useRef } from 'react';
import { useWindowSize, type Key } from 'ink';
import type { DaemonClient, DaemonState, Fleet, MachineState } from '@ledge/fleet';
import type { Escalation, OpenRigStatus, Projects, Rig, Session } from '@ledge/protocol';
import type { Actions, Toast } from './actions.js';
import type { Asked } from './model/chat.js';
import type { LeftRow } from './model/left.js';
import type { Brain } from './brain.js';
import type { ClipboardImage } from './clipboard.js';
import type { Glyphs } from './glyphs.js';
import type { Lang, Messages } from './i18n/lang.js';
import type { ThemeChoice, Tone } from './theme.js';

/** The screens. */
export type Screen = 'home' | 'session' | 'launch' | 'settings' | 'help';
/** The screens the digits name: `1` Ledge and `2` a rig are the home, focused on one or the other; `3` the session. */
export const SCREENS: readonly Screen[] = ['home', 'home', 'session'];
/** What the launch screen launches: a session, or a rig (ctrl+t switches). */
export type LaunchMode = 'session' | 'rig';

/** What the home shows on its right, chosen in its left column. */
export type Focus = { kind: 'ledge' } | { kind: 'yours'; id: string } | { kind: 'session'; id: string }
  | { kind: 'rig'; machine: string; rigId: string } | { kind: 'seat'; machine: string; rigId: string; ref: string } | { kind: 'kernel'; machine: string };

/** Where the keyboard is in Ledge's conversation: the home's left column (`left`), the conversation read with j k (`convo`), its
 *  field (`field`); 0… one of the action cards drawn under it. */
export const LEDGE_FOCUS = { left: -3, convo: -2, field: -1 } as const;

/** What the fields keep while the TUI runs, a screen left or not: each one's draft and what it sent, by field (`ledge`, or a
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
  /** `launch` opens the launch screen on a session (the default) or a rig. */
  screen: Screen; go(screen: Screen, o?: { launch?: LaunchMode }): void;
  launchMode: LaunchMode; setLaunchMode(mode: LaunchMode): void;
  /** What the home's left column has chosen; `selected` is its session (a session, a waiting one, a paired seat), and
   *  `select(id)` chooses a session (null: Ledge). */
  focus: Focus; setFocus(f: Focus): void;
  selected: Session | null; select(id: string | null): void;
  /** The home's left column, and what it is drawn from. */
  left: LeftRow[]; rigs: Rig[]; escalations: Escalation[]; openrig: OpenRigStatus[];
  /** Where the keyboard is in Ledge's conversation (`LEDGE_FOCUS`, or a card's index): `/` puts it in the field from anywhere. */
  ledgeFocus: number; setLedgeFocus(f: number | ((f: number) => number)): void;
  /** What Ledge's brain sent: its decisions, rules and mandate (undefined until the daemon sends them). */
  brain: Brain;
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
