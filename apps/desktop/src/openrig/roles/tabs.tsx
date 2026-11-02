import { useState, type ReactNode } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { RoleDetail, RoleProfile, RoleResource, RoleSeat, RoleUsesList, StartupEntry } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { cls } from '../../shell/cls';
import { CopyButton, CopyIcon, FileText, KeyboardIcon, Legend, Pv, Row, Section, Seg, Yaml, useRoleFile, type FileState } from './bits';
import { appliesOf, baseName, channelOf, formatSize, isMissing, keyOf, lineDiff, pieceTitle, pieces, provOf, roleDocs, seatModels, tilde, type Piece } from './model';

/** What every tab reads: the role, the lens (a seat or the spec) and the profile shown. */
export interface TabCtx { client: DaemonClient; machine: string; detail: RoleDetail; seat: RoleSeat | undefined; profile: RoleProfile | undefined; raw: boolean; setRaw: (raw: boolean) => void }
const roleIdOf = (c: TabCtx) => c.detail.summary.id;

export function RawSeg({ raw, setRaw }: { raw: boolean; setRaw: (raw: boolean) => void }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  return <Seg label={r.renderLabel} value={raw ? 'raw' : 'rendered'} options={[{ value: 'rendered', label: r.rendered }, { value: 'raw', label: r.raw }]} onChange={v => setRaw(v === 'raw')} />;
}

/** The tags of a startup entry: how it is delivered, when, whether required, its orientation. */
function DeliveryTags({ e }: { e: StartupEntry }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const ch = channelOf(e);
  const into = e.into ? baseName(e.into) : 'CLAUDE.md';
  const d = ch === 'send' ? <><KeyboardIcon /> {r.delivery.send_text}</> : ch === 'merge' ? r.delivery.guidance_merge(into) : ch === 'action' ? r.delivery.action : e.delivery === 'skill_install' ? r.delivery.skill_install : e.delivery;
  const when = appliesOf(e.appliesOn);
  return <span className="orr-tags">
    <span className="orr-tag">{d}</span>
    {when && <span className="orr-tag">{when === 'fresh' ? r.freshOnly : when === 'both' ? r.alsoRestore : r.restoreOnly}</span>}
    {e.required !== undefined && <span className="orr-tag">{e.required ? r.required : r.optional}</span>}
    {e.orientation && <span className="orr-tag">orientation: {e.orientation}</span>}
  </span>;
}

// ── Rôle: the role.md first, in full ──

export function RoleTab({ c, onTab }: { c: TabCtx; onTab: (tab: 'params' | 'context') => void }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const docs = roleDocs(c.detail, c.profile, c.seat);
  const n = pieces(c.detail, c.profile, c.seat).length;
  if (docs.length === 0) return (
    <div className="orr-rfile orr-abs">
      <div className="orr-rhead"><h4 className="mono">guidance/role.md</h4><Pv kind="abs" /></div>
      <div className="orr-rbody orr-rbody-sm">
        <p className="orr-muted">{r.noRole}</p>
        <div className="orr-acts"><button type="button" className="orr-btn" onClick={() => onTab('params')}>{r.tabs.params}</button><button type="button" className="orr-btn" onClick={() => onTab('context')}>{r.tabs.context}</button></div>
      </div>
    </div>
  );
  const [bold, rest] = r.roleSum(docs.length, c.seat ? c.seat.logicalId : null);
  return <>
    <div className="orr-rsum">
      <span><b>{bold}</b>{rest}</span>
      <span className="orr-fill" />
      <RawSeg raw={c.raw} setRaw={c.setRaw} />
      <button type="button" className="orr-lnk" onClick={() => onTab('context')}>{r.roleCtxLink(n)}</button>
    </div>
    {docs.map((e, i) => <RoleDoc key={`${e.absolutePath ?? e.path}-${i}`} c={c} e={e} />)}
  </>;
}

function RoleDoc({ c, e }: { c: TabCtx; e: StartupEntry }) {
  const { lang } = useI18n();
  const file = useRoleFile(c.client, c.machine, roleIdOf(c), e.absolutePath);
  const prov = provOf(e.origin);
  const key = keyOf(e.origin);
  return (
    <article className={cls('orr-rfile', `orr-${prov}`)}>
      <div className="orr-rhead">
        <h4 className="mono">{e.path}</h4><Pv origin={e.origin} />
        <span className="orr-fill" />
        <span className="orr-muted">{formatSize(e.size ?? (file.status === 'ready' ? file.size : undefined), lang)}</span>
        <CopyButton text={file.status === 'ready' ? file.content : ''} icon />
        <div className="orr-meta"><span className="mono">{tilde(e.absolutePath ?? e.path ?? '')}</span>{key && <> · <span className="mono">{key}</span></>}</div>
        <div className="orr-wide"><DeliveryTags e={e} /></div>
      </div>
      <div className="orr-rbody"><FileText state={file} raw={c.raw} path={e.absolutePath ?? e.path} /></div>
    </article>
  );
}

// ── Paramètres: every value with its provenance ──

export function ParamsTab({ c, onLens }: { c: TabCtx; onLens: (seat: RoleSeat) => void }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const { detail: d, seat, profile } = c;
  const s = d.summary;
  if (s.importOnly) return <ImportOnly c={c} />;
  const err = d.error;
  const here = (v: string | undefined) => (v ? 'here' : 'abs') as 'here' | 'abs';
  const exec = seat ? [
    <Sourced key="rt" label={r.fRuntime} v={seat.runtime} hint={profile?.runtime.value ? <>defaults.runtime : <span className="mono">{profile.runtime.value}</span></> : undefined} />,
    <Sourced key="model" label={r.fModel} v={seat.model} />,
    <Sourced key="effort" label={r.fEffort} v={seat.effort} empty={r.effortDefault} />,
    <Row key="profile" prov="inh" label={r.fProfile} yamlKey="member.profile" badge={<Pv kind="inh" source={`${r.from.member} ${seat.logicalId}`} />}><span className="mono">{seat.profile}</span></Row>,
    <Sourced key="cwd" label={r.fCwd} v={seat.cwd} />,
    <Sourced key="culture" label={r.fCulture} v={seat.cultureFile} />
  ] : profile ? [
    <Sourced key="rt" label={r.fRuntime} v={profile.runtime} />,
    <Sourced key="model" label={r.fModel} v={profile.model} empty={<ModelToday d={d} />} />,
    <Sourced key="effort" label={r.fEffort} v={profile.effort} />,
    <Row key="profile" prov="here" label={r.fProfile} yamlKey="profiles" badge={<Pv kind="here" />}><span className="mono">{profile.name}</span>{d.profiles.length > 1 && <span className="orr-hint">{d.profiles.map(p => p.name).join(', ')}</span>}</Row>
  ] : [];
  return <>
    <Legend />
    <Section title={r.sIdent}>
      <Row prov={here(s.name)} label={r.fName} yamlKey="name" badge={<Pv kind={here(s.name)} />}><span className="mono">{s.name}</span></Row>
      <Row prov={here(s.version)} label={r.fVersion} yamlKey="version" badge={<Pv kind={here(s.version)} />}>{s.version ? <span className="mono">"{s.version}"</span> : <span className="orr-empty">—</span>}</Row>
      <Row prov={here(s.description)} label={r.fDesc} yamlKey="description" badge={<Pv kind={here(s.description)} />}>{s.description ?? <span className="orr-empty">—</span>}</Row>
    </Section>
    {err ? (
      <Section title={r.sExec}><Row prov="unk" label={r.fRuntime} badge={<Pv kind="unk" source={r.why.unreadable} />}><span className="orr-empty">—</span></Row></Section>
    ) : <>
      <Section title={r.sExec}>{exec}</Section>
      {d.imports.length > 0 && <Section title={r.sImports}>
        {d.imports.map(i => (
          <Row key={i.key} prov={i.resolved ? 'here' : 'unk'} label={i.name ?? i.ref} yamlKey={i.key} badge={i.resolved ? <Pv kind="here" /> : <Pv kind="unk" source={r.why.unreadable} />}>
            <span className="mono">{i.ref}</span>
            <span className="orr-hint">{i.resolved ? <>→ <span className="mono">{i.path}</span> · <span className="orr-ok">✓ {r.resolved}</span></> : (i.error ?? r.unresolved)}</span>
          </Row>
        ))}
      </Section>}
      {profile && <Uses c={c} profile={profile} />}
      {d.resources.length > 0 && <Section title={r.sRes} sub={<span className="mono">resources</span>}>
        {d.resources.map(x => <Row key={`${x.category}-${x.id}`} prov={provOf(x.origin)} label={`${x.category} · ${x.id}`} yamlKey={keyOf(x.origin)} badge={<Pv origin={x.origin} />}><span className="mono">{x.path ?? x.absolutePath ?? x.id}</span></Row>)}
      </Section>}
      <StartupFiles c={c} />
      <Section title={r.sSeats} sub={r.sSeatsSub}>
        {d.seats.length ? <SeatsTable d={d} onLens={onLens} /> : <Row prov="abs" label="—"><span className="orr-empty">{r.noSeat}</span></Row>}
      </Section>
    </>}
  </>;
}

/** A value with its provenance, « non déclaré » when nothing writes it. */
function Sourced({ label, v, empty, hint }: { label: string; v: { value: string | null; origin: RoleDetail['defaults']['runtime']['origin'] }; empty?: ReactNode; hint?: ReactNode }) {
  const prov = provOf(v.origin);
  return (
    <Row prov={prov} label={label} yamlKey={keyOf(v.origin) ?? '—'} badge={<Pv origin={v.origin} />}>
      {v.value !== null ? <span className="mono">{v.value}</span> : typeof empty === 'string' || empty === undefined ? <span className="orr-empty">{empty ?? '—'}</span> : empty}
      {hint && <span className="orr-hint">{hint}</span>}
    </Row>
  );
}

function ModelToday({ d }: { d: RoleDetail }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const { models, seats } = seatModels(d);
  return <>
    <span className="orr-empty">{r.modelSpec}</span>
    {models.length > 0 && <span className="orr-hint">{r.modelToday} : {models.map((m, i) => <span key={m}>{i > 0 && ', '}<span className="mono">{m}</span></span>)} ({seats.join(', ')})</span>}
  </>;
}

function Uses({ c, profile }: { c: TabCtx; profile: RoleProfile }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const u = profile.uses;
  const loadout = c.seat?.live?.skills;
  const list = (label: string, l: RoleUsesList, item: (x: RoleResource) => ReactNode) => (
    !l.declared ? <Row key={l.key} prov="abs" label={label} yamlKey={l.key} badge={<Pv kind="abs" />}><span className="orr-empty">—</span></Row>
    : l.items.length === 0 ? <Row key={l.key} prov="here" label={label} yamlKey={l.key} badge={<Pv kind="here" />}><span className="orr-empty">{r.empty}</span></Row>
    : <Row key={l.key} prov={l.items.every(x => x.origin.kind === 'here') ? 'here' : 'inh'} label={label} yamlKey={l.key}>{l.items.map(x => <div key={x.id} className={cls('orr-sub', c.seat && x.runtime && c.seat.runtime.value && x.runtime !== c.seat.runtime.value && 'orr-na')}>{item(x)}<Pv origin={x.origin} /></div>)}</Row>
  );
  const plain = (x: RoleResource) => <span><span className="mono">{x.id}</span>{(x.path ?? x.absolutePath) && <span className="orr-hint mono">{x.path ?? x.absolutePath}</span>}</span>;
  return (
    <Section title={r.sUses(profile.name)} sub={<span className="mono">profiles.{profile.name}.uses</span>}>
      {loadout ? (
        <Row prov="inh" label={r.fSkills} yamlKey="rig skill loadout" badge={<Pv kind="inh" source={r.from.launch} />}>
          <span className="mono">{loadout.length}</span> · {r.loadout}<br />
          <button type="button" className="orr-exp" aria-expanded={!!open.loadout} onClick={() => toggle('loadout')}>{open.loadout ? r.hide : r.show}</button>
          {open.loadout && <div className="orr-chips">{loadout.map(s => <span key={s.id} className="orr-tag">{s.id}</span>)}</div>}
        </Row>
      ) : list(r.fSkills, u.skills, plain)}
      {list(r.fGuidance, u.guidance, plain)}
      {list(r.fSubagents, u.subagents, plain)}
      {list(r.fPlugins, u.plugins, x => (
        <span>
          <span className="mono">{x.id}</span>{(x.path ?? x.absolutePath) && <span className="orr-hint mono">{x.path}{x.path && x.absolutePath && x.path !== x.absolutePath ? ` → ${x.absolutePath}` : x.path ? '' : x.absolutePath}</span>}
          {x.plugin && <span className="orr-hint">{r.pluginCarries(x.plugin.skills.length, x.plugin.hooks)} <button type="button" className="orr-exp" aria-expanded={!!open[`p:${x.id}`]} onClick={() => toggle(`p:${x.id}`)}>{open[`p:${x.id}`] ? r.hide : r.show}</button></span>}
          {x.plugin && open[`p:${x.id}`] && <span className="orr-chips">{x.plugin.skills.map(s => <span key={s} className="orr-tag">{s}</span>)}</span>}
        </span>
      ))}
      {u.runtimeResources.declared && u.runtimeResources.items.length > 0 ? (
        <Row prov="inh" label={r.fRr} yamlKey={u.runtimeResources.key}>
          {u.runtimeResources.items.map(x => <RuntimeResource key={x.id} c={c} x={x} open={!!open[`r:${x.id}`]} onToggle={() => toggle(`r:${x.id}`)} />)}
          <div className="orr-sub"><span><span>{r.rrMerged}</span><span className="orr-hint">{r.rrMergedWhy}</span></span><Pv kind="unk" source={r.why.not_exposed} /></div>
        </Row>
      ) : list(r.fRr, u.runtimeResources, plain)}
    </Section>
  );
}

function RuntimeResource({ c, x, open, onToggle }: { c: TabCtx; x: RoleResource; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const na = !!(c.seat && x.runtime && c.seat.runtime.value && x.runtime !== c.seat.runtime.value);
  return (
    <div className={cls('orr-sub', na && 'orr-na')}>
      <span>
        <span className="mono">{x.id}</span>
        <span className="orr-hint">{x.type && <span className="orr-tag">{x.type}</span>}{x.runtime && <span className="orr-tag">{x.runtime}</span>}{x.target && <>{r.rrTarget} <span className="mono">{x.target}</span></>}{na && <><br />{r.rrNa(x.runtime!)}</>}</span>
        {x.absolutePath && <button type="button" className="orr-exp" aria-expanded={open} onClick={onToggle}>{open ? r.hide : r.showFragment}</button>}
        {open && <Fragment c={c} path={x.absolutePath} />}
      </span>
      <Pv origin={x.origin} />
    </div>
  );
}
function Fragment({ c, path }: { c: TabCtx; path?: string }) {
  const file = useRoleFile(c.client, c.machine, roleIdOf(c), path);
  return file.status === 'ready' ? <div className="orr-code">{file.content}</div> : <FileText state={file} raw path={path} />;
}

function StartupFiles({ c }: { c: TabCtx }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const { seat, profile, detail: d } = c;
  const own = profile?.startup ?? [];
  const entries = [...own, ...(seat?.memberStartup ?? [])];
  const adds = !seat ? d.seats.filter(s => s.memberStartup.some(e => e.kind === 'file')) : [];
  return (
    <Section title={r.sFiles} sub={seat ? r.sFilesSeat : r.sFilesSpec}>
      {entries.map((e, i) => (
        <Row key={i} prov={provOf(e.origin)} label={e.kind === 'action' ? r.fActions : e.path ?? '—'} yamlKey={keyOf(e.origin)} badge={<Pv origin={e.origin} />}>
          {e.kind === 'action' && <span className="mono">{e.builtin ?? e.value ?? '—'}</span>}
          <DeliveryTags e={e} />
          {e.layer === 'member' && e.absolutePath && <span className="orr-hint mono">{e.absolutePath}</span>}
        </Row>
      ))}
      {adds.length > 0 && <Row prov="abs" label={r.seatAdds} yamlKey="—">{adds.map(s => <span key={`${s.rig}/${s.logicalId}`} className="orr-line-block"><span className="mono">{s.logicalId}</span> + {s.memberStartup.filter(e => e.kind === 'file').map(e => <span key={e.path} className="mono">{e.path}</span>)}</span>)}</Row>}
      {entries.length === 0 && adds.length === 0 && <Row prov="abs" label={r.fActions} badge={<Pv kind="abs" />}><span className="orr-empty">—</span></Row>}
    </Section>
  );
}

function SeatsTable({ d, onLens }: { d: RoleDetail; onLens: (s: RoleSeat) => void }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  return (
    <table className="orr-seats">
      <thead><tr><th>{r.thSeat}</th><th>{r.thRig}</th><th>{r.thRt}</th><th>{r.thExtra}</th><th>{r.thState}</th><th /></tr></thead>
      <tbody>
        {d.seats.map(s => {
          const extra = s.memberStartup.filter(e => e.kind === 'file');
          const st = !s.running ? 'off' : s.activity === 'running' ? 'info' : 'ok';
          return (
            <tr key={`${s.rig}/${s.logicalId}`}>
              <td><span className="mono">{s.logicalId}</span>{s.label && <><br /><span className="orr-muted">{s.label}</span></>}</td>
              <td className="mono">{s.rig}</td>
              <td>{s.runtime.value === 'codex' ? 'Codex' : s.runtime.value === 'claude-code' ? 'Claude Code' : s.runtime.value ?? '—'}{s.model.value && <> · <span className="mono">{s.model.value}</span></>}</td>
              <td>{extra.length ? extra.map(e => <span key={e.path} className="mono orr-line-block">{e.path}</span>) : <span className="orr-empty">—</span>}</td>
              <td><span className={`or-pill or-${st}`}>{st === 'off' ? r.stStopped : st === 'info' ? r.stWork : r.stIdle}</span></td>
              <td className="orr-right"><button type="button" className="orr-btn" onClick={() => onLens(s)}>{r.viewFrom}</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** A spec without profiles, only imported by others (`shared`). */
function ImportOnly({ c }: { c: TabCtx }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const d = c.detail;
  const [bold, rest] = r.importOnlyNote;
  return <>
    <div className="orr-intro"><b>{bold}</b>{rest}</div>
    <Legend />
    <Section title={r.sIdent}>
      <Row prov="here" label={r.fName} yamlKey="name" badge={<Pv kind="here" />}><span className="mono">{d.summary.name}</span></Row>
      {d.summary.description && <Row prov="here" label={r.fDesc} yamlKey="description" badge={<Pv kind="here" />}>{d.summary.description}</Row>}
      {d.importedBy.length > 0 && <Row prov="here" label={r.importedBy}><span className="mono">{d.importedBy.join(', ')}</span></Row>}
    </Section>
    <Section title={r.sRes} sub={<span className="mono">resources</span>}>
      {d.resources.map(x => (
        <Row key={`${x.category}-${x.id}`} prov={provOf(x.origin)} label={`${x.category} · ${x.id}`} yamlKey={keyOf(x.origin)} badge={<Pv origin={x.origin} />}>
          <span className="mono">{x.path ?? x.id}</span>
          {(x.type || x.runtime) && <span className="orr-hint">{x.type && <span className="orr-tag">{x.type}</span>}{x.runtime && <span className="orr-tag">{x.runtime}</span>}</span>}
        </Row>
      ))}
      <Row prov="here" label={r.fProfile} yamlKey="profiles" badge={<Pv kind="here" />}><span className="mono">{'{}'}</span></Row>
    </Section>
  </>;
}

// ── Contexte de démarrage: the pieces, in OpenRig's order ──

export function ContextTab({ c }: { c: TabCtx }) {
  const { t, lang } = useI18n();
  const r = t.openrig.roles;
  const ps = pieces(c.detail, c.profile, c.seat);
  const firstReadable = Math.max(0, ps.findIndex(p => p.kind === 'entry' && p.entry.kind === 'file' && pieceTitle(p.entry) === 'role'));
  const [pick, setPick] = useState<number | null>(null);
  const [mode, setMode] = useState<'one' | 'all'>('one');
  const at = Math.min(pick ?? firstReadable, Math.max(0, ps.length - 1));
  const codex = c.seat?.runtime.value === 'codex';
  const [b1, b2] = c.seat ? r.ctxIntro(c.seat.logicalId, codex) : r.ctxSpec;
  const total = ps.reduce((n, p) => n + (p.kind === 'entry' && !isMissing(p.entry) ? p.entry.size ?? 0 : 0), 0);
  const notShown = c.detail.unavailable.filter(u => u !== 'harness_prompt');
  const keys = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const n = Math.max(0, Math.min(ps.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    setPick(n);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  };
  return <>
    <div className="orr-intro"><b>{b1}</b>{b2}{!c.seat && c.detail.seats.length === 0 && <> {r.ctxNoSeat}</>}</div>
    <div className="orr-ctxbar">
      <Seg label={r.modeLabel} value={mode} options={[{ value: 'one', label: r.one }, { value: 'all', label: r.all }]} onChange={setMode} />
      {c.seat && <span className="orr-dlegend"><span><KeyboardIcon /> {r.delivery.send_text}</span><span>▤ {r.delivery.guidance_merge(codex ? 'AGENTS.md' : 'CLAUDE.md')}</span><span>⚙ {r.delivery.action}</span><span className="mono">{formatSize(total, lang)} {r.readable}</span></span>}
    </div>
    <div className="orr-ctx">
      <div>
        <div className="orr-pieces" role="listbox" aria-label={r.piecesLabel}>
          {ps.map((p, i) => <PieceItem key={i} p={p} i={i} selected={i === at} onPick={() => setPick(i)} onKey={e => keys(e, i)} />)}
        </div>
        {c.seat && notShown.length > 0 && <div className="orr-notshown"><b>{r.notShown}</b><ul>{notShown.map(u => <li key={u}>{r.unavailable[u] ?? u}</li>)}</ul></div>}
      </div>
      {ps.length === 0 ? <div className="orr-reader"><div className="orr-rbody"><p className="orr-muted">{r.noRole}</p></div></div>
        : mode === 'all' ? (
          <div className="orr-reader">
            <div className="orr-rhead"><h4>{c.seat ? c.seat.logicalId : c.detail.summary.name} — {r.all}</h4><span className="orr-fill" /><RawSeg raw={c.raw} setRaw={c.setRaw} /></div>
            <div className="orr-rbody">{ps.map((p, i) => <div key={i}><div className="orr-allsep"><span className="mono">{i}</span><b>{titleOf(p, r)}</b><span className="mono">{srcOf(p, r)}</span><span className="orr-fill" />{p.kind === 'entry' ? <Pv origin={p.entry.origin} /> : <Pv kind="unk" source={r.why.not_exposed} />}</div><PieceBody c={c} p={p} /></div>)}</div>
          </div>
        ) : <PieceReader c={c} p={ps[at]!} />}
    </div>
  </>;
}

type RolesCopy = ReturnType<typeof useI18n>['t']['openrig']['roles'];
const titleOf = (p: Piece, r: RolesCopy): string => {
  if (p.kind === 'harness') return r.p.harness;
  const k = pieceTitle(p.entry);
  return k ? r.p[k] : p.entry.kind === 'action' ? p.entry.builtin ?? r.fActions : baseName(p.entry.path ?? '');
};
const srcOf = (p: Piece, r: RolesCopy): string => (p.kind === 'harness' ? r.harnessSrc : p.entry.kind === 'action' ? p.entry.builtin ?? p.entry.delivery : p.entry.path ?? '—');

function PieceItem({ p, i, selected, onPick, onKey }: { p: Piece; i: number; selected: boolean; onPick: () => void; onKey: (e: React.KeyboardEvent) => void }) {
  const { t, lang } = useI18n();
  const r = t.openrig.roles;
  const origin = p.kind === 'entry' ? p.entry.origin : undefined;
  const prov = origin ? provOf(origin) : 'unk';
  const ch = p.kind === 'entry' ? channelOf(p.entry) : null;
  return (
    <button type="button" role="option" aria-selected={selected} tabIndex={selected ? 0 : -1} className={`orr-piece orr-${prov}`} onClick={onPick} onKeyDown={onKey}>
      <span className="orr-n">{i}</span>
      <span className="orr-t">{titleOf(p, r)}<small>{srcOf(p, r)}</small></span>
      <span className="orr-sz">{p.kind === 'entry' ? formatSize(p.entry.size, lang) : '—'}</span>
      <span className="orr-pvw">{origin ? <Pv origin={origin} /> : <Pv kind="unk" source={r.why.not_exposed} />} <span className="orr-dl">{ch === 'send' ? <KeyboardIcon /> : ch === 'merge' ? '▤' : ch === 'action' ? '⚙' : ''}</span></span>
    </button>
  );
}

function PieceReader({ c, p }: { c: TabCtx; p: Piece }) {
  const { t, lang } = useI18n();
  const r = t.openrig.roles;
  const e = p.kind === 'entry' ? p.entry : null;
  const opaque = !e || isMissing(e);
  return (
    <div className="orr-reader">
      <div className="orr-rhead">
        <h4>{titleOf(p, r)}</h4>{e ? <Pv origin={e.origin} /> : <Pv kind="unk" source={r.why.not_exposed} />}
        <span className="orr-fill" />
        {!opaque && <><RawSeg raw={c.raw} setRaw={c.setRaw} /><PieceCopy c={c} e={e!} /></>}
        <div className="orr-meta">
          <span className="mono">{e ? tilde(e.absolutePath ?? e.path ?? '') || (e.builtin ? `builtin: ${e.builtin}` : '—') : r.harnessSrc}</span>
          {e && e.layer !== 'unknown' && <> · {r.layer} {r.layers[e.layer] ?? e.layer}{e.layerInferred && <> ({r.inferred})</>}</>}
          {e && <> · {formatSize(e.size, lang)}</>}
        </div>
        {e && <div className="orr-wide"><DeliveryTags e={e} /></div>}
      </div>
      <div className="orr-rbody"><PieceBody c={c} p={p} /></div>
    </div>
  );
}
function PieceCopy({ c, e }: { c: TabCtx; e: StartupEntry }) {
  const file = useRoleFile(c.client, c.machine, roleIdOf(c), e.kind === 'file' ? e.absolutePath : undefined);
  return <CopyButton icon text={e.kind === 'action' ? e.value ?? '' : file.status === 'ready' ? file.content : ''} />;
}

function PieceBody({ c, p }: { c: TabCtx; p: Piece }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  if (p.kind === 'harness') return <div className="orr-opaque"><span className="orr-big">◌</span><b>{r.opaqueT}</b><span>{r.opaqueD}</span></div>;
  const e = p.entry;
  if (isMissing(e)) return <div className="orr-opaque"><span className="orr-big">?</span><b>{r.missingT}</b><span>{r.missingD(baseName(e.path ?? ''), e.into ?? 'CLAUDE.md')}</span></div>;
  if (e.kind === 'action') return <div className="orr-raw">{e.value ?? ''}</div>;
  return <PieceFile c={c} e={e} />;
}
function PieceFile({ c, e }: { c: TabCtx; e: StartupEntry }) {
  const file = useRoleFile(c.client, c.machine, roleIdOf(c), e.absolutePath);
  return <FileText state={file} raw={c.raw} path={e.absolutePath ?? e.path} markdown={(e.path ?? '').endsWith('.md')} />;
}

// ── YAML source: the file as is, its imports and, from a seat, its member ──

export function YamlTab({ c, source }: { c: TabCtx; source: 'library' | 'repo' }) {
  const { t } = useI18n();
  const r = t.openrig.roles;
  const d = c.detail;
  const repo = d.file.copies.find(x => x.kind === 'repo');
  const path = source === 'repo' && repo ? repo.path : d.file.path;
  const file = useRoleFile(c.client, c.machine, roleIdOf(c), path);
  return <>
    <section className="orr-psec">
      <h3><span className="mono orr-path">{tilde(path)}</span><span className="orr-fill" />{file.status === 'ready' && <CopyButton text={file.content} />}</h3>
      <YamlFile state={file} path={path} hl={source === 'library' && d.error?.kind === 'invalid' ? d.error.line : undefined} />
    </section>
    {d.imports.filter(i => i.resolved && i.path).map(i => (
      <section key={i.key} className="orr-psec">
        <h3>{r.yImport} · <span className="mono">{i.path ? baseName(i.path.replace(/[\\/]agent\.yaml$/, '')) + '/agent.yaml' : i.ref}</span><Pv kind="inh" source={`${r.from.import} ${i.name ?? i.ref}`} /></h3>
        <ImportYaml c={c} path={i.path!} />
      </section>
    ))}
    {c.seat?.member && (
      <section className="orr-psec">
        <h3>{r.ySeat(c.seat.logicalId, c.seat.rigSpecPath ? tilde(c.seat.rigSpecPath) : 'rig.yaml')}<Pv kind="inh" source={`${r.from.member} ${c.seat.logicalId}`} /></h3>
        <Yaml text={c.seat.member} />
      </section>
    )}
  </>;
}
function ImportYaml({ c, path }: { c: TabCtx; path: string }) {
  return <YamlFile state={useRoleFile(c.client, c.machine, roleIdOf(c), path)} path={path} />;
}
function YamlFile({ state, path, hl }: { state: FileState; path: string; hl?: number }) {
  if (state.status !== 'ready') return <FileText state={state} raw path={path} />;
  return <Yaml text={state.content} {...(hl ? { hl } : {})} />;
}

/** The library's file beside the repository's, line by line. */
export function DiffView({ c }: { c: TabCtx }) {
  const d = c.detail;
  const repo = d.file.copies.find(x => x.kind === 'repo');
  const lib = useRoleFile(c.client, c.machine, roleIdOf(c), d.file.path);
  const other = useRoleFile(c.client, c.machine, roleIdOf(c), repo?.path);
  if (lib.status !== 'ready') return <FileText state={lib} raw path={d.file.path} />;
  if (other.status !== 'ready') return <FileText state={other} raw path={repo?.path} />;
  return <div className="orr-code orr-diff">{lineDiff(lib.content, other.content).map((l, i) => <span key={i} className={cls('orr-line', l.op === '-' && 'orr-del', l.op === '+' && 'orr-add')}>{l.op} {l.text}{'\n'}</span>)}</div>;
}

export { CopyIcon };
