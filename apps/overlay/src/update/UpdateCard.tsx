import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ResidentMascot } from '../bots/ResidentMascot';
import { Button } from '../ui/Button';
import { NOTICE_GAP } from '../surface/SessionList';
import { useI18n } from '../i18n/lang';
import type { CardView } from './machine';

export interface UpdateCardProps {
  view: Exclude<CardView, { kind: 'hidden' }>;
  /** Live sessions, for the « they keep running » line. */
  sessions: number;
  onUpdate: () => void; onLater: () => void; onRetry: () => void; onAck: () => void; onNotes: () => void;
}

type Tone = 'info' | 'success' | 'danger' | 'warning';
const TONE: Record<Tone, { fg: string; soft: string }> = {
  info: { fg: 'var(--info)', soft: 'var(--status-info-soft)' },
  success: { fg: 'var(--success)', soft: 'var(--status-success-soft)' },
  danger: { fg: 'var(--danger-text)', soft: 'var(--status-danger-soft)' },
  warning: { fg: 'var(--warning)', soft: 'var(--status-warning-soft)' }
};

const sub: CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' };

/** A command on one scrolling line with a copy button (the copy error is ignored: the text is selectable anyway). */
function Command({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void Promise.resolve(navigator.clipboard?.writeText(text)).then(() => {
      setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 6px 6px 10px', border: '1px solid var(--input)', borderRadius: 8, background: 'var(--sidebar)' }}>
      <code className="mono" data-command style={{ flex: 1, minWidth: 0, overflowX: 'auto', whiteSpace: 'nowrap', fontSize: 11, lineHeight: '15px' }}>{text}</code>
      <Button variant="ghost" size="sm" onClick={copy} style={{ height: 24, padding: '0 8px', fontSize: 12 }}>{copied ? t.update.copied : t.update.copy}</Button>
    </div>
  );
}

function Dot({ status }: { status: 'done' | 'run' | 'todo' }) {
  const base: CSSProperties = { width: 14, height: 14, borderRadius: '50%', boxSizing: 'border-box', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700 };
  if (status === 'done') return <span aria-hidden="true" style={{ ...base, background: 'var(--status-success-soft)', color: 'var(--success)' }}>✓</span>;
  if (status === 'run') return <span aria-hidden="true" className="ledge-spin" style={{ ...base, border: '2px solid var(--info)', borderRightColor: 'transparent' }} />;
  return <span aria-hidden="true" style={{ ...base, border: '1.5px solid var(--input)' }} />;
}

/** The update, as a card between the list's header and its rows (mockup docs/mockups/ledge-update.html). */
export function UpdateCard({ view, sessions, onUpdate, onLater, onRetry, onAck, onNotes }: UpdateCardProps) {
  const { t } = useI18n();
  const u = t.update;
  let title: string; let subtitle: string | null = null; let badge: string; let tone: Tone;
  switch (view.kind) {
    case 'available': title = u.available(view.version); subtitle = view.current ? u.current(view.current) : null; badge = u.badgeNew; tone = 'info'; break;
    case 'manual': title = u.manualTitle; subtitle = view.version; badge = u.badgeManual; tone = 'warning'; break;
    case 'running': title = u.running(view.steps[0]?.meta ?? ''); subtitle = u.dontClose; badge = u.badgeRunning; tone = 'info'; break;
    case 'failed': title = u.failed[view.reason]; badge = u.failedBadge; tone = 'danger'; break;
    case 'updated': title = u.updated(view.version); badge = u.badgeUpdated; tone = 'success'; break;
  }
  const border = tone === 'danger' ? 'color-mix(in srgb, var(--danger) 45%, var(--input))' : tone === 'success' ? 'color-mix(in srgb, var(--success) 40%, var(--input))' : 'var(--input)';
  const command = view.kind === 'failed' ? view.command ?? (view.reason === 'daemon-timeout' ? u.timeoutCommand : null) : view.kind === 'manual' ? view.command : null;
  return (
    <div role={view.kind === 'failed' ? 'alert' : view.kind === 'running' ? 'status' : undefined} data-update-card={view.kind}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: `${NOTICE_GAP}px 12px 0`, padding: 12, boxSizing: 'border-box', borderRadius: 'var(--radius-lg)', background: 'var(--well)', border: `1px solid ${border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', flexShrink: 0, lineHeight: 0 }}><ResidentMascot size={28} theme="dark" paused frozen /></span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{title}</strong>
          {subtitle && <span style={sub}>{subtitle}</span>}
        </span>
        <span data-update-badge style={{ flexShrink: 0, padding: '3px 8px', borderRadius: 5, fontSize: 11, lineHeight: '14px', fontWeight: 600, color: TONE[tone].fg, background: TONE[tone].soft }}>{badge}</span>
      </div>

      {view.kind === 'available' && (
        <>
          {view.notes.length > 0 && <ul style={{ margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column', gap: 2, ...sub, lineHeight: '17px' }}>{view.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <span style={{ ...sub, fontSize: 11, lineHeight: '15px' }}>{u.keepRunning(sessions)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" onClick={onUpdate} style={{ height: 28, padding: '0 12px', fontSize: 12 }}>{u.update}</Button>
            <Button variant="ghost" size="sm" onClick={onLater} style={{ height: 28, padding: '0 8px', fontSize: 12 }}>{u.later}</Button>
            <span style={{ flexGrow: 1 }} />
            <Button variant="ghost" size="sm" onClick={onNotes} style={{ height: 28, padding: '0 8px', fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3 }}>{u.notes}</Button>
          </div>
        </>
      )}

      {view.kind === 'manual' && (
        <>
          {command && <><span style={sub}>{u.manualHint}</span><Command text={command} /></>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" disabled={!view.canInstallApp} onClick={onUpdate} style={{ height: 28, padding: '0 12px', fontSize: 12 }}>{u.manualApp}</Button>
            <Button variant="ghost" size="sm" onClick={onLater} style={{ height: 28, padding: '0 8px', fontSize: 12 }}>{u.later}</Button>
          </div>
          {!view.canInstallApp && <span style={{ ...sub, fontSize: 11, lineHeight: '15px' }}>{u.manualWait(view.version)}</span>}
        </>
      )}

      {view.kind === 'running' && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {view.steps.map(s => (
            <li key={s.key} data-step={s.key} data-status={s.status} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) auto', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: '16px', color: s.status === 'todo' ? 'var(--muted-foreground)' : undefined }}>
              <Dot status={s.status} />
              <span>{u.steps[s.key]}</span>
              {s.meta && <span className="mono" style={{ fontSize: 11, color: 'var(--muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>{s.meta}</span>}
              {s.progress !== undefined && (
                <div role="progressbar" aria-label={u.steps[s.key]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)} style={{ gridColumn: '2 / 4', height: 4, borderRadius: 4, background: 'var(--muted)', overflow: 'hidden' }}>
                  <i style={{ display: 'block', height: '100%', width: `${Math.round(s.progress * 100)}%`, background: 'var(--info)', borderRadius: 4 }} />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {view.kind === 'failed' && (
        <>
          {view.missing && view.missing.length > 0 && <span style={sub}>{u.missing(view.missing)}</span>}
          {command && <Command text={command} />}
          {view.detail && <span className="mono" title={u.log} style={{ fontSize: 11, lineHeight: '15px', color: 'var(--danger-text)', wordBreak: 'break-word' }}>{view.detail}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={onRetry} style={{ height: 28, padding: '0 12px', fontSize: 12 }}>{u.retry}</Button>
            <Button variant="ghost" size="sm" onClick={onLater} style={{ height: 28, padding: '0 8px', fontSize: 12 }}>{u.later}</Button>
          </div>
        </>
      )}

      {view.kind === 'updated' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="primary" size="sm" onClick={onAck} style={{ height: 28, padding: '0 12px', fontSize: 12 }}>{u.ok}</Button>
          <Button variant="ghost" size="sm" onClick={onNotes} style={{ height: 28, padding: '0 8px', fontSize: 12 }}>{u.notes}</Button>
        </div>
      )}
    </div>
  );
}
