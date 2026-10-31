import { useEffect, useState, type CSSProperties } from 'react';
import type { ChatProposal, ChatTurn, Session } from '@ledge/protocol';
import { Button } from '../../../packages/ui/src/ui/Button';
import { Icon, ICONS } from '../../../packages/ui/src/ui/icons';
import { useChatCopy } from '../../../packages/ui/src/chat/copy';
import { HarnessBot, HARNESS_LABELS, type PreviewTool } from './harness';
import { ModelPick, type ModelChoice } from './model-pick';

export type PreviewProposal = Omit<ChatProposal, 'tool'> & {
  tool: PreviewTool;
  count?: number;
  outdated?: boolean;
  launches?: { id: string; name: string; model?: string; effort?: string }[];
};
export type PreviewTurn = Omit<ChatTurn, 'proposal'> & { proposal?: PreviewProposal };

export interface LaunchCardProps {
  proposal: PreviewProposal;
  session?: Session;
  qid?: string;
  busy: boolean;
  disabled: boolean;
  theme?: 'dark' | 'light';
  reducedMotion?: boolean;
  onLaunch: (pick: ModelChoice) => void;
  onOpenSession: (id: string) => void;
  onTerminal: (id: string) => void;
}

const muted: CSSProperties = { color: 'var(--muted-foreground)' };
const mono: CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--muted-foreground)', overflowWrap: 'anywhere' };
const defaultPick = (): ModelChoice => ({ model: null, effort: null });

/** Preview adaptation of the shared LaunchCard; the parent records launches locally, never sends commands. */
export function LaunchCard(p: LaunchCardProps) {
  const c = useChatCopy().chat.card;
  const pr = p.proposal;
  const [pick, setPick] = useState<ModelChoice>(defaultPick);
  const [outdatedOverride, setOutdatedOverride] = useState<boolean | null>(null);
  const outdated = outdatedOverride ?? pr.outdated ?? false;
  useEffect(() => { if (outdated) setPick(defaultPick()); }, [outdated]);
  const launches = pr.launches?.length ? pr.launches : pr.launchedId !== undefined
    ? [{ id: pr.launchedId, name: p.session?.name ?? c.startedUnknown, model: pick.model ?? undefined, effort: pick.effort ?? undefined }]
    : [];
  const state = launches.length ? 'launched' : pr.error !== undefined ? 'failed' : 'proposed';
  const blocked = p.busy || p.disabled;
  // This receipt illustrates #62's proposed fields; it is not a command accepted/sent by the current daemon.
  const receipts = launches.map(launch => ({
    type: 'session.launch', ...(p.qid ? { qid: p.qid } : {}), tool: pr.tool, cwd: pr.cwd,
    ...(pr.prompt ? { prompt: pr.prompt } : {}),
    ...(launch.model ? { model: launch.model } : {}), ...(launch.effort ? { effort: launch.effort } : {}),
  }));
  return (
    <section data-launch-card={state} aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      <div style={{ ...muted, padding: '8px 12px 0', fontSize: 11 }}>Simulation · aucun appel au daemon</div>
      {state === 'launched' ? (
        <>
          {launches.map(launch => (
            <div key={launch.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
              <HarnessBot tool={pr.tool} state="idle" pose={1} size={24} theme={p.theme ?? 'dark'} seed={launch.id} reducedMotion={p.reducedMotion} />
              <span style={{ flex: 1, minWidth: 100 }}>
                <a href={`ledge://session/${launch.id}`} onClick={e => { e.preventDefault(); p.onOpenSession(launch.id); }} style={{ fontWeight: 600, color: 'inherit' }}>{launch.name}</a> {c.started}
                <span style={{ ...muted, display: 'block', fontSize: 11, overflowWrap: 'anywhere' }}>{HARNESS_LABELS[pr.tool]}{pr.tool === 'omp' ? ' · natif' : ''} · {launch.model ?? 'Modèle par défaut'} · {launch.effort ?? 'Effort par défaut'}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => p.onOpenSession(launch.id)} style={{ height: 26, padding: '0 10px', fontSize: 12 }}>Ouvrir</Button>
              <Button variant="outline" size="sm" onClick={() => p.onTerminal(launch.id)} style={{ height: 26, padding: '0 10px', fontSize: 12 }}>{pr.tool === 'omp' ? 'Shell libre' : c.terminal}</Button>
            </div>
          ))}
          {p.qid && <details style={{ padding: '0 12px 10px', fontSize: 11 }}>
            <summary style={{ ...mono, cursor: 'pointer' }}>Reçu simulé · qid {p.qid}</summary>
            <p style={muted}>Contrat proposé #62 · {receipts.length} lancement{receipts.length > 1 ? 's' : ''} · non envoyé.</p>
            <pre style={{ ...mono, whiteSpace: 'pre-wrap', margin: 0 }}>{receipts.map(receipt => JSON.stringify(receipt, null, 2)).join('\n')}</pre>
          </details>}
        </>
      ) : (
        <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', padding: '10px 12px' }}>
            <dt style={muted}>{c.folder}</dt><dd style={{ margin: 0, minWidth: 0 }}><strong>{pr.project}</strong> <span style={mono}>{pr.cwd}</span></dd>
            <dt style={muted}>{c.tool}</dt><dd style={{ margin: 0, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}><HarnessBot tool={pr.tool} state="idle" pose={1} size={24} theme={p.theme ?? 'dark'} seed={p.qid ?? pr.cwd} reducedMotion={p.reducedMotion} /><span>{HARNESS_LABELS[pr.tool]}{pr.tool === 'omp' ? ' · natif' : ''}</span><ModelPick tool={pr.tool} pick={pick} onPick={setPick} disabled={blocked} outdated={outdated} /></dd>
            <dt style={muted}>{c.prompt}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{pr.prompt ?? <span style={muted}>{c.noPrompt}</span>}</dd>
            {(pr.count ?? 1) > 1 && <><dt style={muted}>Agents</dt><dd style={{ margin: 0 }}>{pr.count} · défini par la demande</dd></>}
          </dl>
          <details style={{ padding: '0 12px 10px', fontSize: 11 }}>
            <summary style={{ ...muted, cursor: 'pointer' }}>Scénarios de la maquette</summary>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, paddingTop: 8 }}>
            <label style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <input type="checkbox" checked={outdated} disabled={blocked} onChange={e => { setOutdatedOverride(e.target.checked); setPick(defaultPick()); }} />
              Simuler un daemon ancien
            </label>
            {outdated && <span style={{ ...muted, fontSize: 11 }}>Contrôle masqué · modèle et effort par défaut au lancement.</span>}
            {p.qid && <span style={mono}>qid {p.qid}</span>}
            </div>
          </details>
          {state === 'failed' && <div role="alert" style={{ padding: '6px 12px', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 12%, transparent)' }}>{c.failed(pr.error!)}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
            <Button variant="primary" size="sm" disabled={blocked} onClick={() => p.onLaunch(outdated ? defaultPick() : pick)} style={{ height: 28, padding: '0 10px', gap: 6, fontSize: 12 }}>
              {state === 'proposed' && <Icon size={12} {...ICONS.rocket} />}{p.busy ? c.launching : state === 'failed' ? c.retry : c.launch}
            </Button>
            <span style={{ ...muted, fontSize: 12 }}>{state === 'failed' ? c.orFolder : c.orRephrase}</span>
          </div>
        </>
      )}
    </section>
  );
}
