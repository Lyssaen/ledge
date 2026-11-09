import { useMemo, useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { useScreenKeys } from '../nav/screenKeys';
import { changedFiles, findFile } from './changedFiles';
import { Changes } from './Changes';
import { useThread } from './useThread';

export interface ChangesTabProps {
  client: DaemonClient; session: Session; notify(text: string): void;
  /** An action clicked (« Edit · tour 2 »): the session's tab comes forward (R10); the action is not lit. */
  onTouch(): void;
}

/** An IDE « Modifications · <name> » tab (opened by « +N −N », beside its session): the files the session changed and
 *  their diffs, as the right panel's Modifications shows them, read from the session's own thread. */
export function ChangesTab({ client, session, notify, onTouch }: ChangesTabProps): JSX.Element {
  const { t } = useI18n();
  const items = useThread(client, session);
  const files = useMemo(() => (items ? changedFiles(items, session.cwd) : []), [items, session.cwd]);
  const [file, setFile] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const current = (file === null ? undefined : findFile(files, file, session.cwd)) ?? files[0];
  // The tab's keys, as the session page's panel had them (its buttons still say J and K): J / K walk the files (a held key moves
  // one), Escape closes the narrow file list.
  useScreenKeys(e => {
    if (e.key === 'Escape' && listOpen) { setListOpen(false); return true; }
    const k = e.key.toLowerCase();
    if ((k !== 'j' && k !== 'k') || files.length === 0) return false;
    if (e.repeat) return true;
    const at = Math.max(0, files.findIndex(f => f.path === current?.path));
    setFile(files[(at + (k === 'j' ? 1 : -1) + files.length) % files.length]!.path);
    return true;
  });
  if (items === undefined) {
    return <div className="ide-changes changes-empty"><p className="muted">{session.offline ? t.session.thread.notLoaded : t.session.thread.loading}</p></div>;
  }
  return (
    <div className="ide-changes">
      <Changes files={files} current={current?.path ?? null} onFile={setFile} onTouch={onTouch} listOpen={listOpen} onListOpen={setListOpen}
        session={session} notify={notify} />
    </div>
  );
}
