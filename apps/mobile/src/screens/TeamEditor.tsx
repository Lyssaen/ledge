import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { EffortSchema, ModelIdSchema, TEAM_SEATS_MAX, TeamNameSchema, TemplateIdSchema, ToolSchema, type PhoneRole, type PhoneTeam, type PhoneTemplate } from '@ledge/protocol';
import { copy } from '../copy';
import { autoSeats, catalogKey, parseCatalogKey, rolesNotSeated, roleFor, scopeLabel } from '../model/catalog';
import { outcomeNote, type OutcomeNote } from '../model/teamsOutcome';
import { pendingAfter, runningSettings, type SeatSettings } from '../model/teamsPending';
import { goBack, href, navigate } from '../router';
import type { ChatAction } from '../state/chat';
import { useMobile, type MobileStore } from '../state/store';
import { Button, IconButton, chipClass } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { FIELD } from '../ui/field';
import { BackHeader, linkView } from '../ui/Header';
import { Icon } from '../ui/icons';
import { OfflineBanner } from '../ui/Notice';
import { RolePill } from '../ui/teams/RolePill';
import { EditorPending, useCatalogGate, useChangedWait, useMounted } from './teamsEditing';

const t = copy.teams.team;
type Seat = PhoneTemplate['seats'][number];
type Scope = 'home' | 'repo';

/** What the editor is for: a team definition (`key`: `new` or a catalog key), a live team's composition saved as a new definition, or a live team's own composition. */
export type TeamEditorMode = { kind: 'template'; key: string } | { kind: 'copy'; teamId: string } | { kind: 'live'; teamId: string };

/** What the user has typed over the team as shown; a field absent here follows the team. */
interface Edits { name?: string; project?: string; scope?: Scope; seats?: Seat[] }

const Label = ({ id, children }: { id: string; children: ReactNode }) => <label htmlFor={id} className="mb-1 block text-small text-muted">{children}</label>;
const HEAD = 'text-meta tracking-[.4px] text-muted';
const isAuto = (a: string | undefined) => a === 'auto';

/** A live team's seats as a composition: the ones not leaving, with what each was composed with. */
const seatsOfTeam = (team: PhoneTeam): Seat[] => team.seats.filter(s => !s.leaving).map(s => ({
  role: s.role, ...(s.tool ? { tool: s.tool } : {}), ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {})
}));

/** A seat as the protocol takes it: strict, no empty field. */
const seatOut = (s: Seat): Seat => ({
  role: s.role,
  ...(s.tool ? { tool: s.tool } : {}),
  ...(s.model?.trim() ? { model: s.model.trim() } : {}),
  ...(s.effort?.trim() ? { effort: s.effort.trim() } : {}),
  ...(s.name ? { name: s.name } : {})
});

/** « Changer »: the seat's tool, IA and effort. An empty field (« Par défaut ») removes the seat's own value. */
function ChangeSheet({ seat, role, onApply, onClose }: { seat: Seat; role: PhoneRole | undefined; onApply: (s: Seat) => void; onClose: () => void }) {
  const id = useId();
  const [tool, setTool] = useState<string>(seat.tool ?? '');
  const [model, setModel] = useState(seat.model ?? '');
  const [effort, setEffort] = useState(seat.effort ?? '');
  const modelOk = model.trim() === '' || ModelIdSchema.safeParse(model.trim()).success;
  const effortOk = effort.trim() === '' || EffortSchema.safeParse(effort.trim()).success;
  const apply = () => {
    const { tool: _tool, model: _model, effort: _effort, ...rest } = seat;
    onApply({
      ...rest,
      ...(tool !== '' ? { tool: ToolSchema.parse(tool) } : {}),
      ...(model.trim() !== '' ? { model: model.trim() } : {}),
      ...(effort.trim() !== '' ? { effort: effort.trim() } : {})
    });
  };
  return (
    <Sheet labelledBy={`${id}-title`} onClose={onClose}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{role?.label ?? `@${seat.role}`} <span className="font-mono text-role">@{seat.role}</span></h2>
      <div>
        <Label id={`${id}-tool`}>{copy.teams.role.tool}</Label>
        <select id={`${id}-tool`} value={tool} onChange={e => setTool(e.target.value)} className={FIELD}>
          <option value="">{copy.teams.role.unset}</option>
          {ToolSchema.options.map(k => <option key={k} value={k}>{copy.tools[k]}</option>)}
        </select>
      </div>
      <div>
        <Label id={`${id}-model`}>{copy.teams.role.model}</Label>
        <input id={`${id}-model`} type="text" value={model} maxLength={200} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!modelOk}
          placeholder={role?.model ?? copy.teams.role.unset} onChange={e => setModel(e.target.value)} className={FIELD} />
        {!modelOk && <p className="mt-1 text-meta text-danger-fg">{copy.teams.role.modelRule}</p>}
      </div>
      <div>
        <Label id={`${id}-effort`}>{copy.teams.role.effort}</Label>
        <input id={`${id}-effort`} type="text" value={effort} maxLength={20} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!effortOk}
          placeholder={role?.effort ?? copy.teams.role.unset} onChange={e => setEffort(e.target.value)} className={FIELD} />
        {!effortOk && <p className="mt-1 text-meta text-danger-fg">{copy.teams.role.effortRule}</p>}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onClose}>{copy.teams.cancel}</Button>
        <Button variant="primary" className="flex-[2]" disabled={!modelOk || !effortOk} onClick={apply}>{t.apply}</Button>
      </div>
    </Sheet>
  );
}

/** « Supprimer »: the definition goes, the teams already raised from it stay. */
function DeleteSheet({ name, busy, blocked, note, onConfirm, onClose }: { name: string; busy: boolean; blocked: boolean; note: OutcomeNote | null; onConfirm: () => void; onClose: () => void }) {
  const id = useId();
  return (
    <Sheet labelledBy={`${id}-title`} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{t.deleteTitle(name)}</h2>
      <p className="text-body text-muted">{t.deleteHint}</p>
      {note && <p role="status" className={`text-body ${note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{note.text}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{copy.teams.cancel}</Button>
        <Button variant="brand" className="flex-[2]" disabled={busy || blocked} onClick={onConfirm}>{t.delete}</Button>
      </div>
    </Sheet>
  );
}

/** The seat's second line: tool · IA · autonomy, the seat's own value over its role's default; effort only when the seat sets one. */
function SeatMeta({ seat, role }: { seat: Seat; role: PhoneRole | undefined }) {
  const tool = seat.tool ?? role?.tool;
  const model = seat.model ?? role?.model;
  const autonomy = role?.autonomy ?? 'ask';
  const text = [tool ? copy.tools[tool] : null, model ?? null, copy.teams.autonomy[autonomy], seat.effort ?? null].filter(x => x !== null).join(' · ');
  return <span className={isAuto(autonomy) ? 'text-attention' : ''}>{text}</span>;
}

/** The form itself. `initial` is the definition or live team it opens on (null for a new team); the screen is keyed by what it edits. */
function Form({ store, mode, initial }: { store: MobileStore; mode: TeamEditorMode; initial: PhoneTemplate | PhoneTeam | null }) {
  const state = useMobile(store);
  const { catalog, teams } = state;
  const ids = useId();
  const mounted = useMounted();
  const isLive = mode.kind === 'live';
  const isTemplate = mode.kind === 'template';
  // The definition as the PC last showed it: its hash is the base of the next write.
  const [shown, setShown] = useState<PhoneTemplate | null>(isTemplate ? initial as PhoneTemplate | null : null);
  const [edits, setEdits] = useState<Edits>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<OutcomeNote | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteNote, setDeleteNote] = useState<OutcomeNote | null>(null);
  const [restarting, setRestarting] = useState<{ role: string; note: OutcomeNote | null } | null>(null);
  const [reloaded, setReloaded] = useState(false);
  // The definition was deleted on the PC: what the user typed stays on screen, but there is no file left to write over.
  const [gone, setGone] = useState(false);
  const tplKey = isTemplate && mode.key !== 'new' ? parseCatalogKey(mode.key) : null;

  // « changed »: the next catalog brings the version the PC has now. It becomes the base of the next write; the user's edits stay over it.
  const changed = useChangedWait(store, catalog, fresh => {
    const found = fresh?.templates.find(x => tplKey !== null && x.id === tplKey.id && x.scope === tplKey.scope && x.project === tplKey.project);
    if (found) { setShown(found); setReloaded(true); } else if (tplKey !== null) { setGone(true); setReloaded(false); }
  });

  const liveNow = !isTemplate && teams ? teams.find(x => x.id === mode.teamId) ?? null : null;
  const teamNow = !isTemplate ? (isLive ? liveNow ?? initial as PhoneTeam : initial as PhoneTeam) : null;
  // A live team that is no longer there (dissolved on the PC): nothing left to compose.
  const teamGone = isLive && liveNow === null;

  // What each seat runs with, from when the screen opened (seats that are leaving included): it moves only when a seat is started again.
  // `applied` is what the last saved composition asks of each seat; the two together say what is left to do.
  const settingsOf = (project: string | null, s: Seat): SeatSettings => { const r = catalog ? roleFor(catalog, project, s.role) : undefined; return { tool: s.tool ?? r?.tool, model: s.model ?? r?.model, effort: s.effort ?? r?.effort }; };
  const [ran, setRan] = useState<ReadonlyMap<string, SeatSettings>>(() => isLive && teamNow && catalog ? runningSettings(teamNow, id => settingsOf(teamNow.project, { role: id })) : new Map());
  const [applied, setApplied] = useState<ReadonlyArray<SeatSettings & { role: string }>>([]);
  const pending = useMemo(() => pendingAfter(ran, applied), [ran, applied]);

  const defaults = {
    name: shown?.name ?? teamNow?.name ?? '',
    seats: shown?.seats ?? (teamNow ? seatsOfTeam(teamNow) : []),
    project: shown ? (shown.scope === 'repo' ? shown.project ?? '' : '')
      : teamNow?.project && catalog?.projects.includes(teamNow.project) ? teamNow.project : isLive ? teamNow?.project ?? '' : ''
  };
  const name = edits.name ?? defaults.name;
  const seats = edits.seats ?? defaults.seats;
  const project = edits.project ?? defaults.project;
  const scope: Scope = shown ? shown.scope : edits.scope ?? 'home';
  const setSeats = (next: Seat[]) => setEdits(prev => ({ ...prev, seats: next }));

  const roleOf = (id: string) => catalog ? roleFor(catalog, project === '' ? null : project, id) : undefined;
  const nameOk = TeamNameSchema.safeParse(name).success;
  const seatsOk = seats.length >= 1 && seats.length <= TEAM_SEATS_MAX;
  const handNamed = shown !== null && !TemplateIdSchema.safeParse(shown.id).success;
  const storeProject = scope === 'repo' ? project : '';
  const canConfirm = !!state.device?.confirm;
  const online = canConfirm && state.fresh && !busy;
  // Writing a definition: its storage is known (a Dépôt names its project), and no « changed » is waiting for the file to be read again.
  const canWrite = online && nameOk && seatsOk && (scope === 'home' || project !== '') && !changed.waiting && !gone && !handNamed;
  const canLaunch = online && nameOk && seatsOk && project !== '';
  const canCompose = online && seatsOk && !teamGone;

  const projects = catalog?.projects ?? [];
  const projectOptions = project !== '' && !projects.includes(project) ? [project, ...projects] : projects;
  // What « Ajouter un rôle » offers: the roles the project's team can read, one per id, that no seat names.
  const resolvable = (catalog?.roles ?? []).filter((r, i, all) => all.findIndex(x => x.id === r.id) === i && roleOf(r.id) !== undefined);
  const addable = rolesNotSeated(seats, resolvable);
  const seatRoles = seats.map(s => roleOf(s.role)).filter(r => r !== undefined);
  const warned = autoSeats(seats, seatRoles);

  const run = (send: () => Promise<ChatAction>, opts: { fallback: string; reasons?: Partial<Record<string, string>>; onNote: (n: OutcomeNote | null) => void; onApplied: () => void; write?: boolean }) => {
    setBusy(true); opts.onNote(null);
    void send()
      .then(r => {
        if (r.status === 'applied') { if (mounted.current) opts.onApplied(); return; }
        opts.onNote(outcomeNote(r, opts.fallback, opts.reasons));
        // The file moved under the user: the catalog tells how, and the editor adopts it once it arrives.
        if (opts.write && r.status === 'rejected' && r.reason === 'changed') changed.begin();
      }, () => opts.onNote({ text: opts.fallback, quiet: false }))
      .finally(() => { if (mounted.current) setBusy(false); });
  };
  const outSeats = seats.map(seatOut);
  const where = { scope, ...(scope === 'repo' ? { project } : {}) };

  const saveTemplate = () => {
    if (!canWrite) return;
    run(() => store.define({ type: 'template.write', ...where, ...(shown ? { id: shown.id } : {}), name: name.trim(), seats: outSeats, base: shown?.hash ?? null }),
      { fallback: t.notSaved, reasons: { exists: t.exists, invalid: t.invalid }, onNote: setNote, write: true, onApplied: () => goBack({ name: 'teams' }) });
  };
  const deleteTemplate = () => {
    if (!shown || !online || handNamed || gone || changed.waiting) return;
    run(() => store.define({ type: 'template.delete', scope: shown.scope, ...(shown.project !== null ? { project: shown.project } : {}), id: shown.id, base: shown.hash }),
      { fallback: t.notDeleted, onNote: setDeleteNote, write: true, onApplied: () => { setDeleting(false); goBack({ name: 'teams' }); } });
  };
  const launch = () => {
    if (!canLaunch) return;
    // A definition that was deleted meanwhile is no longer one to name.
    run(() => store.teamOp({ type: 'team.launch', project, name: name.trim(), seats: outSeats, ...(shown && !gone ? { template: shown.id } : {}) }),
      { fallback: copy.chat.team.notLaunched, onNote: setNote, onApplied: () => navigate({ name: 'agents' }) });
  };
  const compose = () => {
    if (!canCompose || mode.kind !== 'live' || !teamNow || !catalog) return;
    const sent = seats.map(x => ({ role: x.role, ...settingsOf(teamNow.project, x) }));
    run(() => store.teamOp({ type: 'team.compose', team: mode.teamId, seats: outSeats }),
      { fallback: t.notSaved, reasons: { invalid: t.notSaved, changed: t.notSaved }, onNote: setNote, onApplied: () => { setNote({ text: t.composed, quiet: true }); setApplied(sent); } });
  };
  // A seat that holds no session is started; one that holds one is restarted (a start on a held seat is refused).
  const sessionOf = (role: string) => liveNow?.seats.find(x => x.role === role)?.sessionId ?? null;
  const restart = (role: string) => {
    if (mode.kind !== 'live' || !online) return;
    const action = sessionOf(role) === null ? 'start' : 'restart';
    const asked = applied.find(x => x.role === role);
    setBusy(true); setNote(null); setRestarting({ role, note: null });
    void store.teamOp({ type: 'team.seat', team: mode.teamId, role, action })
      .then(r => {
        if (!mounted.current) return;
        if (r.status === 'applied') { if (asked) setRan(prev => new Map(prev).set(role, asked)); setRestarting(null); }
        else setRestarting({ role, note: outcomeNote(r, action === 'start' ? t.notStarted : t.notRestarted) });
      }, () => { if (mounted.current) setRestarting({ role, note: { text: action === 'start' ? t.notStarted : t.notRestarted, quiet: false } }); })
      .finally(() => { if (mounted.current) setBusy(false); });
  };

  const changingSeat = changing !== null ? seats.find(s => s.role === changing) : undefined;
  const stale = reloaded && Object.keys(edits).length > 0;
  const title = isLive ? t.composeTitle : mode.kind === 'copy' ? t.copyTitle : shown ? shown.name : copy.teams.newTeam;
  const back = isLive ? { name: 'live' as const, teamId: mode.teamId } : mode.kind === 'copy' ? { name: 'live' as const, teamId: mode.teamId } : { name: 'teams' as const };

  return (
    <>
      <BackHeader title={title} fallback={back} label={isLive || mode.kind === 'copy' ? copy.nav.back : copy.nav.backTo.teams ?? copy.nav.back} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {!state.fresh && <div className="mt-3"><OfflineBanner /></div>}
        <h1 className="mt-3 mb-3 text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{title}</h1>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label id={`${ids}-name`}>{copy.teams.name}</Label>
            <input id={`${ids}-name`} type="text" value={name} readOnly={isLive} maxLength={isLive ? undefined : 60} autoComplete="off" aria-invalid={!isLive && !nameOk}
              aria-describedby={!isLive && !nameOk ? `${ids}-rule` : undefined} onChange={e => setEdits(prev => ({ ...prev, name: e.target.value }))} className={`${FIELD} ${isLive ? 'text-muted' : ''}`} />
          </div>
          <div>
            <Label id={`${ids}-project`}>{copy.teams.project}</Label>
            <select id={`${ids}-project`} value={project} disabled={isLive || (shown?.scope === 'repo')} onChange={e => setEdits(prev => ({ ...prev, project: e.target.value }))} className={FIELD}>
              <option value="" disabled>{copy.teams.pickProject}</option>
              {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        {!isLive && !nameOk && <p id={`${ids}-rule`} className="mt-1 text-meta text-danger-fg">{t.nameRule}</p>}
        {!isLive && projects.length === 0 && <p className="mt-1 text-small text-attention">{copy.teams.noProject}</p>}

        <div className="flex items-center justify-between gap-2 pt-4 pb-1.5">
          <span className={HEAD}>{t.seats(seats.length, TEAM_SEATS_MAX)}</span>
        </div>
        {seats.length === 0 && <p className="pb-2 text-body text-muted">{t.noSeats}</p>}
        <ul aria-label={t.seatsLabel} className="flex flex-col gap-2">
          {seats.map(s => {
            const r = roleOf(s.role);
            // A definition's own values are its overrides; a live team's composed values are what it runs with, so only a change made here is « modifié ».
            const base = mode.kind === 'template' ? undefined : defaults.seats.find(x => x.role === s.role);
            const own = mode.kind === 'template' || !base ? s.tool !== undefined || s.model !== undefined || s.effort !== undefined : base.tool !== s.tool || base.model !== s.model || base.effort !== s.effort;
            const p = pending[s.role];
            const held = sessionOf(s.role) !== null;
            return (
              <li key={s.role} className="rounded-card bg-surface px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><RolePill role={s.role} />{r && <span className="font-semibold [overflow-wrap:anywhere]">{r.label}</span>}</div>
                    <div className="mt-0.5 text-small [overflow-wrap:anywhere] text-muted"><SeatMeta seat={s} role={r} />{own && <span className="text-info"> · {t.modified}</span>}</div>
                  </div>
                  <Button size="sm" aria-label={t.changeSeat(s.role)} onClick={() => setChanging(s.role)}>{t.change}</Button>
                  <IconButton label={t.removeSeat(s.role)} onClick={() => setSeats(seats.filter(x => x.role !== s.role))}><Icon name="close" className="size-4" /></IconButton>
                </div>
                {catalog && !r && <p className="mt-1 text-small text-attention">{t.unknownRole(s.role)}</p>}
                {p?.restart && (
                  <div className="mt-2 text-small text-muted">
                    <Button size="sm" disabled={!online || teamGone} onClick={() => restart(s.role)}>{held ? t.restart : t.start}</Button>
                    {held && <p className="mt-1">{t.restartHint}</p>}
                    {restarting?.role === s.role && restarting.note && <p role="status" className={`mt-1 ${restarting.note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{restarting.note.text}</p>}
                  </div>
                )}
                {!p?.restart && p?.next && <p className="mt-1 text-small text-info">{t.nextStart}</p>}
              </li>
            );
          })}
        </ul>

        {seats.length < TEAM_SEATS_MAX && (
          <section aria-label={t.addRole}>
            <div className={`pt-3.5 pb-1.5 uppercase ${HEAD}`}>{t.addRole}</div>
            <div className="flex flex-wrap gap-2">
              {addable.map(r => (
                <button key={r.id} type="button" onClick={() => setSeats([...seats, { role: r.id }])}
                  className="inline-flex min-h-11 items-center rounded-control border border-dashed border-input px-3 font-mono text-small text-role active:bg-raised">+ @{r.id}</button>
              ))}
              <a href={href({ name: 'role', key: 'new' })} className="inline-flex min-h-11 items-center px-3 text-small text-info">{t.newRole}</a>
            </div>
          </section>
        )}

        {!isLive && (
          <>
            <div className={`pt-3.5 pb-1.5 ${HEAD}`}>{t.scopeHead}</div>
            {shown ? <p className="text-body text-muted">{t.fixedScope(scopeLabel(shown.scope, shown.project))}</p> : (
              <>
                <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
                  <legend className="sr-only">{t.scopeLegend}</legend>
                  {([['home', t.home], ['repo', t.repo(project)]] as const).map(([value, text]) => (
                    <label key={value} className={`${chipClass(scope === value)} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info`}>
                      <input type="radio" name={`${ids}-scope`} checked={scope === value} onChange={() => setEdits(prev => ({ ...prev, scope: value }))} className="sr-only" />
                      {text}
                    </label>
                  ))}
                </fieldset>
                <p className="mt-1 text-meta text-muted">{scope === 'home' ? t.homeHint : t.repoHint(project)}</p>
              </>
            )}
          </>
        )}

        {warned.map(id => <p key={id} role="note" className="mt-3 text-body text-attention">{copy.chat.team.autoWarning(`@${id}`)}</p>)}
        {handNamed && <p className="mt-3 text-body text-attention">{t.handNamed}</p>}
        {(gone || teamGone) && <p className="mt-3 text-body text-attention">{t.gone}</p>}
        {stale && (
          <div className="mt-3 text-body text-attention">
            <p>{t.changedKept}</p>
            <Button size="sm" className="mt-2" onClick={() => { setEdits({}); setNote(null); setReloaded(false); }}>{copy.teams.role.takePc}</Button>
          </div>
        )}
        {note && <p role="status" className={`mt-3 text-body ${note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{note.text}</p>}

        {isLive ? (
          <Button variant="brand" size="lg" block className="mt-5" disabled={!canCompose} onClick={compose}>{t.save}</Button>
        ) : (
          <>
            <Button variant="brand" size="lg" block className="mt-5" disabled={!canLaunch} onClick={launch}>{copy.teams.launchSeats(seats.length)}</Button>
            <Button variant="outline" block className="mt-2" disabled={!canWrite} onClick={saveTemplate}>{t.save}</Button>
          </>
        )}
        {canConfirm
          ? <p className="mt-2 text-center text-small text-muted">{isLive ? t.composeNote : t.launchNote}</p>
          : <p className="mt-2 text-center text-body text-attention">{copy.chat.launchSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>}
        {shown && <Button variant="outline" block className="mt-4" disabled={!online || handNamed || gone} onClick={() => { setDeleteNote(null); setDeleting(true); }}>{t.delete}</Button>}
      </main>
      {changingSeat && <ChangeSheet seat={changingSeat} role={roleOf(changingSeat.role)} onClose={() => setChanging(null)} onApply={s => { setSeats(seats.map(x => x.role === s.role ? s : x)); setChanging(null); }} />}
      {deleting && shown && <DeleteSheet name={shown.name} busy={busy} blocked={changed.waiting || gone} note={deleteNote} onConfirm={deleteTemplate} onClose={() => setDeleting(false)} />}
    </>
  );
}

/** The team editor. It waits for the PC's catalog (and, for a live team, the team), then hands the form what it opens on. */
export function TeamEditor({ store, mode }: { store: MobileStore; mode: TeamEditorMode }) {
  const { catalog, teams } = useMobile(store);
  const gate = useCatalogGate(store);
  const isNew = mode.kind === 'template' && mode.key === 'new';
  const tplKey = mode.kind === 'template' && !isNew ? parseCatalogKey(mode.key) : null;
  const found: PhoneTemplate | PhoneTeam | null = mode.kind === 'template'
    ? catalog?.templates.find(x => tplKey !== null && x.id === tplKey.id && x.scope === tplKey.scope && x.project === tplKey.project) ?? null
    : teams?.find(x => x.id === mode.teamId) ?? null;
  // The form starts from what the PC had when it first showed it; the PC moving afterwards is the form's to handle.
  const first = useRef<PhoneTemplate | PhoneTeam | null>(null);
  if (!first.current && found) first.current = found;

  // The PC pushes the live teams on its own: until they have come, a team that is not there yet is not a team that does not exist.
  if (!catalog || (mode.kind !== 'template' && teams === null)) return <EditorPending store={store} waited={gate.waited} retry={gate.retry} missing={null} />;
  if (!isNew && !first.current) return <EditorPending store={store} waited={gate.waited} retry={gate.retry} missing={t.missing} />;
  const formKey = mode.kind === 'template' ? (isNew ? 'new' : catalogKey(first.current as PhoneTemplate)) : `${mode.kind}:${mode.teamId}`;
  return <Form key={formKey} store={store} mode={mode} initial={isNew ? null : first.current} />;
}
