import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useInput, useStdout, useWindowSize } from 'ink';
import { isPending, useDaemon, useMachines, useProjects, useTasks, useTeams, type DaemonClient, type Fleet } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useActions, type Toast } from './actions.js';
import { attachCommand, runAttached } from './attach.js';
import { SCREENS, TuiContext, type Kept, type KeyHandler, type Screen, type Tui } from './context.js';
import type { Glyphs } from './glyphs.js';
import { I18nProvider, MESSAGES, type Lang } from './i18n/lang.js';
import { keepSelection, listed, overview } from './model/overview.js';
import { asked, notification, title, type NotifyMode } from './notify.js';
import { Overview } from './screens/Overview.js';
import { SessionScreen } from './screens/Session.js';
import { Ask } from './screens/Ask.js';
import { Launch } from './screens/Launch.js';
import { Settings } from './screens/Settings.js';
import { Help } from './screens/Help.js';
import { MIN } from './ui/Frame.js';

/** How long a toast stays. */
export const TOAST_MS = 5000;
/** ctrl+c with a draft quits only when pressed again within this. */
export const QUIT_MS = 2000;

export interface AppProps {
  client: DaemonClient;
  lang: Lang;
  /** Saves the language; throws when it cannot (the choice still applies for this run). */
  saveLang(lang: Lang): void;
  notify: NotifyMode;
  glyphs: Glyphs;
  env: NodeJS.ProcessEnv;
  /** Test hook: runs an attach command (the real one hands the terminal over to it). */
  run?: (argv: string[]) => Promise<number>;
}

export function App(props: AppProps) {
  const [lang, setLangState] = useState<Lang>(props.lang);
  return <I18nProvider lang={lang}><Shell {...props} lang={lang} setLang={setLangState} /></I18nProvider>;
}

function Shell({ client, lang, setLang: setLangState, saveLang, notify, glyphs, env, run }: AppProps & { setLang(l: Lang): void }) {
  const { exit, suspendTerminal } = useApp();
  // Escape sequences that print nothing (bell, OSC 9, title) go straight to the terminal, not through Ink's frame.
  const { stdout } = useStdout();
  const write = useCallback((seq: string) => { if (seq) stdout.write(seq); }, [stdout]);
  const d = useDaemon();
  const machines = useMachines(client);
  const projects = useProjects(client);
  const teams = useTeams(client);
  const tasks = useTasks(client);
  const fleet = client.fleet as Fleet;
  const t = MESSAGES[lang];
  const [screen, setScreen] = useState<Screen>('overview');
  const [back, setBack] = useState<Screen>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastToast, setToast] = useState<Toast | null>(null);
  const [editing, setEditingState] = useState(false);
  const keys = useRef<KeyHandler | null>(null);
  const kept = useRef<Kept>({ drafts: new Map(), sent: new Map() }).current;
  // When ctrl+c was last pressed with a draft waiting.
  const armed = useRef(0);

  useEffect(() => {
    if (!lastToast) return;
    const timer = setTimeout(() => setToast(null), lastToast.ms ?? TOAST_MS);
    return () => clearTimeout(timer);
  }, [lastToast]);
  const toast = useCallback((x: Toast) => setToast(x), []);
  const setEditing = useCallback((on: boolean) => setEditingState(on), []);

  // The selection follows its session; the first one waiting for the user is chosen at start.
  const view = useMemo(() => overview(d.sessions, projects, teams ?? [], tasks), [d.sessions, projects, teams, tasks]);
  const order = useRef<string[]>([]);
  useEffect(() => {
    setSelectedId(cur => cur === null && view.yours[0] ? view.yours[0].id : keepSelection(view.order, cur, order.current));
    order.current = view.order;
  }, [view]);
  const selected = (selectedId ? d.byId.get(selectedId) : undefined) ?? null;

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
    setScreen(cur => { if (next === 'help' || next === 'settings') setBack(cur === 'help' || cur === 'settings' ? 'overview' : cur); return next; });
  }, []);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { saveLang(next); toast({ text: MESSAGES[next].settings.saved, tone: 'ok' }); }
    catch (e) { toast({ text: MESSAGES[next].settings.saveFailed((e as Error).message), tone: 'error' }); }
  }, [saveLang, setLangState, toast]);

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

  const tui: Tui = {
    client, fleet, d, machines, projects, t, lang, setLang, g: glyphs, screen, go, selected, select: setSelectedId,
    toast, lastToast, actions, editing, setEditing, attach, keys, kept
  };

  const size = useWindowSize();
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
    if (editing) return;
    // Too small, the screen is not drawn: y, n, a… would act on a request out of view. esc and q still go.
    if ((size.columns < MIN.columns || size.rows < MIN.rows) && !key.escape && input !== 'q') return;
    if (keys.current?.(input, key)) return;
    if (input === 'q') { exit(); return; }
    if (key.escape) { go(screen === 'help' || screen === 'settings' ? back : 'overview'); return; }
    if (input === '?') { go('help'); return; }
    if (input === ',') { go('settings'); return; }
    if (input === '/') { go('ask'); return; }
    if (input === '+') { go('launch'); return; }
    if (/^[1-5]$/.test(input)) { go(SCREENS[Number(input) - 1]!); return; }
  });

  const Body = { overview: Overview, session: SessionScreen, ask: Ask, launch: Launch, settings: Settings, help: Help }[screen];
  return <TuiContext.Provider value={tui}><Body /></TuiContext.Provider>;
}
