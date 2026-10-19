import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { projectOf, useProjects, type DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { MarkdownLinks } from '@ledge/ui/documents/links';
import '@ledge/ui/documents/markdown.css';
import { LangProvider, loadLang, useI18n, type Lang } from '../i18n/lang';
import { useFleet } from '../fleet/useFleet';
import { openUrl } from '../tauri/bridge';
import { useAppearance } from '../shell/theme';
import { initialNav, navReducer, type NavAction } from '../nav/state';
import { loadOverview } from '../nav/overview';
import { ScreenKeysContext, type ScreenKeys } from '../nav/screenKeys';
import { mainOrder } from '../nav/agents';
import { useKeys } from '../nav/useKeys';
import { Toast, useToast } from '../shell/Toast';
import { WindowCaps } from '../shell/WindowCaps';
import { useSessionActions } from '../manage/useSessionActions';
import { useSessionMenu } from '../manage/useSessionMenu';
import { SessionMenuHost } from '../manage/SessionMenu';
import { ConfirmDialog } from '../manage/ConfirmDialog';
import { Atelier } from './Atelier';
import { useFiling } from './filing';
import { closeAtelierWindow, toMain, watchAtelierWindow } from './detach';

/** What the detached Atelier keeps for itself: its filter, the subagents shown, the animations; the rest (a session, a
 *  dialog, the chat, Settings) is the main window's. */
const STAYS: ReadonlySet<NavAction['type']> = new Set(['home', 'filter', 'helpers', 'paused', 'escape']);

/** The detached Atelier's window bar (#30), in place of Windows' own and as high as the main window's: the word mark,
 *  « Atelier », « Rattacher » and the window buttons; its × gives the Atelier back as « Rattacher » does. The bar and its gaps
 *  are the drag region, a double click maximises or restores. Behind a confirmation only the window buttons stay live. */
function AtelierBar({ blocked }: { blocked: boolean }) {
  const { t } = useI18n();
  const drag = { 'data-tauri-drag-region': '' } as const;
  return (
    <div className="titlebar" role="group" aria-label={t.titlebar.label} {...drag}>
      <div className="titlebar-left" {...drag}>
        <span className="titlebar-mark" data-brand {...drag}>Ledge<span className="brand-dot">.</span></span>
        <span className="titlebar-place" {...drag}>{t.side.atelier}</span>
      </div>
      <div className="titlebar-mid" {...drag} />
      <div className="titlebar-right" {...drag}>
        <div className="titlebar-tools" inert={blocked}>
          <button className="titlebar-text" disabled={blocked} title={t.detached.attachTitle} onClick={closeAtelierWindow}>{t.detached.attach}</button>
        </div>
        <WindowCaps onClose={closeAtelierWindow} />
      </div>
    </div>
  );
}

/** The detached Atelier's window (#21): the Atelier alone, live on its own connection to the daemon; what it opens shows in
 *  the main window. Its menus, filing and confirmations work here; no tray, no sounds, no updater (the main window has them). */
function AtelierAlone({ client }: { client?: DaemonClient }) {
  const fleetView = useFleet(client);
  const { sessions, machines, fleet, client: fleetClient, errors } = fleetView;
  const projects = useProjects(fleetClient);
  const [nav, local] = useReducer(navReducer, undefined, () => initialNav(loadOverview()));
  const dispatch = useCallback((a: NavAction) => { if (STAYS.has(a.type)) local(a); else if (a.type !== 'fullscreen') toMain(a); }, []);
  useEffect(watchAtelierWindow, []);
  const projectIdOf = useCallback((s: Session) => (projects ? projectOf(s, projects) : null), [projects]);
  const order = useMemo(() => mainOrder(sessions, projects), [sessions, projects]);
  const { notice, action: noticeAction, notify, undo } = useToast();
  const filing = useFiling({ fleet, projects, sessions, projectIdOf, notify });
  const actions = useSessionActions({ client: fleetClient, sessions, archived: fleetView.archived, machines, errors, notify });
  const sessionMenu = useSessionMenu({ client: fleetClient, sessions, notify });
  const screenKeys = useRef<ScreenKeys>({ current: null }).current;
  useKeys(dispatch, { state: nav, order, screen: screenKeys, undo, confirming: actions.pending ? { cancel: actions.cancel } : null });
  const blocked = actions.pending !== null || sessionMenu.renaming !== null;
  return (
    <ScreenKeysContext.Provider value={screenKeys}>
      <AtelierBar blocked={blocked} />
      <div className={`application atelier-alone ${filing.dragging ? 'is-dragging' : ''}`} inert={blocked}>
        <section className="workspace">
          <Atelier nav={nav} dispatch={dispatch} sessions={sessions} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} actions={actions} menu={sessionMenu} />
        </section>
      </div>
      <SessionMenuHost state={sessionMenu} actions={actions} filing={filing} projects={projects?.projects ?? []} currentOf={projectIdOf} onOpen={s => dispatch({ type: 'open', id: s.id })} />
      {actions.pending && <ConfirmDialog c={actions.pending} onConfirm={actions.confirm} onCancel={actions.cancel} />}
      <Toast notice={notice} action={noticeAction} onAction={undo} />
    </ScreenKeysContext.Provider>
  );
}

/** The detached window's app: the language the boot settled on; a change made in the main window shows at its next opening. */
export function AtelierApp({ client, lang: booted }: { client?: DaemonClient; lang?: Lang } = {}) {
  const [lang] = useState<Lang>(() => booted ?? loadLang());
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useAppearance();
  return <LangProvider lang={lang}><MarkdownLinks.Provider value={openUrl}><AtelierAlone client={client} /></MarkdownLinks.Provider></LangProvider>;
}
