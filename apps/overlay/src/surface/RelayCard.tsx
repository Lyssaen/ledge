import type { ChatRelay, Session } from '@ledge/protocol';
import { Bot } from '../bots/Bot';
import { botState, poseFor } from '../bots/poseFor';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { toolName } from '../format';
import { useI18n } from '../i18n/lang';

export interface RelayCardProps {
  relay: ChatRelay;
  /** The target session as the snapshot has it; absent once it left the list. */
  session?: Session;
  busy: boolean; disabled: boolean; theme: 'dark' | 'light'; reducedMotion?: boolean;
  onSend: () => void; onCancel: () => void; onOpenSession: (id: string) => void;
}

type Pill = 'yours' | 'working' | 'waiting' | 'stopped';
/** The session's state as the card words it: your turn, working, waiting for you, or stopped (gone, exited, error). */
export function relayPill(s: Session | undefined): Pill {
  if (!s || s.state === 'exited' || s.state === 'error') return 'stopped';
  if (s.state === 'waiting_input' || s.state === 'waiting_permission') return 'waiting';
  return botState(s) === 'idle' ? 'yours' : 'working';
}

const muted: React.CSSProperties = { color: 'var(--muted-foreground)' };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' };
const foot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--sidebar-border)' };
const small: React.CSSProperties = { height: 28, padding: '0 10px', gap: 6, fontSize: 12 };

/** The instruction the chat proposes to send (spec 2026-10-12 relay §6): proposed, queued, sent, or failed with a retry. Sending is the user's click. */
export function RelayCard(p: RelayCardProps) {
  const { t, lang } = useI18n(); const c = t.chat.relay; const r = p.relay; const s = p.session;
  const state = r.status === 'sent' ? 'sent' : r.status === 'queued' ? 'queued' : r.error !== undefined ? 'failed' : 'proposed';
  const pill = relayPill(s);
  const bot = (size: number) => <Bot seed={r.id} tool={r.tool} state={s ? botState(s) : 'done'} pose={poseFor(r.id, s?.state ?? 'exited')} size={size} theme={p.theme} reducedMotion={p.reducedMotion} />;
  const name = <a href={`ledge://session/${r.id}`} onClick={e => { e.preventDefault(); p.onOpenSession(r.id); }} style={{ fontWeight: 600, color: 'inherit' }}>{r.name}</a>;
  const time = r.sentAt ? new Date(r.sentAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <section data-relay-card={state} aria-label={c.label} style={{ border: '1px solid var(--sidebar-border)', borderRadius: 'var(--radius-md)', background: 'var(--well)', overflow: 'hidden', fontSize: 12.5, lineHeight: '18px' }}>
      {state === 'sent' ? (
        <div style={row}>{bot(20)}<span style={{ flex: 1, minWidth: 0 }}>{c.sentTo} {name} · {time}</span></div>
      ) : (
        <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', padding: '10px 12px', alignItems: 'center' }}>
            <dt style={muted}>{c.session}</dt>
            <dd style={{ margin: 0, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              {bot(24)}
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{r.name}</strong>
                {s && <span style={{ ...muted, display: 'block', fontSize: 11.5 }}>{toolName(r.tool)} · {s.repo ?? s.project}{s.branch && <> <code>{s.branch}</code></>}</span>}
              </span>
              <span data-pill={pill} style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, border: '1px solid var(--sidebar-border)', ...muted }}>{c.pill[pill]}</span>
            </dd>
            <dt style={muted}>{c.instruction}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}><blockquote style={{ margin: 0, paddingLeft: 8, borderLeft: '2px solid var(--sidebar-border)' }}>{r.text}</blockquote></dd>
          </dl>
          {state === 'failed' && <div role="alert" style={{ padding: '6px 12px', color: 'var(--destructive)', background: 'color-mix(in srgb, var(--destructive) 12%, transparent)' }}>{c.failed(r.error!)}</div>}
          {state === 'queued' ? (
            <div style={foot}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--primary)', animation: p.reducedMotion ? undefined : 'ledge-pulse 1.4s ease-in-out infinite' }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}><strong>{r.name}</strong> {c.queued}</span>
              <Button variant="outline" size="sm" disabled={p.busy || p.disabled} onClick={p.onCancel} style={small}>{c.cancel}</Button>
            </div>
          ) : (
            <div style={foot}>
              <Button variant="primary" size="sm" disabled={p.busy || p.disabled} onClick={p.onSend} style={small}>
                {state === 'proposed' && <Icon size={12} {...ICONS.send} />}{p.busy ? c.sending : state === 'failed' ? c.retry : c.send}
              </Button>
              <span style={{ ...muted, fontSize: 12 }}>{c.orRephrase}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
