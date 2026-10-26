import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Project, Role, Seat, Team, TeamTemplate, Tool } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { toolName } from '@ledge/ui/chat/format';
import { useI18n } from '../i18n/lang';
import type { TeamsApi } from '../teams/useTeamsApi';

const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor', 'omp'];
let seq = 0;

/** A seat as the form shows it: the role, the agent it will run, and the role's autonomy. */
interface Row { role: Role; tool: Tool; on: boolean }

/**
 * « Nouvelle équipe ici… » (atelier rooms spec §3.2): a team in one of the project's folders, from a template or from the
 * roles chosen one by one, each with its agent. The preview says where it sits (« nouvelle table dans la pièce Ledge ») and
 * warns of a seat that works without asking. Launching sends `team.launch`; the daemon's answer closes the form or says why.
 */
export function TeamLaunch({ client, teams, project, onLaunched, onCancel }: {
  client: DaemonClient; teams: TeamsApi; project: Project; onLaunched(team: Team): void; onCancel(): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.teamLaunch;
  const folders = project.repos.filter(r => r.machine === 'local').map(r => r.path);
  const [cwd, setCwd] = useState(folders[0] ?? '');
  const [defs, setDefs] = useState<{ roles: Role[]; templates: TeamTemplate[] } | null>(null);
  const [template, setTemplate] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState(project.name);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    if (!cwd) return;
    setDefs(null);
    void teams.roles(cwd).then(d => {
      if (!live.current) return;
      setDefs(d);
      setRows(d.roles.map(role => ({ role, tool: role.tool ?? 'claude', on: false })));
      if (d.templates[0]) { setTemplate(d.templates[0].id); setName(d.templates[0].name); }
    });
  }, [cwd, teams]);
  const chosen = useMemo((): Array<{ role: Role | undefined; id: string; tool: Tool }> => {
    if (template) {
      const tpl = defs?.templates.find(x => x.id === template);
      return (tpl?.seats ?? []).map(s => { const role = defs?.roles.find(r => r.id === s.role); return { role, id: s.role, tool: s.tool ?? role?.tool ?? 'claude' }; });
    }
    return rows.filter(r => r.on).map(r => ({ role: r.role, id: r.role.id, tool: r.tool }));
  }, [template, defs, rows]);
  const auto = chosen.filter(x => x.role?.autonomy === 'auto').map(x => `@${x.id}`);
  const unknown = chosen.filter(x => !x.role).map(x => x.id);
  const ready = !!cwd && chosen.length > 0 && unknown.length === 0 && name.trim().length > 0 && !sending;

  const launch = () => {
    if (!ready) return;
    const rid = `team-${Date.now()}-${++seq}`;
    setSending(true); setError(null);
    const off = client.onMessage(m => {
      if ((m.type !== 'team.launched' && m.type !== 'team.failed') || m.rid !== rid) return;
      off(); clearTimeout(timer);
      if (!live.current) return;
      setSending(false);
      if (m.type === 'team.launched') onLaunched(m.team); else setError(m.reason);
    });
    const timer = setTimeout(() => { off(); if (live.current) { setSending(false); setError(c.noAnswer); } }, 60_000);
    const seats: Seat[] = chosen.map(x => ({ role: x.id, tool: x.tool }));
    client.send({ type: 'team.launch', rid, cwd, name: name.trim(), ...(template ? { template } : { seats }) });
  };

  return (
    <div className="team-launch">
      <label className="field"><span>{c.folder}</span>
        <select value={cwd} onChange={e => setCwd(e.target.value)} disabled={folders.length === 0}>
          {folders.length === 0 && <option value="">{c.noFolder}</option>}
          {folders.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      {defs === null && cwd && <p className="muted">{c.loading}</p>}
      {defs && (
        <>
          <label className="field"><span>{c.template}</span>
            <select value={template} onChange={e => { setTemplate(e.target.value); const tpl = defs.templates.find(x => x.id === e.target.value); if (tpl) setName(tpl.name); }}>
              {defs.templates.map(x => <option key={x.id} value={x.id}>{x.name} · {x.seats.map(s => `@${s.role}`).join(' ')}</option>)}
              <option value="">{c.custom}</option>
            </select>
          </label>
          {!template && (
            <fieldset className="team-seats">
              <legend>{c.seats}</legend>
              {rows.length === 0 && <p className="muted">{c.noRole}</p>}
              {rows.map((r, i) => (
                <div key={r.role.id} className="team-seat">
                  <label><input type="checkbox" checked={r.on} onChange={e => setRows(rs => rs.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} /> <span className="role-pill">@{r.role.id}</span> {r.role.label}</label>
                  <select aria-label={c.agentOf(r.role.id)} value={r.tool} disabled={!r.on} onChange={e => setRows(rs => rs.map((x, k) => (k === i ? { ...x, tool: e.target.value as Tool } : x)))}>
                    {TOOLS.map(tool => <option key={tool} value={tool}>{toolName(tool)}</option>)}
                  </select>
                </div>
              ))}
            </fieldset>
          )}
          <label className="field"><span>{c.name}</span><input type="text" value={name} onChange={e => setName(e.target.value)} /></label>
          <div className="team-preview" role="status">
            <p>{c.preview(name.trim() || project.name, project.name)}</p>
            <ul>{chosen.map(x => <li key={x.id}><span className="role-pill">@{x.id}</span> {toolName(x.tool)} · {t.chat.team.autonomy[x.role?.autonomy ?? 'ask']}</li>)}</ul>
            {unknown.length > 0 && <p role="alert" className="error">{c.unknown(unknown.join(', '))}</p>}
            {auto.length > 0 && <p role="note" className="warn">{t.chat.team.autoWarning(auto.join(', '))}</p>}
          </div>
        </>
      )}
      {error && <p role="alert" className="error">{c.failed(error)}</p>}
      <div className="composer-actions">
        <Button onClick={onCancel}>{t.manage.confirm.cancel}</Button>
        <Button variant="primary" disabled={!ready} onClick={launch}>{sending ? c.launching : c.launch}</Button>
      </div>
    </div>
  );
}
