import type { Messages } from '../i18n/messages';

/** The copy native mode shows (Windows without WSL): the same strings, with the ones that speak of WSL replaced by their
 *  `nativeCopy` version. */
export function withNativeCopy(m: Messages): Messages {
  const n = m.nativeCopy;
  const mc = m.settings.machines;
  return {
    ...m,
    daemonOutdated: { ...m.daemonOutdated, body: n.daemonOutdated },
    settings: { ...m.settings, machines: { ...mc, noteLead: n.noteLead, localKind: n.localKind, aliasHint: n.aliasHint,
      checklist: [n.checklist0, ...mc.checklist.slice(1)], problem: { ...mc.problem, alias: n.alias, key: n.key, hostKey: n.hostKey } } },
    session: { ...m.session, terminal: { ...m.session.terminal, local: n.terminalLocal } },
  };
}
