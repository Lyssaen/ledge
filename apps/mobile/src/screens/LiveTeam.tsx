import { useId, useState } from 'react';
import type { PhoneCatalog, PhoneRole, PhoneTeam, PhoneTemplate } from '@ledge/protocol';
import { copy } from '../copy';
import { sessionStatus, type Tone } from '../model/agents';
import { catalogKey, roleFor } from '../model/catalog';
import { outcomeNote, type OutcomeNote } from '../model/teamsOutcome';
import { goBack, href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { buttonClass, Button } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { BackHeader, linkView } from '../ui/Header';
import { OfflineBanner } from '../ui/Notice';
import { Flag, Progress, RolePill } from '../ui/teams/RolePill';
import { SeatMeta } from '../ui/teams/SeatMeta';
import { Gone } from './Gone';
import { clock } from './Inbox';
import { EditorPending, seatAction, useCatalogGate, useMounted } from './teamsEditing';

const t = copy.teams.sheet;
const AGENTS = { name: 'agents' } as const;
const TEXT: Record<Tone, string> = { approval: 'text-approval', attention: 'text-attention', info: 'text-info', ok: 'text-ok', muted: 'text-muted', danger: 'text-danger-fg' };

/** The team's definition, when the catalog still has it: the team's own project first, then Maison. */
function templateOf(team: PhoneTeam, catalog: PhoneCatalog): PhoneTemplate | undefined {
  if (!team.template) return undefined;
  const same = catalog.templates.filter(x => x.id === team.template);
  return same.find(x => x.scope === 'repo' && x.project === team.project) ?? same.find(x => x.scope === 'home');
}

/** The first two lines of a role's prompt, as the catalog has it (cut for the phone or not). */
const preview = (prompt: string): string => prompt.split('\n').filter(l => l.trim() !== '').slice(0, 2).join('\n');

/** « Dissoudre l'équipe »: irreversible, so it asks first; it cannot be closed while it runs. */
function DissolveSheet({ name, busy, note, onConfirm, onClose }: { name: string; busy: boolean; note: OutcomeNote | null; onConfirm: () => void; onClose: () => void }) {
  const id = useId();
  return (
    <Sheet labelledBy={`${id}-title`} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{t.dissolveTitle(name)}</h2>
      <p className="text-body text-muted">{t.dissolveHint}</p>
      {note && <p role="status" className={`text-body ${note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{note.text}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{copy.teams.cancel}</Button>
        <Button variant="brand" className="flex-[2]" disabled={busy} onClick={onConfirm}>{t.dissolve}</Button>
      </div>
    </Sheet>
  );
}

/** Who holds a seat, or why nobody does. */
function Holder({ seat, store }: { seat: PhoneTeam['seats'][number]; store: MobileStore }) {
  const session = useMobile(store).sessions.get(seat.sessionId ?? '');
  if (seat.leaving) return <span className="text-small text-muted">{t.leaving}</span>;
  if (!seat.sessionId) return <span className="text-small text-muted">{t.free}</span>;
  if (!session) return <span className="text-small text-muted">{t.unknownSession}</span>;
  const status = sessionStatus(session);
  return <span className={`text-small ${TEXT[status.tone]}`}>{session.name} · {status.label}</span>;
}

function Body({ store, team, catalog, mounted }: { store: MobileStore; team: PhoneTeam; catalog: PhoneCatalog; mounted: { current: boolean } }) {
  const state = useMobile(store);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState<{ role: string; note: OutcomeNote } | null>(null);
  const [dissolving, setDissolving] = useState(false);
  const [dissolveNote, setDissolveNote] = useState<OutcomeNote | null>(null);
  const canConfirm = !!state.device?.confirm;
  const online = canConfirm && state.fresh && !busy;
  const template = templateOf(team, catalog);

  const start = (role: string) => {
    if (!online) return;
    setBusy(true); setStarting(null);
    void seatAction(store, team.id, role, 'start')
      .then(failed => { if (mounted.current && failed) setStarting({ role, note: failed }); })
      .finally(() => { if (mounted.current) setBusy(false); });
  };
  const dissolve = () => {
    if (!online) return;
    setBusy(true); setDissolveNote(null);
    store.teamOp({ type: 'team.dissolve', team: team.id })
      .then(r => {
        if (!mounted.current) return;
        if (r.status === 'applied') goBack(AGENTS);
        else setDissolveNote(outcomeNote(r, t.notDissolved));
      }, () => { if (mounted.current) setDissolveNote({ text: t.notDissolved, quiet: false }); })
      .finally(() => { if (mounted.current) setBusy(false); });
  };

  const where = [team.project, team.state === 'resting' ? t.resting : t.since(clock(team.createdAt)), template ? t.from(template.name) : null].filter(x => x).join(' · ');
  return (
    <>
      <BackHeader title={team.name} fallback={AGENTS} label={copy.nav.backTo.agents ?? copy.nav.back} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {!state.fresh && <div className="mt-3"><OfflineBanner /></div>}
        <div className="mt-3 flex items-center gap-2">
          <Flag dim={team.state === 'resting'} />
          <h1 className="min-w-0 text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{team.name}</h1>
        </div>
        <p className="mt-0.5 text-small [overflow-wrap:anywhere] text-muted">{where}</p>
        {team.given > 0 && <div className="mt-2"><Progress done={team.done} given={team.given} /></div>}

        <div className="pt-4 pb-1.5 text-meta tracking-[.4px] text-muted">{t.seats(team.seats.length)}</div>
        <ul aria-label={t.seatsLabel} className="flex flex-col gap-2.5">
          {team.seats.map(s => {
            const role: PhoneRole | undefined = roleFor(catalog, team.project, s.role);
            const free = !s.sessionId && !s.leaving;
            return (
              <li key={s.role} aria-label={`@${s.role}`} className={`rounded-card px-3.5 py-3 ${free ? 'border border-dashed border-line' : 'bg-surface'}`}>
                <div className="flex items-center gap-2">
                  <RolePill role={s.role} />
                  <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{role?.label}</span>
                  <Holder seat={s} store={store} />
                </div>
                <div className="mt-1 text-small [overflow-wrap:anywhere] text-muted"><SeatMeta seat={s} role={role} sheet /></div>
                {role && <p className="mt-2 line-clamp-2 rounded-control bg-bg px-2.5 py-2 text-small whitespace-pre-line [overflow-wrap:anywhere] text-muted">{preview(role.prompt)}</p>}
                {role && <a href={href({ name: 'role', key: catalogKey(role) })} className="mt-1.5 inline-block text-small text-info underline underline-offset-2">{t.readPrompt}</a>}
                {free && (
                  <div className="mt-2">
                    <Button size="sm" disabled={!online} onClick={() => start(s.role)}>{copy.teams.team.start}</Button>
                    {starting?.role === s.role && <p role="status" className={`mt-1 text-small ${starting.note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{starting.note.text}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <a href={href({ name: 'compose', teamId: team.id })} className={buttonClass({ block: true })}>{t.compose}</a>
          <a href={href({ name: 'team-copy', teamId: team.id })} className={buttonClass({ block: true })}>{t.saveAs}</a>
        </div>
        <Button variant="ghost" block className="mt-2 text-danger-fg" disabled={!online} onClick={() => { setDissolveNote(null); setDissolving(true); }}>{t.dissolve}</Button>
        {!canConfirm && <p className="mt-2 text-center text-body text-attention">{copy.chat.launchSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>}
      </main>
      {dissolving && <DissolveSheet name={team.name} busy={busy} note={dissolveNote} onConfirm={dissolve} onClose={() => setDissolving(false)} />}
    </>
  );
}

/**
 * A live team's sheet: its seats, who holds each, what they run with and the role's prompt, and the actions on the team.
 * It waits for the PC's live teams and catalog; a team that is not (or no longer) there is the Gone screen.
 */
export function LiveTeam({ store, teamId }: { store: MobileStore; teamId: string }) {
  const { teams, catalog, fresh } = useMobile(store);
  const gate = useCatalogGate(store);
  // This screen's, not the sheet's: the team leaves `teams` as soon as it is dissolved, and the answer must still lead back to Agents.
  const mounted = useMounted();
  const team = teams?.find(x => x.id === teamId);
  if (teams && !team) return <Gone store={store} team stale={!fresh} />;
  if (!team || !catalog) return <EditorPending store={store} waited={gate.waited} retry={gate.retry} missing={null} back={{ route: AGENTS, title: copy.nav.agents, label: copy.nav.backTo.agents ?? copy.nav.back }} />;
  return <Body store={store} team={team} catalog={catalog} mounted={mounted} />;
}
