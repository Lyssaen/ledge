import type { Messages } from '../../i18n/messages';

/** An error code of the Rig tab (OpenRig done, graph, permissions…) as text: never the raw code, but for a code nothing knows. */
export function rigErrorText(t: Messages, code: string): string {
  const o = t.openrig, r = t.ide.rigTab;
  switch (code) {
    case 'offline': return o.offline;
    case 'outdated': return o.outdated;
    case 'not_installed': return o.notInstalled;
    case 'busy': return o.busy;
    default: return r.errors[code] ?? r.policyErrors[code] ?? o.launch.errors[code] ?? o.failed(code);
  }
}
