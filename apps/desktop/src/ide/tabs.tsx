import type { ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import type { Messages } from '../i18n/messages';
import { parseRigRef } from './rig/model';
import { sessionOf, type Tab } from '../workspace/model';

/** What a tab's content is: given by Shell (SessionPlace with tabNav, Atelier, SettingsPlace, OpenRigPage). */
export type TabBody = (tab: Tab) => ReactNode;

/** A tab's title (mockup `tabLabel()`): the session's name, « Atelier », « Réglages », « OpenRig · <machine> », « >_ <shell> ». A session
 *  not (or no longer) known keeps its ref; a machine without a label, its id. */
export function tabTitle(t: Tab, ctx: { session(id: string): Session | undefined; t: Messages; machine?(id: string): string | undefined; shell?(id: string): string | undefined }): string {
  switch (t.kind) {
    case 'session': case 'seat': return ctx.session(t.ref)?.name ?? t.ref;
    case 'atelier': return ctx.t.side.atelier;
    case 'settings': return ctx.t.side.settings;
    case 'openrig': return ctx.t.ide.openrigTitle(ctx.machine?.(t.ref) ?? t.ref);
    case 'rig': { const r = parseRigRef(t.ref); return r ? ctx.t.ide.rigTab.title(r.rig, r.machine === 'local' ? undefined : ctx.machine?.(r.machine) ?? r.machine) : t.ref; }
    case 'changes': return ctx.t.ide.changesTitle(ctx.session(t.ref)?.name ?? t.ref);
    case 'terminal': {
      // A bottom-panel shell's: « >_ WSL 1 » (the store's title, its id once closed).
      if (t.ref.startsWith('shell:')) return ctx.t.ide.panel.shellTitle(ctx.shell?.(t.ref) ?? t.ref);
      const sid = sessionOf(t);
      return sid === null ? t.ref : ctx.t.ide.terminalTitle(ctx.session(sid)?.name ?? sid);
    }
    case 'atoi': return ctx.t.ide.atoi;
    default: return t.ref;
  }
}
