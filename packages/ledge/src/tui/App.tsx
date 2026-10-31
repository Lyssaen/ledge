import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useInput, useStdout, useWindowSize } from 'ink';
import { isPending, useDaemon, useEscalations, useLedgeThread, useMachines, useOpenRig, useProjects, useRigs, type DaemonClient, type Fleet } from '@ledge/fleet';
import { ledgeLine } from '@ledge/ui/rigs/model';
import type { Session } from '@ledge/protocol';
import { useActions, type Toast } from './actions.js';
import { attachCommand, runAttached } from './attach.js';
import { readClipboardImage, type ClipboardImage } from './clipboard.js';
import { openImage } from './openImage.js';
import { screenSize, TuiContext, type Focus, type Kept, type KeyHandler, type Screen, type Tui } from './context.js';
import type { Glyphs } from './glyphs.js';
import { I18nProvider, MESSAGES, type Lang } from './i18n/lang.js';
import { listed } from './model/overview.js';
import { focusKey, focusOrder, focusSession, keepFocus, leftRows } from './model/left.js';
import { asked, notification, title, type NotifyMode } from './notify.js';
import { Home } from './screens/Home.js';
import { SessionScreen } from './screens/Session.js';
import { Ask } from './screens/Ask.js';
import { Launch } from './screens/Launch.js';
import { Settings } from './screens/Settings.js';
import { Help } from './screens/Help.js';
import { MIN } from './ui/Frame.js';
import { setTone, tone as toneNow, toneFor, type ThemeChoice, type Tone } from './theme.js';

/** How long a toast stays. */
export const TOAST_MS = 5000;
/** ctrl+c with a draft quits only when pressed again within this. */
export const QUIT_MS = 2000;

export interface AppProps {
  client: DaemonClient;
  lang: Lang;
  /** Saves the language; throws when it cannot (the choice still applies for this run). */
  saveLang(lang: Lang): void;
  /** The theme chosen (auto by default), the terminal's background as found at start (not asked when the theme is forced;
   *  auto then keeps the tone drawn), and how to save the theme (throws as `saveLang`). */
  theme?: ThemeChoice; background?: Tone; saveTheme?(theme: ThemeChoice): void;
  notify: NotifyMode;
  glyphs: Glyphs;
  env: NodeJS.ProcessEnv;
  /** Test hook: runs an attach command (the real one hands the terminal over to it). */
  run?: (argv: string[]) => Promise<number>;
  /** Test hooks: the clipboard reader (Alt+V) and the image viewer launcher (o, Alt+O). */
  readImage?: () => Promise<ClipboardImage | null>;
  openFile?: (file: string) => Promise<void>;
}

export function App(props: AppProps) {
  const [lang, setLangState] = useState<Lang>(props.lang);
  const [theme, setThemeState] = useState<ThemeChoice>(props.theme ?? 'auto');
  // The palette is switched before anything below draws with it.
  // The background unknown (a theme forced at start), Auto keeps the tone drawn rather than turning dark.
  const tone = toneFor(theme, props.background ?? toneNow());
  if (tone !== toneNow()) setTone(tone);
  return <I18nProvider lang={lang}><Shell {...props} lang={lang} setLang={setLangState} theme={theme} setThemeState={setThemeState} tone={tone} /></I18nProvider>;
}

function Shell({ client, lang, setLang: setLangState, saveLang, theme, setThemeState, tone, background, saveTheme, notify, glyphs, env, run, readImage, openFile }: AppProps & { setLang(l: Lang): void; theme: ThemeChoice; setThemeState(x: ThemeChoice): void; tone: Tone }) {
  const { exit, suspendTerminal } = useApp();
  // Escape sequences that print nothing (bell, OSC 9, title) go straight to the terminal, not through Ink's frame.
  const { stdout } = useStdout();
  const write = useCallback((seq: string) => { if (seq) stdout.write(seq); }, [stdout]);
  const d = useDaemon();
  const machines = useMachines(client);
  const projects = useProjects(client);
  const rigs = useRigs(client);
  const escalations = useEscalations(client);
  const openrig = useOpenRig(client);
  const thread = useLedgeThread(client).items;
  const fleet = client.fleet as Fleet;
  const t = MESSAGES[lang];
  const [screen, setScreen] = useState<Screen>('home');
  const [back, setBack] = useState<Screen>('home');
  const [focus, setFocus] = useState<Focus>({ kind: 'ledge' });
  const [lastToast, setToast] = useState<Toast | null>(null);
  const [editing, setEditingState] = useState(false);
  const keys = useRef<KeyHandler | null>(null);
  const kept = useRef<Kept>({ drafts: new Map(), sent: new Map(), asked: [] }).current;
  // When ctrl+c was last pressed with a draft waiting.
  const armed = useRef(0);

  useEffect(() => {
    if (!lastToast) return;
    const timer = setTimeout(() => setToast(null), lastToast.ms ?? TOAST_MS);
    return () => clearTimeout(timer);
  }, [lastToast]);
  const toast = useCallback((x: Toast) => setToast(x), []);
  const setEditing = useCallback((on: boolean) => setEditingState(on), []);

  // Ledge's row: what waits for the user (the open decisions, their rig), else what Ledge last said. Its count is the decisions
  // open (pending or in Ledge's grace): the thread keeps no read mark yet.
  const said = useMemo(() => { const x = [...thread].reverse().find(i => i.kind === 'ledge' && !i.pending); return x && x.kind === 'ledge' ? { text: x.text, at: x.at } : undefined; }, [thread]);
  const ledge = useMemo(() => {
    const l = ledgeLine(escalations, rigs, said);
    const p = l.preview, on = 'rig' in p && p.rig ? ` · ${p.rig}` : '';
    const preview = p.kind === 'decision' ? t.home.decision(p.count) + on : p.kind === 'grace' ? t.home.grace + on : p.kind === 'said' ? p.text : t.home.calm;
    return { preview, ...(l.at ? { at: l.at } : {}), unread: l.unread };
  }, [escalations, rigs, said, t]);
  const left = useMemo(() => leftRows({ sessions: d.sessions, projects, rigs, escalations, openrig, ledge, t }), [d.sessions, projects, rigs, escalations, openrig, ledge, t]);
  // The focus follows its row; a row gone, the one now at its place.
  const order = useMemo(() => focusOrder(left), [left]);
  const lastOrder = useRef(order);
  useEffect(() => {
    setFocus(cur => { const next = keepFocus(order, cur, lastOrder.current); return focusKey(next) === focusKey(cur) ? cur : next; });
    lastOrder.current = order;
  }, [order]);
  const selected = focusSession(focus, left, d.byId);
  const select = useCallback((id: string | null) => setFocus(id === null ? { kind: 'ledge' } : { kind: 'session', id }), []);

  // A new request rings (bell or OSC 9); the title counts who waits.
  const seen = useRef<Map<string, Session> | null>(null);
  const titled = useRef('');
  useEffect(() => {
    if (seen.current) for (const text of asked(seen.current, d.sessions, t.notify)) write(notification(text, notify, env));
    seen.current = d.byId;
    // Written again only when it changes: every session update would otherwise send it.
    const next = title(t.notify.title(listed(d.sessions).filter(isPending).length));
    if (next !== titled.current) { titled.current = next; write(next); }
  }, [d.byId]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useActions({ client, sessions: d.sessions, errors: d.errors, t, toast });

  const go = useCallback((next: Screen) => {
    setScreen(cur => { if (next === 'help' || next === 'settings') setBack(cur === 'help' || cur === 'settings' ? 'home' : cur); return next; });
  }, []);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { saveLang(next); toast({ text: MESSAGES[next].settings.saved, tone: 'ok' }); }
    catch (e) { toast({ text: MESSAGES[next].settings.saveFailed((e as Error).message), tone: 'error' }); }
  }, [saveLang, setLangState, toast]);
  const setTheme = useCallback((next: ThemeChoice) => {
    setThemeState(next);
    try { saveTheme?.(next); toast({ text: t.settings.saved, tone: 'ok' }); }
    catch (e) { toast({ text: t.settings.saveFailed((e as Error).message), tone: 'error' }); }
  }, [saveTheme, setThemeState, toast, t]);

  const attach = useCallback((s: Session) => {
    const cmd = attachCommand(fleet, s);
    if ('why' in cmd) { toast({ text: cmd.why === 'offline' ? t.toast.offline(s.name) : cmd.why === 'omp' ? t.toast.noTerminalOmp(s.name) : t.toast.noTerminal(s.name), tone: 'info' }); return; }
    void suspendTerminal(async () => {
      const code = await (run ?? runAttached)(cmd.argv);
      // The attached program (tmux, a shell) may have set its own title: ours is written again.
      if (titled.current) write(titled.current);
      if (code !== 0) toast({ text: t.toast.attachFailed(code), tone: 'error' });
    });
  }, [fleet, suspendTerminal, run, t, toast, write]);
  const runInTerminal = useCallback((argv: string[]) => {
    void suspendTerminal(async () => {
      const code = await (run ?? runAttached)(argv);
      if (code !== 0) toast({ text: t.toast.exited(argv[0]!, code), tone: 'error' });
    });
  }, [suspendTerminal, run, t, toast]);

  const size = screenSize(useWindowSize(), env);
  const small = size.columns < MIN.columns || size.rows < MIN.rows;
  const tui: Tui = {
    client, fleet, d, machines, projects, t, lang, setLang, theme, setTheme, tone, background, g: glyphs, screen, go, focus, setFocus, selected, select, left, rigs, escalations, openrig,
    toast, lastToast, actions, editing, setEditing, small, attach, runInTerminal, env, keys, kept,
    readImage: readImage ?? (() => readClipboardImage(env)), openFile: openFile ?? (file => openImage(file, env))
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (keys.current?.(input, key)) return;
      // A draft is not lost by reflex: the first ctrl+c says so, a second one within 2 s quits. A session gone since takes
      // its draft with it: there is nowhere to send it.
      const drafts = [...kept.drafts].some(([id, x]) => x.trim() && (id === 'ask' || d.byId.has(id)));
      if (drafts && Date.now() - armed.current > QUIT_MS) {
        armed.current = Date.now();
        toast({ text: t.toast.draftQuit, tone: 'info', ms: QUIT_MS });
        return;
      }
      exit(); return;
    }
    // Too small, the field is not drawn: esc leaves it (the screen keeps the draft), or the screen.
    if (editing) { if (small && key.escape && !keys.current?.(input, key)) go('home'); return; }
    // Too small, the screen is not drawn: y, n, a… would act on a request out of view. esc and q still go.
    if (small && !key.escape && input !== 'q') return;
    if (keys.current?.(input, key)) return;
    if (input === 'q') { exit(); return; }
    if (key.escape) { go(screen === 'help' || screen === 'settings' ? back : 'home'); return; }
    if (input === '?') { go('help'); return; }
    if (input === ',') { go('settings'); return; }
    if (input === '/') { go('ask'); return; }
    if (input === '+') { go('launch'); return; }
    // 1 Ledge, 2 the rig of the selection (else the first), 3 the session chosen.
    if (input === '1') { setFocus({ kind: 'ledge' }); go('home'); return; }
    if (input === '2') {
      const mine = focus.kind === 'rig' || focus.kind === 'seat' ? order.find(f => f.kind === 'rig' && f.machine === focus.machine && f.rigId === focus.rigId)
        : selected?.rig ? order.find(f => f.kind === 'rig' && f.machine === (selected.machineId ?? 'local') && f.rigId === selected.rig!.rigId) : undefined;
      const rig = mine ?? order.find(f => f.kind === 'rig');
      if (rig) { setFocus(rig); go('home'); }
      return;
    }
    if (input === '3') { if (selected) go('session'); return; }
  });

  const Body = { home: Home, session: SessionScreen, ask: Ask, launch: Launch, settings: Settings, help: Help }[screen];
  return <TuiContext.Provider value={tui}><Body /></TuiContext.Provider>;
}
