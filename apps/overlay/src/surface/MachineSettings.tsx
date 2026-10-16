import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { sshProblem, type MachineConfig, type MachineState, type ProbeResult } from '../daemon/machines';
import { useI18n } from '../i18n/lang';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';

const MONITOR = ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'];
const SERVER = ['M4 3h16v7H4z', 'M4 14h16v7H4z', 'M7 6.5h.01', 'M7 17.5h.01'];
const ALIAS = /^[a-zA-Z0-9._-]+$/;
type Probe = 'running' | ProbeResult;
type Status = 'online' | 'connecting' | 'offline';

const hint: CSSProperties = { fontSize: 12, lineHeight: '16px', color: 'var(--muted-foreground)' };
const well: CSSProperties = { marginTop: 6, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--well)', border: '1px solid var(--input)', fontSize: 12, lineHeight: '16px' };
const raw: CSSProperties = { display: 'block', marginTop: 4, fontSize: 11, color: 'var(--muted-foreground)', overflowWrap: 'anywhere' };
const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 6 };
const field: CSSProperties = { marginTop: 5, height: 32, boxSizing: 'border-box', width: '100%', padding: '0 10px', border: '1px solid var(--input)', borderRadius: 'var(--radius-md)', background: 'var(--well)', color: 'inherit', fontSize: 13 };

/** Runs one probe at a time and drops the answer when it no longer applies (another probe, or the view is gone). */
function useProbe(onProbe?: (ssh: string) => Promise<ProbeResult>) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);
  const start = async (ssh: string): Promise<ProbeResult | null> => {
    if (!onProbe) return null;
    const id = ++run.current; setProbe('running');
    const result = await onProbe(ssh).catch((e: Error) => ({ ok: false as const, error: e.message }));
    if (id !== run.current) return null;
    setProbe(result); return result;
  };
  const clear = () => { run.current++; setProbe(null); };
  return { probe, start, clear };
}

/** A failed connection in plain words, with the raw SSH or Ledge message under it. */
function Problem({ error }: { error: string }) {
  const { t } = useI18n();
  return <><p style={{ margin: 0 }}>{t.machines.problem[sshProblem(error)]}</p><code className="mono" style={raw}>{error}</code></>;
}

function StatusDot({ status }: { status: Status }) {
  const { t } = useI18n();
  const label = { online: t.machines.online, connecting: t.machines.connecting, offline: t.machines.offline }[status];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, fontSize: 12, color: status === 'offline' ? 'var(--warning)' : 'var(--muted-foreground)' }}>
    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: status === 'online' ? 'var(--success)' : 'currentColor', animation: status === 'connecting' ? 'ledge-pulse 1s ease-in-out infinite' : undefined }} />{label}
  </span>;
}

function ProbeLine({ probe, ssh }: { probe: Probe; ssh: string }) {
  const { t } = useI18n();
  const tone = probe === 'running' ? 'var(--muted-foreground)' : probe.ok ? 'var(--success)' : 'var(--danger-text)';
  return <div role="status" style={{ ...well, marginTop: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
    <span className={probe === 'running' ? 'ledge-spin' : undefined} style={{ display: 'inline-flex', flexShrink: 0, marginTop: 1, color: tone }}><Icon d={probe === 'running' ? ICONS.refresh.d : probe.ok ? ICONS.check.d : ICONS.close.d} size={14} /></span>
    <span style={{ minWidth: 0 }}>{probe === 'running' ? <>{t.machines.probing} <span className="mono">{ssh}</span>…</> : probe.ok ? t.machines.probeOk(probe.version, probe.sessions) : <Problem error={probe.error} />}</span>
  </div>;
}

function MachineRow({ m, onRemove, onEdit, onProbe, onRetry }: { m: MachineState; onRemove: () => void; onEdit: () => void; onProbe?: (ssh: string) => Promise<ProbeResult>; onRetry?: (id: string) => void }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const { probe, start, clear } = useProbe(onProbe);
  useEffect(clear, [m.ssh]);
  const status: Status = probe === 'running' ? 'connecting' : m.ready ? 'online' : m.error || m.status === 'unreachable' ? 'offline' : 'connecting';
  const meta = [m.ssh ? `SSH · ${m.ssh}` : t.machines.localMeta, m.version && t.machines.version(m.version), m.ready && t.machines.sessions(m.sessions.length)].filter(Boolean).join(' · ');
  const test = async () => { const r = await start(m.ssh!); if (r?.ok && !m.ready) onRetry?.(m.id); };
  const shown = probe && probe !== 'running' ? probe : null;
  return <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--sidebar-border)' }}>
    <span aria-hidden="true" style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', borderRadius: 'var(--radius-md)', background: 'var(--muted)', border: '1px solid var(--input)', color: 'var(--muted-foreground)' }}><Icon d={m.ssh ? SERVER : MONITOR} size={16} /></span>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: '18px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.id === 'local' ? t.machines.local : m.label}</span>
        <StatusDot status={status} />
      </div>
      <span style={{ ...hint, overflowWrap: 'anywhere' }}>{meta}</span>
      {shown ? <div role="status" style={well}>{shown.ok ? <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ display: 'inline-flex', color: 'var(--success)' }}><Icon d={ICONS.check.d} size={14} /></span>{t.machines.probeOk(shown.version, shown.sessions)}</span> : <Problem error={shown.error} />}</div>
        : m.error && !m.ready && <div role="status" style={well}><Problem error={m.error} /></div>}
      {m.ssh && (confirm
        ? <div role="alert" style={well}>
            <p style={{ margin: 0 }}>{t.machines.removeAsk} <strong style={{ fontWeight: 600 }}>{m.label}</strong> {t.machines.removeNote}</p>
            <div style={actions}><Button size="sm" variant="primary" onClick={onRemove}>{t.machines.remove}</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t.machines.cancel}</Button></div>
          </div>
        : <div style={{ ...actions, marginLeft: -8 }}>
            {onProbe && <Button size="sm" variant="ghost" onClick={() => void test()} disabled={probe === 'running'}><Icon d={ICONS.refresh.d} size={14} />{status === 'offline' ? t.machines.retry : t.machines.test}</Button>}
            <Button size="sm" variant="ghost" onClick={onEdit}>{t.machines.edit}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>{t.machines.remove}</Button>
          </div>)}
    </div>
  </div>;
}

function MachineForm({ editing, taken, onSave, onCancel, onProbe }: { editing?: MachineState; taken: string[]; onSave: (label: string, ssh: string) => void; onCancel: () => void; onProbe?: (ssh: string) => Promise<ProbeResult> }) {
  const { t } = useI18n();
  const [label, setLabel] = useState(editing?.label ?? ''), [ssh, setSsh] = useState(editing?.ssh ?? '');
  const [help, setHelp] = useState(!editing);
  const { probe, start, clear } = useProbe(onProbe);
  const alias = ssh.trim();
  const duplicate = taken.includes(alias);
  const valid = !!label.trim() && label.trim().length <= 80 && alias.length <= 64 && ALIAS.test(alias) && !duplicate;
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid) onSave(label.trim(), alias); };
  return <form onSubmit={submit} aria-label={editing ? t.machines.editTitle(editing.label) : t.machines.add} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--sidebar-border)' }}>
    <strong style={{ fontSize: 14, lineHeight: '18px', fontWeight: 600 }}>{editing ? t.machines.editTitle(editing.label) : t.machines.add}</strong>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, fontWeight: 500 }}>{t.machines.label}
      <span style={{ ...hint, fontWeight: 400 }}>{t.machines.labelHint}</span>
      <input className="ledge-field" aria-label={t.machines.label} value={label} maxLength={80} onChange={e => setLabel(e.target.value)} placeholder={t.machines.labelPlaceholder} autoFocus style={field} />
    </label>
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, fontWeight: 500 }}>{t.machines.ssh}
      <span style={{ ...hint, fontWeight: 400 }}>{t.machines.sshHint}</span>
      <input className="ledge-field mono" aria-label={t.machines.ssh} value={ssh} maxLength={64} spellCheck={false} onChange={e => { setSsh(e.target.value); clear(); }} placeholder="my-server" style={field} />
      {duplicate && <span role="alert" style={{ marginTop: 2, fontWeight: 400, color: 'var(--danger-text)' }}>{t.machines.duplicate}</span>}
    </label>
    <div>
      <button type="button" aria-expanded={help} onClick={() => setHelp(!help)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'transparent', color: 'var(--muted-foreground)', fontSize: 12, cursor: 'pointer' }}>
        <span aria-hidden="true" style={{ display: 'inline-flex', transform: help ? 'rotate(90deg)' : undefined }}><Icon d={ICONS.chevronRight.d} size={12} /></span>{t.machines.before}
      </button>
      {help && <ol style={{ ...well, margin: '8px 0 0', padding: '8px 10px 8px 28px', lineHeight: '18px', color: 'var(--muted-foreground)' }}>
        {t.machines.steps.map(([text, code], i) => <li key={i} style={{ marginTop: i ? 4 : 0 }}>{text}{code && <code className="mono" style={{ fontSize: 11, color: 'var(--sidebar-foreground)', whiteSpace: 'nowrap' }}>{code}</code>}</li>)}
      </ol>}
    </div>
    {probe && <ProbeLine probe={probe} ssh={alias} />}
    <div style={{ ...actions, marginTop: 0 }}>
      {onProbe && <Button size="sm" onClick={() => void start(alias)} disabled={!valid || probe === 'running'}>{t.machines.probe}</Button>}
      <span style={{ flex: 1 }} />
      <Button size="sm" variant="ghost" onClick={onCancel}>{t.machines.cancel}</Button>
      <Button size="sm" variant="primary" type="submit" disabled={!valid}>{t.machines.save}</Button>
    </div>
    {onProbe && !editing && <span style={hint}>{t.machines.savedAnyway}</span>}
  </form>;
}

/** The Machines settings tab: this machine and the SSH servers, their state, and adding, testing, editing or removing one. */
export function MachineSettings({ machines, onChange, onProbe, onRetry }: { machines: MachineState[]; onChange: (config: MachineConfig[]) => void; onProbe?: (ssh: string) => Promise<ProbeResult>; onRetry?: (id: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState<string | null>(null), [error, setError] = useState('');
  const config = (list: MachineState[]): MachineConfig[] => list.map(m => m.ssh ? { id: m.id, label: m.label, ssh: m.ssh } : { id: m.id, label: m.label, url: m.url });
  const apply = (next: MachineConfig[]) => { try { onChange(next); setForm(null); setError(''); } catch (e) { setError((e as Error).name === 'DaemonOffline' ? t.machines.daemonOffline : t.machines.invalid); } };
  const editing = form && form !== 'add' ? machines.find(m => m.id === form) : undefined;
  const remotes = machines.filter(m => m.ssh);
  const save = (label: string, ssh: string) => apply(editing
    ? config(machines).map(m => m.id === editing.id ? { id: m.id, label, ssh } : m)
    : [...config(machines), { id: `remote-${crypto.randomUUID()}`, label, ssh }]);
  return <div style={{ display: 'flex', flexDirection: 'column' }}>
    <p style={{ ...hint, margin: 0, padding: '12px 0', borderBottom: '1px solid var(--sidebar-border)' }}>{t.machines.intro}</p>
    {machines.map(m => form === m.id ? null : <MachineRow key={m.id} m={m} onProbe={onProbe} onRetry={onRetry} onEdit={() => { setForm(m.id); setError(''); }} onRemove={() => apply(config(machines.filter(x => x.id !== m.id)))} />)}
    {form ? <MachineForm key={form} editing={editing} taken={remotes.filter(m => m.id !== form).map(m => m.ssh!)} onProbe={onProbe} onSave={save} onCancel={() => { setForm(null); setError(''); }} />
      : <div style={{ padding: '12px 0' }}><Button size="sm" onClick={() => { setForm('add'); setError(''); }}><Icon d={ICONS.plus.d} size={14} />{t.machines.add}</Button></div>}
    {remotes.length === 0 && !form && <p style={{ ...hint, margin: 0 }}>{t.machines.none}</p>}
    {error && <p role="alert" style={{ margin: '8px 0 0', color: 'var(--danger-text)', fontSize: 12 }}>{error}</p>}
  </div>;
}
