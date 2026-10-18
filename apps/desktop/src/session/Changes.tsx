import type { JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { byFolder, nameOf, type ChangedFile } from './changedFiles';
import { Delta, FileDiffs } from './DiffView';

export interface ChangesProps {
  files: readonly ChangedFile[];
  /** The path of the file shown; null (or a path no longer there): the first one. */
  current: string | null;
  onFile(path: string): void;
  /** « Edit · tour 2 »: back to that action in the thread. */
  onTouch(toolId: string): void;
  /** The file list over the diff, on a narrow page. */
  listOpen: boolean; onListOpen(open: boolean): void;
  session: Session;
  /** Who has changed nothing yet: the subagent's kind on its page, else the session's name. */
  name?: string;
  notify(text: string): void;
}

/** The Changes view (session.tsx `changes` and `fileList`): the files the shown agent changed, grouped by folder, and the
 *  diffs of the current one, an action at a time, each going back to its action in the thread. */
export function Changes({ files, current, onFile, onTouch, listOpen, onListOpen, session, name = session.name, notify }: ChangesProps): JSX.Element {
  const { t } = useI18n();
  const tc = t.session.changes;
  if (files.length === 0) {
    return (
      <div className="changes-empty">
        <Icon d={SHELL_ICONS.diff} size={22} />
        <strong>{tc.empty}</strong>
        {/* The one place the page names the harness (the mockup): Cursor never reports its files. */}
        <p className="muted">{session.tool === 'cursor' ? tc.emptyCursor : tc.emptyBody(name)}</p>
      </div>
    );
  }
  const file = files.find(f => f.path === current) ?? files[0]!;
  const at = files.indexOf(file);
  const step = (d: 1 | -1) => onFile(files[(at + d + files.length) % files.length]!.path);
  const totals = files.reduce((s, f) => ({ plus: s.plus + f.plus, minus: s.minus + f.minus }), { plus: 0, minus: 0 });
  const copy = () => {
    // The path as the action gave it; the notice is said even where the clipboard is missing.
    try { void navigator.clipboard?.writeText(file.path).catch(() => undefined); } catch { /* the notice says it */ }
    notify(tc.copied(file.path));
  };
  return (
    <div className="changes-view">
      <div className="changes-layout">
        <nav className={cls('file-list', listOpen && 'open')} aria-label={tc.files}>
          <div className="file-list-head"><span>{tc.count(files.length)}</span><Delta {...totals} /></div>
          {byFolder(files).map(({ dir, files: fs }) => (
            <div key={dir} className="file-dir">
              <div className="dir-name mono" title={dir}><Icon d={ICONS.folder.d} size={12} />{dir}</div>
              {fs.map(f => (
                <button key={f.path} type="button" className={cls('file-row', f === file && 'current')} aria-current={f === file ? 'true' : undefined} title={f.path}
                  onClick={() => { onFile(f.path); onListOpen(false); }}>
                  <span className={`change-letter change-${f.change}`} title={tc.labels[f.change]}>{tc.letters[f.change]}</span>
                  <span className="file-name mono">{nameOf(f.shown)}</span>
                  <Delta plus={f.plus} minus={f.minus} />
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="file-pane">
          <div className="file-head">
            <button type="button" className="file-list-toggle" aria-expanded={listOpen} onClick={() => onListOpen(!listOpen)}>
              <Icon d={ICONS.folder.d} size={13} />{tc.toggle(files.length)}<Icon d={SHELL_ICONS.chevronDown} size={12} />
            </button>
            <div className="file-title">
              <span className={`change-badge change-${file.change}`}>{tc.labels[file.change]}</span>
              <code title={file.path}>{file.from !== undefined ? `${file.from} → ${file.shown}` : file.shown}</code>
              <Delta plus={file.plus} minus={file.minus} />
            </div>
            <div className="file-actions">
              <Button variant="ghost" size="sm" onClick={copy}><Icon d={SHELL_ICONS.copy} size={13} />{tc.copy}</Button>
              <span className="spacer" />
              <span className="file-pos mono">{at + 1} / {files.length}</span>
              <Button variant="outline" size="icon" aria-label={tc.prev} title={`${tc.prev} (K)`} onClick={() => step(-1)} style={{ width: 30, height: 30 }}><Icon d={ICONS.chevronLeft.d} size={14} /></Button>
              <Button variant="outline" size="icon" aria-label={tc.next} title={`${tc.next} (J)`} onClick={() => step(1)} style={{ width: 30, height: 30 }}><Icon d={ICONS.chevronRight.d} size={14} /></Button>
            </div>
            <div className="file-touches">
              <span className="muted">{file.change === 'add' ? tc.createdBy : tc.changedBy}</span>
              {file.touches.map((x, i) => (
                <button key={`${x.tool.id}:${i}`} type="button" className="touch-link" onClick={() => onTouch(x.tool.id)}>
                  {x.tool.tool} · {tc.turn(x.turn)}{x.diff && <Delta plus={x.diff.plus} minus={x.diff.minus} />}
                </button>
              ))}
              <span className="muted">{tc.seeInThread}</span>
            </div>
          </div>
          {/* Keyed by the file: another one opens at its top, its folds closed. */}
          <FileDiffs key={file.path} file={file} />
        </div>
      </div>
    </div>
  );
}
