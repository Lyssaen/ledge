import { useState, type JSX } from 'react';
import { PROJECT_COLORS, type Rig, type RigSpecInfo } from '@ledge/protocol';
import type { RigSpecsState } from '@ledge/fleet';
import { rigColor, runtimeLabel } from '@ledge/ui/rigs/model';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { cls } from '../shell/cls';

/** Why a machine's specs are missing, in the sidebar's words when OpenRig is down or refused. */
function specsProblem(t: ReturnType<typeof useI18n>['t'], specs: RigSpecsState, version?: string): string | null {
  if (specs.status !== 'ready') return t.rigsTab.loading;
  if (specs.error === 'openrig_down') return t.side.rigs.stopped;
  if (specs.error === 'unsupported') return t.side.rigs.unsupported(version);
  if (specs.error) return t.rigsTab.failed;
  return null;
}

/**
 * « Specs » (spec §8.2, maquette p-rigs-spec): on the left, the library (built-in and library specs) and the registry (nothing read from it
 * in this lot), each spec with its seats' addresses and « n sièges »; on the right, the chosen one (`selected`, else the first): its seats
 * (Siège · Rôle · Outil · modèle · effort · Autonomie), its file, the rigs born from it, and « Lancer ce rig… », which only opens the
 * launch window.
 */
export function RigsSpecs({ specs, selected, rigs, machine, version, dispatch }: {
  specs: RigSpecsState; selected: string | undefined; rigs: readonly Rig[]; machine: string; version?: string; dispatch: (a: NavAction) => void;
}): JSX.Element {
  const { t } = useI18n();
  const r = t.rigsTab;
  const [copied, setCopied] = useState<string | null>(null);
  const problem = specsProblem(t, specs, version);
  if (problem) return <p className="lp-none" role={specs.status === 'ready' ? 'status' : undefined}>{problem}</p>;
  const library = specs.specs.filter(s => s.source !== 'registry');
  const registry = specs.specs.filter(s => s.source === 'registry');
  const chosen = specs.specs.find(s => s.name === selected) ?? library[0] ?? registry[0];
  const item = (s: RigSpecInfo) => (
    <li key={s.id} role="option" aria-selected={s === chosen} className={cls('rs-item', s === chosen && 'sel')} tabIndex={0}
      onClick={() => dispatch({ type: 'ledge', tab: 'rigs', rigs: 'specs', spec: s.name })}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch({ type: 'ledge', tab: 'rigs', rigs: 'specs', spec: s.name }); } }}>
      <span className="rs-item-head"><span className="rc-flag" aria-hidden="true" style={{ color: PROJECT_COLORS[rigColor(s)] }}>⚑</span><strong>{s.name}</strong><span className="st-fill" /><small>{r.specSeats(s.seats.length)}</small></span>
      <span className="rs-chips">{s.seats.map(x => <code key={x.address}>{x.address}</code>)}</span>
    </li>
  );
  const born = chosen ? rigs.filter(x => !x.kernel && x.machine === machine && x.spec === chosen.name) : [];
  const copy = (path: string) => { void navigator.clipboard?.writeText(path).then(() => setCopied(path), () => {}); };
  return (
    <div className="rigs-specs">
      <div className="rs-list">
        {/* One listbox over both groups: the arrows of a single list, the groups as headings. */}
        <ul role="listbox" aria-label={r.specsList}>
          <li role="presentation" className="rs-group">{r.library}</li>
          {library.length === 0 && <li role="presentation" className="lp-none">{r.none}</li>}
          {library.map(item)}
          <li role="presentation" className="rs-group">{r.registry}</li>
          {registry.length === 0 && <li role="presentation" className="lp-none">{r.registryNone}</li>}
          {registry.map(item)}
        </ul>
      </div>
      {chosen && (
        <section className="rs-detail" aria-label={r.specOf(chosen.name)}>
          <header className="rs-detail-head">
            <div>
              <h3><span className="rc-flag" aria-hidden="true" style={{ color: PROJECT_COLORS[rigColor(chosen)] }}>⚑</span> {chosen.name}</h3>
              <p className="rs-line">{r.specLine(chosen.seats.length, r.source[chosen.source])}</p>
              {chosen.summary && <p className="rs-summary">{chosen.summary}</p>}
            </div>
            <span className="st-fill" />
            <button type="button" className="st-qa pri rs-launch"
              onClick={() => dispatch({ type: 'modal', modal: { kind: 'rig-launch', spec: chosen.name, ...(machine !== 'local' ? { machine } : {}) } })}>{r.launch}</button>
          </header>
          <h4>{r.seatsTitle}</h4>
          <table className="rs-table">
            <thead><tr><th>{r.cols.seat}</th><th>{r.cols.role}</th><th>{r.cols.tool}</th><th>{r.cols.autonomy}</th></tr></thead>
            <tbody>
              {chosen.seats.map(x => (
                <tr key={x.address}>
                  <td className="mono">{x.address}</td>
                  <td>{x.pod}</td>
                  <td>{[runtimeLabel(x.runtime), x.model, x.effort].filter(Boolean).join(' · ')}</td>
                  <td>{x.profile ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="rs-facts">
            {chosen.path && <>
              <dt>{r.file}</dt>
              <dd><code>{chosen.path}</code><button type="button" className="st-qa" onClick={() => copy(chosen.path!)}>{copied === chosen.path ? r.copied : r.copy}</button></dd>
            </>}
            <dt>{r.born}</dt>
            <dd>
              {born.length === 0 ? <span className="lp-none">{r.bornNone}</span> : (
                <ul className="rs-born">
                  {born.map(x => <li key={x.id}><span className="rc-flag" aria-hidden="true" style={{ color: PROJECT_COLORS[rigColor(x)] }}>⚑</span><span className="rs-born-name">{x.name}</span> <small>{r.lifecycle[x.lifecycle]}</small></li>)}
                </ul>
              )}
            </dd>
          </dl>
        </section>
      )}
    </div>
  );
}
