import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { EffortSchema, ModelIdSchema, ROLE_LABEL_MAX, ROLE_PROMPT_MAX, RoleIdSchema, type PhoneRole } from '@ledge/protocol';
import { copy } from '../copy';
import { catalogKey, parseCatalogKey, scopeLabel, teamsSeating } from '../model/catalog';
import { outcomeNote, type OutcomeNote } from '../model/teamsOutcome';
import { goBack, href, navigate } from '../router';
import { useMobile, type DefineRequest, type MobileStore, type RoleRef } from '../state/store';
import { Button, chipClass } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { FIELD } from '../ui/field';
import { BackHeader, linkView } from '../ui/Header';
import { OfflineBanner } from '../ui/Notice';
import { EditorPending, useCatalogGate, useChangedWait, useMounted } from './teamsEditing';

const t = copy.teams.role;
const EFFORT_MAX = 20;
const MODEL_MAX = 200;

/** What the user has typed over the role as shown; a field absent here follows the role. */
interface Edits { label?: string; prompt?: string; tool?: string; model?: string; effort?: string; autonomy?: string }

const refOf = (r: { scope: 'home' | 'repo'; project: string | null; id: string }): RoleRef => ({ scope: r.scope, id: r.id, ...(r.project !== null ? { project: r.project } : {}) });
const Label = ({ id, children }: { id: string; children: ReactNode }) => <label htmlFor={id} className="mb-1 block text-small text-muted">{children}</label>;
const Hint = ({ bad = false, children }: { bad?: boolean; children: ReactNode }) => <p className={`mt-1 text-meta ${bad ? 'text-danger-fg' : 'text-muted'}`}>{children}</p>;

/** « Supprimer »: the definitions that still seat the role are named, and the delete stays possible. */
function DeleteSheet({ id, seating, busy, blocked, note, onConfirm, onClose }: {
  id: string; seating: string[]; busy: boolean; /** The PC's file moved (« changed ») and its new version has not arrived: the base is not the PC's. */ blocked: boolean; note: OutcomeNote | null; onConfirm: () => void; onClose: () => void;
}) {
  const title = useId();
  return (
    <Sheet labelledBy={title} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={title} className="text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{t.deleteTitle(id)}</h2>
      {seating.length > 0 && <p className="text-body text-attention [overflow-wrap:anywhere]">{t.seatedIn(seating.join(', '))} · {t.deleteHint}</p>}
      {note && <p role="status" className={`text-body ${note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{note.text}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{t.cancel}</Button>
        <Button variant="brand" className="flex-[2]" disabled={busy || blocked} onClick={onConfirm}>{t.delete}</Button>
      </div>
    </Sheet>
  );
}

/** The form itself. `initial` is the catalog's role, or null for a new one; the screen is keyed by the role's address, so the state never crosses two roles. */
function Form({ store, roleKey, initial }: { store: MobileStore; roleKey: string; initial: PhoneRole | null }) {
  const state = useMobile(store);
  const { catalog } = state;
  const ids = useId();
  const [shown, setShown] = useState<PhoneRole | null>(initial);
  const [edits, setEdits] = useState<Edits>({});
  const [newId, setNewId] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<OutcomeNote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteNote, setDeleteNote] = useState<OutcomeNote | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The role was deleted on the PC: what the user typed stays on screen, but there is no file left to write over.
  const [gone, setGone] = useState(false);
  const [reloaded, setReloaded] = useState(false);
  const mounted = useMounted();

  const isNew = initial === null;
  const where = isNew ? { scope: project === null ? 'home' as const : 'repo' as const, project } : shown ? { scope: shown.scope, project: shown.project } : null;
  const key = isNew ? null : parseCatalogKey(roleKey);

  // A role whose prompt the catalog cut is read in full before its prompt can be edited, and read again when a reload brings a cut one.
  const cut = shown?.cut === true;
  useEffect(() => {
    if (!shown || !cut) return;
    let live = true;
    setReadFailed(false);
    store.readRole(refOf(shown)).then(full => { if (live) setShown(full); }, () => { if (live) setReadFailed(true); });
    return () => { live = false; };
  // The read follows the role's version: a new hash, or a retry.
  }, [store, shown?.hash, cut, attempt]);

  // « changed »: the next catalog brings the version the PC has now. It becomes the base of the next save; the user's text stays over it.
  const changed = useChangedWait(store, catalog, fresh => {
    const found = fresh?.roles.find(r => key !== null && r.id === key.id && r.scope === key.scope && r.project === key.project);
    if (found) { setShown(found); setReloaded(true); } else if (key !== null) { setGone(true); setReloaded(false); }
  });
  const waiting = changed.waiting;

  const label = edits.label ?? shown?.label ?? '';
  const prompt = edits.prompt ?? shown?.prompt ?? '';
  const tool = edits.tool ?? shown?.tool ?? '';
  const model = edits.model ?? shown?.model ?? '';
  const effort = edits.effort ?? shown?.effort ?? '';
  const autonomy = edits.autonomy ?? shown?.autonomy ?? '';
  const set = (e: Edits) => setEdits(prev => ({ ...prev, ...e }));

  const id = isNew ? newId : shown?.id ?? '';
  const idOk = RoleIdSchema.safeParse(id).success;
  const taken = isNew && idOk && catalog !== null && catalog.roles.some(r => r.id === id && r.scope === where?.scope && r.project === where.project);
  const labelOk = label.trim().length > 0 && label.length <= ROLE_LABEL_MAX;
  const modelOk = model.trim() === '' || ModelIdSchema.safeParse(model.trim()).success;
  const effortOk = effort.trim() === '' || EffortSchema.safeParse(effort.trim()).success;
  const locked = !isNew && (cut || readFailed);
  const canConfirm = !!state.device?.confirm;
  const valid = idOk && !taken && labelOk && modelOk && effortOk && !locked && !gone && !waiting;
  const ready = valid && canConfirm && state.fresh && !busy;

  const draft = () => ({
    id, label: label.trim(), prompt,
    ...(tool !== '' ? { tool: tool as NonNullable<PhoneRole['tool']> } : {}),
    ...(model.trim() !== '' ? { model: model.trim() } : {}),
    ...(effort.trim() !== '' ? { effort: effort.trim() } : {}),
    ...(autonomy !== '' ? { autonomy: autonomy as NonNullable<PhoneRole['autonomy']> } : {})
  });
  const scoped = where === null ? null : { scope: where.scope, ...(where.project !== null ? { project: where.project } : {}) };

  const run = (req: DefineRequest, onNote: (n: OutcomeNote | null) => void, onApplied: () => void) => {
    setBusy(true); onNote(null);
    void store.define(req)
      .then(r => {
        if (r.status === 'applied') { if (mounted.current) onApplied(); return; }
        onNote(outcomeNote(r, t.notSaved, { exists: t.taken, invalid: t.invalid }));
        // The file moved under the user: the catalog tells how, and the editor adopts it once it arrives.
        if (r.status === 'rejected' && r.reason === 'changed') changed.begin();
        // Asked again so the id that is taken shows as such, before the next try.
        if (r.status === 'rejected' && r.reason === 'exists') store.requestCatalog();
      }, () => onNote({ text: t.notSaved, quiet: false }))
      .finally(() => setBusy(false));
  };
  const saveRole = () => {
    if (!scoped || !ready) return;
    // A role seen first as new has no base; any other one names the hash of the role as shown.
    run({ type: 'role.write', ...scoped, role: draft(), base: shown?.hash ?? null }, setNote, () => goBack({ name: 'teams' }));
  };
  const deleteRole = () => {
    if (!scoped || !shown) return;
    run({ type: 'role.delete', ...scoped, id: shown.id, base: shown.hash }, setDeleteNote, () => { setDeleting(false); navigate({ name: 'teams' }); });
  };

  const seating = shown && catalog ? teamsSeating(shown.id, shown.scope, shown.project, catalog.templates).map(x => x.name) : [];
  const fixedWhere = shown ? scopeLabel(shown.scope, shown.project) : '';
  const stale = reloaded && Object.keys(edits).length > 0;
  const repoProjects = catalog?.projects ?? [];

  return (
    <>
      <BackHeader title={isNew ? t.newTitle : `@${shown?.id ?? ''}`} fallback={{ name: 'teams' }} label={copy.nav.backTo.teams ?? copy.nav.back} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {!state.fresh && <div className="mt-3"><OfflineBanner /></div>}
        <h1 className="mt-3 mb-3 text-heading leading-[1.3] font-semibold tracking-[-.5px] [overflow-wrap:anywhere]">{isNew ? t.newTitle : label || `@${id}`}</h1>

        <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-2">
          <div>
            <Label id={`${ids}-id`}>{t.idLabel}</Label>
            {isNew ? (
              <div className={`${FIELD} flex items-center font-mono ${newId !== '' && !idOk ? 'border-danger-fg' : ''}`}>
                <span className="text-role" aria-hidden="true">@</span>
                <input id={`${ids}-id`} type="text" value={newId} maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={newId !== '' && !idOk} aria-describedby={newId !== '' && !idOk ? `${ids}-rule` : undefined}
                  onChange={e => setNewId(e.target.value)} className="min-w-0 flex-1 bg-transparent py-3 outline-none" />
              </div>
            ) : <div className={`${FIELD} flex items-center font-mono text-muted`}><span className="text-role">@</span>{id}</div>}
          </div>
          <div>
            <Label id={`${ids}-label`}>{t.labelLabel}</Label>
            <input id={`${ids}-label`} type="text" value={label} maxLength={ROLE_LABEL_MAX} autoComplete="off" onChange={e => set({ label: e.target.value })} className={FIELD} />
          </div>
        </div>
        {isNew && <p id={`${ids}-rule`} className={`mt-1 text-meta ${newId !== '' && !idOk ? 'text-danger-fg' : 'text-muted'}`}>{t.idRule}</p>}
        {taken && <p role="alert" className="mt-1 text-small text-danger-fg">{t.idTaken(scopeLabel(where!.scope, where!.project))}</p>}
        {shown?.shadows && <Hint>{t.shadows(shown.id)}</Hint>}
        {shown?.shadowed && <Hint>{shown.shadowedIn ? t.shadowedIn(shown.id, shown.shadowedIn) : t.shadowed(shown.id)}</Hint>}

        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-small text-muted">
            <label htmlFor={`${ids}-prompt`}>{t.prompt}</label>
            {cut && !readFailed ? <span>{t.promptFetching}</span> : <span>{prompt.length}/{ROLE_PROMPT_MAX}</span>}
          </div>
          <textarea id={`${ids}-prompt`} value={prompt} maxLength={ROLE_PROMPT_MAX} rows={9} disabled={locked}
            // UTF-16 code units, as the schema's `.max()` counts: nothing past the limit gets in, a paste included.
            onChange={e => { if (e.target.value.length <= ROLE_PROMPT_MAX) set({ prompt: e.target.value }); }}
            className={`${FIELD} resize-none py-2.5 text-[15px] leading-[22px] disabled:opacity-60`} />
          {readFailed && (
            <div role="alert" className="mt-2 flex items-center justify-between gap-3 text-body text-danger-fg">
              <span>{t.promptFailed}</span>
              <Button size="sm" onClick={() => setAttempt(n => n + 1)}>{t.promptRetry}</Button>
            </div>
          )}
        </div>

        <div className="pt-3.5 pb-1.5 text-meta tracking-[.4px] text-muted">{t.defaults}</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label id={`${ids}-tool`}>{t.tool}</Label>
            <select id={`${ids}-tool`} value={tool} onChange={e => set({ tool: e.target.value })} className={FIELD}>
              <option value="">{t.unset}</option>
              {(Object.keys(copy.tools) as (keyof typeof copy.tools)[]).map(k => <option key={k} value={k}>{copy.tools[k]}</option>)}
            </select>
          </div>
          <div>
            <Label id={`${ids}-autonomy`}>{t.autonomy}</Label>
            <select id={`${ids}-autonomy`} value={autonomy} onChange={e => set({ autonomy: e.target.value })} className={FIELD}>
              <option value="">{t.unset}</option>
              {(['ask', 'edits', 'auto'] as const).map(k => <option key={k} value={k}>{copy.teams.autonomy[k]}</option>)}
            </select>
          </div>
          <div>
            <Label id={`${ids}-model`}>{t.model}</Label>
            <input id={`${ids}-model`} type="text" value={model} maxLength={MODEL_MAX} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!modelOk}
              onChange={e => set({ model: e.target.value })} className={FIELD} />
          </div>
          <div>
            <Label id={`${ids}-effort`}>{t.effort}</Label>
            <input id={`${ids}-effort`} type="text" value={effort} maxLength={EFFORT_MAX} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!effortOk}
              onChange={e => set({ effort: e.target.value })} className={FIELD} />
          </div>
        </div>
        {!modelOk && <Hint bad>{t.modelRule}</Hint>}
        {!effortOk && <Hint bad>{t.effortRule}</Hint>}

        <div className="pt-3.5 pb-1.5 text-meta tracking-[.4px] text-muted">{t.scopeHead}</div>
        {isNew ? (
          <>
            <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
              <legend className="sr-only">{t.scopeLegend}</legend>
              {[{ value: null, text: t.home }, ...repoProjects.map(p => ({ value: p, text: t.repo(p) }))].map(o => (
                <label key={o.value ?? ''} className={`${chipClass(project === o.value)} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info`}>
                  <input type="radio" name={`${ids}-scope`} checked={project === o.value} onChange={() => setProject(o.value)} className="sr-only" />
                  {o.text}
                </label>
              ))}
            </fieldset>
            <Hint>{project === null ? t.homeHint : t.repoHint(project)}</Hint>
          </>
        ) : <p className="text-body text-muted">{t.fixedScope(fixedWhere)}</p>}

        {gone && <p className="mt-3 text-body text-attention">{t.gone}</p>}
        {stale && (
          <div className="mt-3 text-body text-attention">
            <p>{t.changedKept}</p>
            <Button size="sm" className="mt-2" onClick={() => { setEdits({}); setNote(null); setReloaded(false); }}>{t.takePc}</Button>
          </div>
        )}
        {note && <p role="status" className={`mt-3 text-body ${note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{note.text}</p>}

        <Button variant="brand" size="lg" block className="mt-5" disabled={!ready} onClick={saveRole}>{t.save}</Button>
        {canConfirm
          ? <p className="mt-2 text-center text-small text-muted">{t.saveNote}</p>
          : <p className="mt-2 text-center text-body text-attention">{copy.chat.launchSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>}
        {!isNew && <Button variant="outline" block className="mt-4" disabled={!state.fresh || !canConfirm || gone} onClick={() => { setDeleteNote(null); setDeleting(true); }}>{t.delete}</Button>}
      </main>
      {deleting && shown && <DeleteSheet id={shown.id} seating={seating} busy={busy} blocked={waiting || gone} note={deleteNote} onConfirm={deleteRole} onClose={() => setDeleting(false)} />}
    </>
  );
}

/** The role editor: « Nouveau rôle » (`roleKey` `new`), or the role a catalog key names. It waits for the PC's catalog, then hands the form the role it holds. */
export function RoleEditor({ store, roleKey }: { store: MobileStore; roleKey: string }) {
  const { catalog } = useMobile(store);
  const gate = useCatalogGate(store);
  const isNew = roleKey === 'new';
  const key = isNew ? null : parseCatalogKey(roleKey);
  const found = catalog?.roles.find(r => key !== null && r.id === key.id && r.scope === key.scope && r.project === key.project) ?? null;
  // The form starts from the role the catalog had when it first showed it; the catalog moving afterwards is the form's to handle.
  const first = useRef<PhoneRole | null>(null);
  if (!first.current && found) first.current = found;

  if (!catalog || (!isNew && !first.current)) return <EditorPending store={store} waited={gate.waited} retry={gate.retry} missing={catalog ? t.missing : null} />;
  return <Form key={isNew ? 'new' : catalogKey(first.current!)} store={store} roleKey={roleKey} initial={isNew ? null : first.current} />;
}
