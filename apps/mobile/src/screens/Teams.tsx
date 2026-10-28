import { useEffect, useId, useState } from 'react';
import type { PhoneCatalog, PhoneProblem, PhoneRole, PhoneTemplate } from '@ledge/protocol';
import { copy } from '../copy';
import { catalogKey, scopeLabel } from '../model/catalog';
import { outcomeNote, type OutcomeNote } from '../model/teamsOutcome';
import { requestsOf } from '../model/requests';
import { closedTasks } from '../model/teams';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { Button, buttonClass } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { FIELD } from '../ui/field';
import { Header, linkView } from '../ui/Header';
import { Icon } from '../ui/icons';
import { Notice, OfflineBanner } from '../ui/Notice';
import { TabBar } from '../ui/TabBar';
import { Tag } from '../ui/Tag';
import { Flag, RolePill } from '../ui/teams/RolePill';

/** How long the tab waits for the PC's catalog before saying it is unavailable: a read the PC never got is never answered. A refusal says so at once. */
export const CATALOG_WAIT_MS = 8_000;

const HEAD = 'py-3 text-meta tracking-[.4px] text-muted';
const ROW = 'min-w-0 flex-1 py-3 active:bg-raised/60';

/** « Lever »: the project and the name of the team a definition raises. Its seats go as the definition has them. */
function LeverSheet({ store, catalog, template, canConfirm, onClose, onLaunched }: {
  store: MobileStore; catalog: PhoneCatalog; template: PhoneTemplate; canConfirm: boolean; onClose: () => void; onLaunched: (name: string) => void;
}) {
  const id = useId();
  // A Dépôt team starts on its own project; a Maison team has none until one is picked.
  const [project, setProject] = useState(template.project !== null && catalog.projects.includes(template.project) ? template.project : '');
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<OutcomeNote | null>(null);
  const given = name.trim();
  const ready = project !== '' && given.length > 0 && canConfirm;
  const go = () => {
    setBusy(true); setNote(null);
    void store.teamOp({ type: 'team.launch', project, name: given, seats: template.seats, template: template.id })
      .then(r => { if (r.status === 'applied') { onLaunched(given); onClose(); } else setNote(outcomeNote(r, copy.chat.team.notLaunched)); }, () => setNote({ text: copy.chat.team.notLaunched, quiet: false }))
      .finally(() => setBusy(false));
  };
  return (
    // While the launch waits, nothing closes the sheet: its outcome must land here, and a late success must not close one the user reopened.
    <Sheet labelledBy={`${id}-title`} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{copy.teams.levering(template.name)}</h2>
      <div>
        <label htmlFor={`${id}-name`} className="mb-2 block text-small text-muted">{copy.teams.name}</label>
        <input id={`${id}-name`} type="text" value={name} maxLength={60} autoComplete="off" onChange={e => setName(e.target.value)} className={FIELD} />
      </div>
      <div>
        <label htmlFor={`${id}-project`} className="mb-2 block text-small text-muted">{copy.teams.project}</label>
        <select id={`${id}-project`} value={project} onChange={e => setProject(e.target.value)} className={FIELD}>
          <option value="" disabled>{copy.teams.pickProject}</option>
          {catalog.projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      {!canConfirm && <p className="text-body text-attention">{copy.chat.launchSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>}
      {note && <p role="status" className={`text-body ${note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{note.text}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{copy.teams.cancel}</Button>
        <Button variant="primary" className="flex-[2]" disabled={busy || !ready} onClick={go}>{copy.teams.launchSeats(template.seats.length)}</Button>
      </div>
    </Sheet>
  );
}

/** A role's second line: its tool, model and autonomy (`auto` in the warning colour), then its repository when it is not the home's. */
function RoleMeta({ role }: { role: PhoneRole }) {
  const autonomy = role.autonomy ?? 'ask';
  const parts = [role.tool ? copy.tools[role.tool] : null, role.model ?? null,
    <span key="a" className={autonomy === 'auto' ? 'text-attention' : autonomy === 'edits' ? 'text-info' : ''}>{copy.teams.autonomy[autonomy]}</span>,
    role.scope === 'repo' ? scopeLabel(role.scope, role.project) : null].filter(x => x !== null);
  return <>{parts.map((x, i) => <span key={i}>{i > 0 ? ' · ' : ''}{x}</span>)}</>;
}

/** A problem as the phone says it: the file's name (never a path), where it lives, why. */
const problemText = (p: PhoneProblem) => `${p.file.split(/[\\/]/).pop()} · ${scopeLabel(p.scope, p.project)} · ${p.reason}`;

/** The Équipes tab: the team definitions, the roles and the files that could not be read, as the PC's catalog has them. */
export function Teams({ store, onReconnect }: { store: MobileStore; onReconnect?: () => void }) {
  const state = useMobile(store);
  const { catalog } = state;
  const offline = !state.fresh;
  const have = catalog !== null;
  const [attempt, setAttempt] = useState(0);
  const [waited, setWaited] = useState(false);
  const [leveling, setLeveling] = useState<PhoneTemplate | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);

  // Asked on mount, when the link turns fresh, and on « Réessayer ».
  useEffect(() => { store.requestCatalog(); }, [store, state.fresh, attempt]);
  // A read the PC never got is never answered: past the wait, the tab says so instead of waiting for ever.
  useEffect(() => {
    setWaited(false);
    if (have) return;
    const timer = setTimeout(() => setWaited(true), CATALOG_WAIT_MS);
    return () => clearTimeout(timer);
  }, [have, state.fresh, attempt]);

  const sessions = [...state.sessions.values()];
  // Live teams raised from a definition of the list. Ids are unique only within a scope: another scope's team of the same id can match.
  const templateIds = new Set(catalog?.templates.map(t => t.id));
  const raised = (state.teams ?? []).filter(t => t.template !== undefined && templateIds.has(t.template));
  const canConfirm = !!state.device?.confirm;
  const lever = catalog !== null && catalog.projects.length > 0;
  // Refused by a PC that does not say it serves the catalog: most likely one older than the Équipes tab.
  const outdated = state.catalogRefused && !state.daemon?.teams;

  return (
    <>
      <Header title={copy.nav.teams} subtitle={catalog ? copy.teams.subtitle(catalog.templates.length, catalog.roles.length) : ''} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {offline && <div className="mb-3"><OfflineBanner onReconnect={onReconnect} /></div>}
        {!catalog && (waited || state.catalogRefused ? (
          <Notice title={copy.teams.unavailable} tone="plain">
            {outdated && <p>{copy.teams.outdated}</p>}
            <button type="button" onClick={() => { if (offline && onReconnect) onReconnect(); else setAttempt(n => n + 1); }} className={buttonClass({ block: true, className: 'mt-3' })}>{copy.teams.retry}</button>
          </Notice>
        ) : <p role="status" className="py-6 text-center text-body text-muted">{copy.teams.loading}</p>)}
        {catalog && (
          <>
            <a href={href({ name: 'team', key: 'new' })} className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>{copy.teams.newTeam}</a>
            {launched && <p role="status" className="mt-3 text-body text-ok">{copy.teams.launched(launched)}</p>}
            <section aria-label={copy.teams.teamsLabel}>
              <div className={HEAD}>{copy.teams.teamsHead}</div>
              {!lever && catalog.templates.length > 0 && <p className="pb-2 text-small text-attention">{copy.teams.noProject}</p>}
              {catalog.templates.length === 0 && <p className="pb-2 text-body text-muted">{copy.teams.noTeams}</p>}
              <ul>
                {catalog.templates.map(t => (
                  <li key={catalogKey(t)} className="flex items-center gap-3 border-b border-line">
                    <a href={href({ name: 'team', key: catalogKey(t) })} className={ROW}>
                      <span className="flex flex-wrap items-center gap-2"><Flag /><span className="font-semibold [overflow-wrap:anywhere]">{t.name}</span><Tag tone="muted" label={scopeLabel(t.scope, t.project)} /></span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">{t.seats.map(s => <RolePill key={s.role} role={s.role} />)}</span>
                    </a>
                    {lever && <Button size="sm" aria-label={copy.teams.levering(t.name)} disabled={offline} onClick={() => { setLaunched(null); setLeveling(t); }}>{copy.teams.lever}</Button>}
                  </li>
                ))}
              </ul>
              {raised.map(t => (
                <a key={t.id} href={href({ name: 'agents' })} className="block py-3 text-body text-info underline underline-offset-2">{copy.teams.live(t.name)}</a>
              ))}
            </section>
            <section aria-label={copy.teams.rolesLabel}>
              <div className="flex items-center justify-between gap-2">
                <div className={HEAD}>{copy.teams.rolesHead}</div>
                <a href={href({ name: 'role', key: 'new' })} className="py-3 text-body text-info">{copy.teams.newRole}</a>
              </div>
              {catalog.roles.length === 0 && <p className="pb-2 text-body text-muted">{copy.teams.noRoles}</p>}
              <ul>
                {catalog.roles.map(r => (
                  <li key={catalogKey(r)} className="border-b border-line">
                    <a href={href({ name: 'role', key: catalogKey(r) })} className="flex items-center gap-3 py-3 active:bg-raised/60">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2"><RolePill role={r.id} /><span className="font-semibold [overflow-wrap:anywhere]">{r.label}</span></span>
                        <span className="mt-1 block text-small [overflow-wrap:anywhere] text-muted"><RoleMeta role={r} /></span>
                      </span>
                      <span className="flex-none text-muted"><Icon name="chevron" /></span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            {catalog.problems.length > 0 && (
              <section aria-label={copy.teams.problemsLabel}>
                <div className={HEAD}>{copy.teams.problemsHead}</div>
                <ul className="flex flex-col gap-2 text-small text-muted">
                  {catalog.problems.map((p, i) => <li key={i} className="[overflow-wrap:anywhere]">{problemText(p)}</li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      <TabBar count={requestsOf(sessions).length + closedTasks(state.tasks.values()).length} active="teams" chat={!!state.device?.chat} />
      {leveling && catalog && <LeverSheet store={store} catalog={catalog} template={leveling} canConfirm={canConfirm} onClose={() => setLeveling(null)} onLaunched={setLaunched} />}
    </>
  );
}
