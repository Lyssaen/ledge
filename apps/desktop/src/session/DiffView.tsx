import { Fragment, useMemo, useState, type JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import type { ChangedFile } from './changedFiles';
import { diffRows, type DiffLine, type ParsedDiff } from './diff';

/** Lines added and removed (session.tsx Delta). */
export function Delta({ plus, minus }: { plus: number; minus: number }): JSX.Element {
  return <span className="delta mono"><span className="plus">+{plus}</span><span className="minus">−{minus}</span></span>;
}

/** One line of a diff (session.tsx Line), a row of the table: its old and new numbers when the hunk is numbered (left out
 *  for a screen reader), its sign (said « ajouté » / « supprimé »), its text. */
function Line({ l, signs }: { l: DiffLine; signs: { add: string; del: string } }): JSX.Element {
  const said = l.t === 'add' ? signs.add : l.t === 'del' ? signs.del : undefined;
  return (
    <div className={`diff-line ${l.t}`} role="row">
      <span className="ln" aria-hidden="true">{l.o ?? ''}</span><span className="ln" aria-hidden="true">{l.n ?? ''}</span>
      <span className="sign" role="cell" {...(said !== undefined ? { 'aria-label': said } : {})}>{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
      <span className="code" role="cell">{l.text || ' '}</span>
    </div>
  );
}

/** A diff (session.tsx DiffView): its hunks, the gaps between numbered hunks, the long unchanged runs folded until asked for.
 *  Keyed by its file where it is shown, so what was unfolded starts over with another file. */
export function DiffView({ diff }: { diff: ParsedDiff }): JSX.Element {
  const { t } = useI18n();
  const tc = t.session.changes;
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => diffRows(diff, shown), [diff, shown]);
  return (
    <div className="diff-view mono" role="table" aria-label={tc.diff}>
      {rows.map((r, i) => {
        if (r.kind === 'line') return <Line key={i} l={r.line} signs={tc.signs} />;
        // An unnumbered Codex hunk has only its context: no empty label before it (a row holds a cell all the same).
        if (r.kind === 'hunk') {
          return (
            <div key={i} className="diff-hunk mono" role="row">
              {r.label || !r.ctx ? <span role="cell">{r.label}</span> : null}{r.ctx && <span className="hunk-ctx" role="cell">{r.ctx}</span>}
            </div>
          );
        }
        if (r.kind === 'gap') return <div key={i} className="diff-gap" role="row"><span role="cell">{tc.gap(r.to - r.from + 1, r.from, r.to)}</span></div>;
        return (
          <div key={i} role="row">
            <div role="cell">
              <button type="button" className="diff-fold" onClick={() => setShown(s => new Set(s).add(r.key))}>
                <Icon d={SHELL_ICONS.unfold} size={12} />{tc.unfold(r.hidden)}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A file's diffs as its actions left them, in order (the Changes view and the side pane): a header per action when there are
 *  several, the cut ones said so; no diff at all, « no recorded difference ». Keyed by its file where it is shown. */
export function FileDiffs({ file }: { file: ChangedFile }): JSX.Element {
  const { t } = useI18n();
  const tc = t.session.changes;
  const many = file.touches.length > 1;
  return (
    <div className="diff-scroll">
      {file.touches.every(x => x.diff === null) ? <p className="muted" style={{ padding: 20 }}>{tc.noDiff}</p> : file.touches.map((x, i) => (
        <Fragment key={`${x.tool.id}:${i}`}>
          {many && <div className="diff-hunk touch-head mono">{x.tool.tool} · {tc.turn(x.turn)}</div>}
          {x.diff ? <DiffView diff={x.diff} /> : <p className="muted diff-none">{tc.noTouchDiff}</p>}
          {x.diff?.cut && <p className="muted diff-cut">{tc.cut}</p>}
        </Fragment>
      ))}
    </div>
  );
}
