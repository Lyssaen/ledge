import { useEffect, useRef, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { useOpenRigRole, type RolesView as RolesData } from '@ledge/fleet/openrig';
import type { RoleDetail, RoleSeat, RoleSummary } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import type { NavAction } from '../../nav/state';
import { cls } from '../../shell/cls';
import { CopyButton, Seg } from './bits';
import { groupRoles, pieces, profileOf, ROLE_FILTERS, roleDocs, seatKey, seatName, seatOf, tilde, type RoleFilter } from './model';
import { ContextTab, DiffView, ParamsTab, RoleTab, YamlTab, type TabCtx } from './tabs';

type Tab = 'role' | 'params' | 'context' | 'yaml';

/**
 * OpenRig › Rôles (docs/mockups/ledge-openrig-roles.html): the machine's roles on the left, the one chosen on the right,
 * seen from its spec or from one of its seats. Read-only: copying is the only action.
 */
export function RolesView({ client, machine, machineLabel, roles, roleId, seat, dispatch }: { client: DaemonClient; machine: string; machineLabel: string; roles: RolesData; roleId?: string; seat?: string; dispatch: (a: NavAction) => void }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [builtinOpen, setBuiltinOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  // Ctrl F searches the roles while the view is shown.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); search.current?.focus(); search.current?.select(); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const error = roles.error;
  if (roles.status === 'loading' || roles.status === 'idle') return <Loading label={r.loading} />;
  if (error === 'daemon_stopped') return (
    <div className="orr-state"><h4><span className="or-dot" />{r.daemonStoppedT(machineLabel)}</h4><p>{r.daemonStopped}</p><div className="orr-acts"><button type="button" className="orr-btn" onClick={() => dispatch({ type: 'openrig', section: 'rigs' })}>{r.goRigs}</button></div></div>
  );
  if (error === 'outdated') return <div className="orr-state"><p>{r.outdated}</p></div>;
  if (error === 'offline') return <div className="orr-state"><p>{t.openrig.offline}</p></div>;
  if (error === 'not_installed') return <div className="orr-state"><p>{t.openrig.notInstalled}</p></div>;
  if (error) return <div className="orr-state"><p>{r.failed(error)}</p></div>;

  const { mine, builtin } = groupRoles(roles.roles, filter, query);
  const shown = [...mine, ...builtin];
  const current = roles.roles.find(x => x.id === roleId) ?? mine[0] ?? builtin[0] ?? roles.roles[0];
  const biOpen = builtinOpen || filter === 'builtin' || query.trim() !== '' || current?.source === 'builtin';
  const open = (x: RoleSummary) => dispatch({ type: 'openrig', section: 'roles', role: x.id });
  const listKeys = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const opts = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=option]')];
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const n = opts[Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (n) { n.focus(); e.preventDefault(); }
  };
  const item = (x: RoleSummary) => (
    <button key={x.id} type="button" role="option" aria-selected={x.id === current?.id} className={cls('orr-item', x.importOnly && 'orr-res')} onClick={() => open(x)}>
      <span className="orr-nm">{x.name}</span>
      <span className="orr-ct">{x.importOnly ? r.importOnly : x.seats > 0 ? <><span className={cls('or-dot', x.running > 0 && 'or-ok')} />{r.seats(x.seats)}</> : x.runtime === 'codex' ? 'Codex' : x.runtime === 'claude-code' ? 'Claude Code' : x.runtime ?? ''}</span>
      {x.description && <span className="orr-sm">{x.description}</span>}
    </button>
  );
  return (
    <div className="orr-rp">
      <div className="orr-list">
        <div className="orr-lhead">
          <label className="orr-search"><span aria-hidden>⌕</span><input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder={r.searchPh} aria-label={r.searchLabel} onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} /><kbd>Ctrl F</kbd></label>
          <Seg label={r.filterLabel} value={filter} options={ROLE_FILTERS.map(f => ({ value: f, label: r.filters[f] }))} onChange={setFilter} />
        </div>
        <div className="orr-lbody" role="listbox" aria-label={r.listLabel} onKeyDown={listKeys}>
          {shown.length === 0 && query.trim() ? (
            <div className="orr-noresult" role="status"><h4>{r.noResultsT(query.trim())}</h4><p>{r.noResults}</p><button type="button" className="orr-btn" onClick={() => setQuery('')}>{r.clear}</button></div>
          ) : roles.roles.length === 0 ? <div className="orr-noresult" role="status"><h4>{r.noneT}</h4><p>{r.none}</p></div> : null}
          {mine.length > 0 && <>
            <div className="orr-grp"><b>{r.groupMine}</b>{mine.length}<span className="mono">{commonDir(mine)}</span></div>
            {mine.map(item)}
          </>}
          {builtin.length > 0 && <>
            <button type="button" className="orr-grp orr-grpbtn" aria-expanded={biOpen} onClick={() => setBuiltinOpen(!biOpen)}><span className="orr-chev" aria-hidden>{biOpen ? '▾' : '▸'}</span><b>{r.groupBuiltin}</b>{builtin.length}{roles.openrigVersion && <span className="mono">@openrig/cli {roles.openrigVersion}</span>}</button>
            {biOpen && builtin.map(item)}
          </>}
        </div>
      </div>
      <div className="orr-detail">
        {current ? <Detail key={`${machine}\u0000${current.id}`} client={client} machine={machine} summary={current} seat={seat} openrigVersion={roles.openrigVersion} dispatch={dispatch} /> : null}
      </div>
    </div>
  );
}

/** The library folder its roles share, shown as `~/.openrig/specs`. */
function commonDir(roles: readonly RoleSummary[]): string {
  const dirs = roles.map(x => x.path.replace(/\/agents\/.*$/, ''));
  const d = dirs.every(x => x === dirs[0]) ? dirs[0]! : '';
  return d.replace(/^\/home\/[^/]+/, '~').replace(/\/openrig$/, '');
}

function Loading({ label }: { label: string }) {
  return <div className="orr-state" role="status"><h4><span className="or-dot or-info" />{label}</h4><div className="orr-skel" style={{ width: '80%' }} /><div className="orr-skel" style={{ width: '60%' }} /><div className="orr-skel" style={{ width: '72%' }} /></div>;
}

function Detail({ client, machine, summary, seat: seatKeyNav, openrigVersion, dispatch }: { client: DaemonClient; machine: string; summary: RoleSummary; seat?: string; openrigVersion?: string; dispatch: (a: NavAction) => void }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const view = useOpenRigRole(client, machine, summary.id);
  const d = view.role;
  const seat = d ? seatOf(d, seatKeyNav) : undefined;
  const [tab, setTab] = useState<Tab>(summary.importOnly ? 'params' : 'role');
  const [profileName, setProfile] = useState<string | undefined>(undefined);
  const [raw, setRaw] = useState(false);
  const [copy, setCopy] = useState<'library' | 'repo'>('library');
  const [diff, setDiff] = useState(false);
  // Changing « Vu » keeps the tab; arriving from the Rigs page mounts the view afresh, on the role's words.
  const head = (
    <div className="orr-dtitle">
      <h2>{summary.name}</h2>{summary.version && <span className="orr-ver mono">v{summary.version}</span>}
      <span className={`or-pill ${summary.source === 'builtin' ? 'or-off' : 'or-info'}`}>{summary.source === 'builtin' ? r.filters.builtin : r.filters.mine}</span>
      {summary.importOnly && <span className="or-pill or-off">{r.importOnly}</span>}
      {d?.error && <span className="or-pill or-err">{d.error.kind === 'missing' ? r.missingFile : r.invalid}</span>}
    </div>
  );
  if (view.status !== 'ready') return <div className="orr-dhead">{head}<Loading label={r.loadingRole} /></div>;
  if (!d) return <div className="orr-dhead">{head}<div className="orr-err-box">{view.error === 'role_not_found' ? r.missingFile : r.failed(view.error ?? '')}</div></div>;
  const profile = profileOf(d, profileName, seat);
  const ctx: TabCtx = { client, machine, detail: d, seat, profile, raw, setRaw };
  const tabs: Tab[] = summary.importOnly ? ['params', 'yaml'] : ['role', 'params', 'context', 'yaml'];
  const shownTab = tabs.includes(tab) ? tab : tabs[0]!;
  const count = (k: Tab) => (k === 'role' ? roleDocs(d, profile, seat).length : k === 'context' ? pieces(d, profile, seat).length : null);
  const lens = (s: RoleSeat | null) => dispatch({ type: 'openrig', section: 'roles', role: summary.id, ...(s ? { seat: seatKey(s) } : {}) });
  const repo = d.file.copies.find(x => x.kind === 'repo');
  const tabKeys = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.indexOf(shownTab), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]!;
    setTab(n);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab=${n}]`)?.focus();
  };
  return <>
    <div className="orr-dhead">
      {head}
      {summary.description && <p className="orr-ddesc">{summary.description}</p>}
      <div className="orr-srcline">
        <span>{summary.source === 'builtin' ? r.builtinSrc(openrigVersion) : r.library}</span>
        <span className="orr-path">{tilde(d.file.path)}</span>
        {repo && <span className={repo.identical ? 'orr-same' : 'orr-differs'}>= {r.repo} {tilde(repo.path)} · {repo.identical ? r.identical : r.differs}</span>}
        <CopyButton text={d.file.path} label={r.copyPath} />
      </div>
      {seat?.rigSpecPath && <div className="orr-srcline orr-tight"><span>{r.rigSpec}</span><span className="orr-path">{tilde(seat.rigSpecPath)}</span>{seat.composed && <span>· {r.composed}</span>}</div>}
      {d.error && (
        <div className="orr-err-box">
          {d.error.kind === 'missing' ? <>{r.missingFileP}<code>{d.file.path}</code></> : <>{r.invalidP}<code>{r.invalidAt(d.error.message, d.error.line, d.error.col)}</code></>}
        </div>
      )}
      {repo && !repo.identical && (
        <div className="orr-warn-box">
          <b>{r.divergeT}</b>
          <code>{`${r.library} · ${d.file.modifiedAt ?? ''} · ${tilde(d.file.path)}\n${r.repoCopy} · ${repo.modifiedAt ?? ''} · ${tilde(repo.path)}`}</code>
          <div className="orr-acts">
            <span className="orr-muted">{r.showCopy}</span>
            <Seg label={r.showCopy} value={copy} options={[{ value: 'library', label: r.libUsed }, { value: 'repo', label: r.repoCopy }]} onChange={v => { setCopy(v); setTab('yaml'); }} />
            <button type="button" className="orr-btn orr-ghost" aria-expanded={diff} onClick={() => setDiff(!diff)}>{diff ? r.hideDiff : r.seeDiff}</button>
          </div>
          {diff && <DiffView c={ctx} />}
        </div>
      )}
      {!summary.importOnly && (
        <div className="orr-lens">
          <span>{r.lens}</span>
          <Seg label={r.lens} value={seat ? seatKey(seat) : 'spec'}
            options={[{ value: 'spec', label: r.lensSpec }, ...[...d.seats].sort((a, b) => a.rig.localeCompare(b.rig) || a.logicalId.localeCompare(b.logicalId)).map(s => ({ value: seatKey(s), label: <>{r.lensFrom} <span className="mono">{seatName(d, s)}</span></> }))]}
            onChange={v => lens(v === 'spec' ? null : d.seats.find(s => seatKey(s) === v) ?? null)} />
          {!seat && d.profiles.length > 1 && <><span className="orr-gap">{r.profile}</span><Seg label={r.profile} value={profile?.name ?? ''} options={d.profiles.map(p => ({ value: p.name, label: p.name }))} onChange={setProfile} /></>}
          <span className="orr-lenshint">{seat ? (seat.live ? r.lensSeatHint(seat.session ?? seat.logicalId, d.openrigVersion ?? openrigVersion) : r.lensSeatNoLive(seat.session ?? seat.logicalId)) : r.lensSpecHint}</span>
        </div>
      )}
    </div>
    <div className="orr-dtabs" role="tablist" aria-label={r.tabsLabel} onKeyDown={tabKeys}>
      {tabs.map(k => <button key={k} type="button" role="tab" data-tab={k} aria-selected={k === shownTab} tabIndex={k === shownTab ? 0 : -1} onClick={() => setTab(k)}>{r.tabs[k]}{count(k) !== null && <small>{count(k)}</small>}</button>)}
    </div>
    <div className="orr-panel" role="tabpanel" aria-label={r.tabs[shownTab]}>
      {shownTab === 'role' ? <RoleTab c={ctx} onTab={setTab} />
        : shownTab === 'params' ? <ParamsTab c={ctx} onLens={s => lens(s)} />
        : shownTab === 'context' ? <ContextTab key={seat ? seatKey(seat) : 'spec'} c={ctx} />
        : <YamlTab c={ctx} source={copy} />}
    </div>
  </>;
}

export type { RoleDetail };
