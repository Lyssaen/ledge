import type { ChatTeamProposal } from '@ledge/protocol';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { useChatCopy } from './copy';
import { toolName } from './format';

export interface TeamCardProps {
  team: ChatTeamProposal;
  busy: boolean; disabled: boolean;
  /** « Lancer l'équipe », « Enregistrer » (an ad hoc team as a template), « Ouvrir la table » once launched. */
  onLaunch: () => void; onSave?: () => void; onOpenTable?: (teamId: string) => void;
  /** The launch time as the front words it (« 23:10 »). */
  at?: (iso: string) => string;
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11.5, color: 'var(--muted-foreground)', overflowWrap: 'anywhere' };
const pill: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11, padding: '0 6px', borderRadius: 999, background: 'color-mix(in srgb, var(--sidebar-primary) 16%, transparent)' };

/**
 * A team Ledge proposes (roles spec §3.8): its name, folder and table, every seat with its role, agent, model, effort and
 * autonomy, and a warning when a seat may act without asking. It keeps its outcome: « ✓ Équipe lancée à 23:10 · Ouvrir la table ».
 */
export function TeamCard(p: TeamCardProps) {
  const c = useChatCopy().chat.team!;
  const tm = p.team;
  const launched = tm.teamId !== undefined && tm.error === undefined;
  const auto = tm.seats.filter(s => s.autonomy === 'auto');
  return (
    <section data-team-card={launched ? 'launched' : tm.error !== undefined ? 'failed' : 'proposed'} aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '10px 12px 0' }}>
        <span aria-hidden style={{ color: 'var(--sidebar-primary)' }}>⚑</span>
        <strong style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{tm.name}</strong>
        {tm.template && <span style={muted}>{c.template(tm.template)}</span>}
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', padding: '8px 12px 10px' }}>
        <dt style={muted}>{c.folder}</dt><dd style={{ margin: 0, minWidth: 0 }}><span style={mono}>{tm.cwd}</span></dd>
        <dt style={muted}>{c.table(tm.projectName ?? tm.project)}</dt><dd style={{ margin: 0 }}>{c.newTable(tm.projectName ?? tm.project)}</dd>
        <dt style={muted}>{c.seats}</dt>
        <dd style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tm.seats.map(s => (
            <span key={s.role} data-seat={s.role} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <span style={pill}>@{s.role}</span><span>{s.label}</span>
              <span style={muted}>{[toolName(s.tool), s.model, s.effort].filter(Boolean).join(' · ')}</span>
              <span style={{ ...muted, ...(s.autonomy === 'auto' ? { color: 'var(--warning, #d97706)' } : {}) }}>{c.autonomy[s.autonomy ?? 'ask']}</span>
            </span>
          ))}
        </dd>
      </dl>
      {auto.length > 0 && !launched && <div role="note" data-autonomy-warning style={{ padding: '6px 12px', color: 'var(--warning, #b45309)', background: 'color-mix(in srgb, var(--warning, #d97706) 12%, transparent)' }}>{c.autoWarning(auto.map(s => `@${s.role}`).join(', '))}</div>}
      {tm.error !== undefined && <div role="alert" style={{ padding: '6px 12px', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 12%, transparent)' }}>{c.failed(tm.error)}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' }}>
        {launched ? (
          <>
            <span style={{ flex: 1 }}>✓ {c.launched(p.at ? p.at(tm.launchedAt!) : tm.launchedAt!)}</span>
            {p.onOpenTable && <Button variant="outline" size="sm" onClick={() => p.onOpenTable!(tm.teamId!)} style={{ height: 26, padding: '0 10px', fontSize: 12 }}>{c.openTable}</Button>}
          </>
        ) : (
          <Button variant="primary" size="sm" disabled={p.busy || p.disabled || (tm.teamId !== undefined)} onClick={p.onLaunch} style={{ height: 28, padding: '0 10px', gap: 6, fontSize: 12 }}>
            <Icon size={12} {...ICONS.rocket} />{p.busy ? c.launching : tm.error !== undefined && tm.teamId === undefined ? c.retry : c.launch}
          </Button>
        )}
        {!tm.template && p.onSave && (tm.savedPath ? <span style={{ ...muted, fontSize: 12 }}>{c.saved(tm.savedPath)}</span>
          : <Button variant="ghost" size="sm" disabled={p.disabled} onClick={p.onSave} style={{ height: 26, padding: '0 8px', fontSize: 12 }}>{c.save}</Button>)}
      </div>
    </section>
  );
}
