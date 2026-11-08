import type { JSX } from 'react';
import type { RigGraph, Session } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { openClick, type NavAction } from '../../nav/state';
import { providerOf } from '../../workspace/sessionTab';
import { ProviderLogo } from '../ProviderLogo';
import { layoutOf, type TopoNode } from './model';
import '../../styles/ide-rig.css';

const KINDS = ['delegates_to', 'escalates_to', 'collaborates_with'] as const;
const NODE_W = 150, NODE_H = 44;

/** OpenRig's runtime (`claude-code`, `codex`) as a session's tool, for a seat without its session. */
const toolOf = (n: TopoNode): Session['tool'] => n.session?.tool ?? (n.runtime === 'codex' ? 'codex' : n.runtime === 'claude-code' ? 'claude' : 'omp');

export interface RigTopologyProps {
  graph: RigGraph | null; status: 'idle' | 'loading' | 'ready'; error?: string; sessions: readonly Session[]; machine: string; running: boolean; dispatch(a: NavAction): void;
}

/** The topology block of the Rig tab: pods in columns, seats as nodes, typed links as curves (docs/mockups/ledge-ide-rigs.html `topoBox`). */
export function RigTopology({ graph, status, error, sessions, machine, running, dispatch }: RigTopologyProps): JSX.Element {
  const { t } = useI18n();
  const r = t.ide.rigTab, o = t.openrig;
  const layout = graph && status === 'ready' ? layoutOf(graph, sessions, machine, running) : null;
  return (
    <section className="ide-rig-block">
      <header className="ide-rig-head"><b>{r.topology}</b><span className="ide-rig-sub">{running ? r.topologyRunning : r.topologyStopped}</span></header>
      <div className="ide-rig-body">
        {layout ? (
          <>
            <div className="ide-rig-topo">
              <div className="ide-rig-canvas" style={{ width: layout.width, height: layout.height }}>
                <svg width={layout.width} height={layout.height} aria-hidden="true">
                  <defs>
                    <marker id="ide-rig-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="ide-rig-arrow" /></marker>
                  </defs>
                  {layout.edges.map(e => <path key={`${e.from}>${e.to}:${e.kind}`} className={`ide-rig-link k-${e.kind}`} d={e.path} markerEnd="url(#ide-rig-arrow)" />)}
                </svg>
                {layout.pods.map(p => <span key={p.id} className="ide-rig-pod" style={{ left: p.x, top: 8 }}>{p.label}</span>)}
                {layout.nodes.map(n => {
                  const inner = (
                    <>
                      <i className={`ide-rig-dot d-${n.dot}`} aria-hidden="true" />
                      <ProviderLogo provider={providerOf(toolOf(n))} size={12} />
                      <span className="ide-rig-text"><b>{n.name}</b>{n.role && <small>{n.role}</small>}</span>
                    </>
                  );
                  const props = { className: `ide-rig-node${running ? '' : ' off'}${n.session ? '' : ' dim'}`, style: { left: n.x, top: n.y, width: NODE_W, height: NODE_H } };
                  return n.session
                    ? <button key={n.logicalId} type="button" {...props} aria-label={n.role ? `${n.name}, ${n.role}` : n.name} onClick={e => dispatch(openClick(n.session!.id, e))}>{inner}</button>
                    : <div key={n.logicalId} {...props}>{inner}</div>;
                })}
              </div>
            </div>
            <div className="ide-rig-legend" aria-label={r.legend}>
              {KINDS.map(k => <span key={k}><svg width="26" height="8" aria-hidden="true"><path className={`ide-rig-link k-${k}`} d="M1,4 L25,4" /></svg>{r[k]}</span>)}
            </div>
          </>
        ) : status === 'loading' ? <p className="ide-rig-empty" role="status">{r.loading}</p>
          : error ? <p className="ide-rig-empty" role="status">{error === 'offline' ? o.offline : error === 'outdated' ? o.outdated : o.failed(error)}</p>
          : <p className="ide-rig-empty" role="status">{r.loading}</p>}
      </div>
    </section>
  );
}
