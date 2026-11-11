import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { PHONE_LAUNCH_MULTI, type OperationReason, type PhoneFolder, type PhoneLaunch, type PhoneProject, type Tool } from '@ledge/protocol';
import { copy } from '../copy';
import { MOBILE_STORAGE_PREFIX } from '../link/keys';
import { effortLabel, efforts, modelHint, type Pick } from '../model/modelChoice';
import { goBack, href, replaceRoute } from '../router';
import { hostName, useShell } from '../shell/Shell';
import { isLive } from '../state/operations';
import { localStore } from '../state/storage';
import { useMobile, type MobileStore } from '../state/store';
import { Sheet } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { DetailHeader, kitButtonClass } from '../ui/kit/Controls';
import { Dot } from '../ui/kit/marks';
import { MODEL_TITLE_ID, ModelSheet } from '../ui/ModelSheet';
import { iconButtonClass } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Receipt } from './atoi/Receipt';
import { isApple } from './device';
import { rememberStarted } from './launchStarted';

const L = copy.launch;
const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor', 'omp'];
const APPROVALS = ['always-ask', 'write', 'yolo'] as const;
type Approval = typeof APPROVALS[number];
/** How long a sent launch may stay without a final answer before « n'a pas répondu » (Desktop's LAUNCH_TIMEOUT_MS, contract §6). */
export const LAUNCH_TIMEOUT_MS = 20_000;

/** What the phone keeps (m2-sessions.html §9, Comportements): the last project, each project's last choice, the draft. */
const KEY = { project: `${MOBILE_STORAGE_PREFIX}launch.project`, prefs: `${MOBILE_STORAGE_PREFIX}launch.prefs`, draft: `${MOBILE_STORAGE_PREFIX}launch.draft` };
type Prefs = Record<string, { tool: Tool; model: string | null; effort: string | null }>;
const read = (s: Storage | null, k: string): string | null => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const write = (s: Storage | null, k: string, v: string | null) => { try { if (v === null) s?.removeItem(k); else s?.setItem(k, v); } catch { /* kept for this visit only */ } };
function readPrefs(s: Storage | null): Prefs {
  try { const v: unknown = JSON.parse(read(s, KEY.prefs) ?? '{}'); return v && typeof v === 'object' ? v as Prefs : {}; } catch { return {}; }
}

/** How the last try ended, as its receipt says it above the button (m2-lancement.html §2). */
type Outcome = { kind: 'refused'; reason: OperationReason | 'other' } | { kind: 'failed' } | { kind: 'timeout'; op: string | null };

const base = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path;
const local = (f: PhoneFolder) => f.machine === 'local';
/** A folder the phone may launch in: this PC's, and there (contract §3). */
const usable = (f: PhoneFolder) => local(f) && f.exists !== false;

/**
 * « Nouvelle session » (m2-sessions.html §9, its refusals and checks m2-lancement.html, contract docs/mobile-launch-contract.md):
 * the Desktop modal's fields, the button that says what is missing, then the device's check over this very launch.
 */
export function NewSession({ store, storage }: { store: MobileStore; storage?: Storage }) {
  const state = useMobile(store);
  const kept = localStore(storage);
  const machine = hostName(useShell().pc ?? state.daemon?.name ?? null);
  const projects = state.projects;
  const [projectId, setProjectId] = useState<string | null>(() => read(kept, KEY.project));
  const project: PhoneProject | undefined = projects.find(p => p.id === projectId) ?? projects[0];
  const prefs = readPrefs(kept);
  const last = project ? prefs[project.id] : undefined;
  const [tool, setTool] = useState<Tool>(last?.tool ?? 'claude');
  const [pick, setPick] = useState<Pick>({ model: last?.model ?? null, effort: last?.effort ?? null });
  const [approval, setApproval] = useState<Approval>('always-ask');
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [prompt, setPrompt] = useState(() => read(kept, KEY.draft) ?? '');
  const [sheet, setSheet] = useState<'project' | 'where' | 'model' | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const promptId = useId();

  // A new project: its folders from the PC, its last choice back.
  const pid = project?.id;
  useEffect(() => { if (pid && state.fresh) store.requestProjectFolders(pid); }, [pid, state.fresh, store]);
  useEffect(() => { if (state.fresh && state.daemon?.models) store.requestModels(tool); }, [tool, state.fresh, state.daemon?.models, store]);

  const listed = pid ? state.projectFolders[pid] : undefined;
  const folders = Array.isArray(listed) ? listed : [];
  const first = folders.find(usable);
  const where = (chosen ?? (first ? [first.path] : [])).filter(p => folders.some(f => f.path === p && usable(f)));
  const multi = PHONE_LAUNCH_MULTI.includes(tool);
  const models = state.models[tool]?.models ?? [];

  const change = (fn: () => void) => { fn(); setOutcome(null); setCancelled(false); };
  const chooseProject = (p: PhoneProject) => change(() => {
    setProjectId(p.id); write(kept, KEY.project, p.id); setChosen(null);
    const was = prefs[p.id];
    setTool(was?.tool ?? 'claude'); setPick({ model: was?.model ?? null, effort: was?.effort ?? null });
    setSheet(null);
  });
  const chooseTool = (t: Tool) => change(() => {
    setTool(t); setPick({ model: null, effort: null });
    if (!PHONE_LAUNCH_MULTI.includes(t) && where.length > 1) setChosen(where.slice(0, 1));
  });
  const toggleFolder = (path: string) => change(() => {
    if (!multi) { setChosen([path]); setSheet(null); return; }
    const has = where.includes(path);
    const next = has ? where.filter(p => p !== path) : [...where, path];
    setChosen(next.length ? next : where);
  });
  const type = (v: string) => { setPrompt(v); write(kept, KEY.draft, v); setOutcome(null); setCancelled(false); };

  // A sent launch: its end from the PC, or « n'a pas répondu » after 20 s without one.
  const sent = op ? state.ops[op] : undefined;
  // Counted from each send, the first or a « Réessayer »: the op going uncertain on the way does not restart it.
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!op) return;
    const t = setTimeout(() => {
      const o = store.getState().ops[op];
      if (o && isLive(o.phase)) { setBusy(false); setOutcome({ kind: 'timeout', op }); }
    }, LAUNCH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [op, tries, store]);
  useEffect(() => {
    if (!op || !sent || isLive(sent.phase)) return;
    setBusy(false);
    setOp(null);
    if (sent.phase === 'applied') {
      write(kept, KEY.draft, null);
      if (project) write(kept, KEY.prefs, JSON.stringify({ ...readPrefs(kept), [project.id]: { tool, model: pick.model, effort: pick.effort } }));
      if (sent.id) { rememberStarted(sent.id, project?.name ?? '', storage); replaceRoute({ name: 'thread', sessionId: sent.id }); }
      else replaceRoute({ name: 'sessions' });
      return;
    }
    if (sent.phase === 'failed') { setOutcome({ kind: 'failed' }); return; }
    const reason = sent.reason ?? 'other';
    if (reason === 'stale' && pid) store.requestProjectFolders(pid);
    setOutcome({ kind: 'refused', reason });
  }, [op, sent?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = async () => {
    if (!project) return;
    const body: PhoneLaunch = {
      project: project.id, tool, folders: where, prompt: prompt.trim(),
      ...(pick.model ? { model: pick.model } : {}), ...(pick.effort ? { effort: pick.effort } : {}),
      // Only OMP takes it, and only when it is not the default (Q78 B).
      ...(tool === 'omp' && approval !== 'always-ask' ? { approval } : {})
    };
    setBusy(true); setOutcome(null); setCancelled(false);
    const r = await store.launchSession(body);
    if (r.status === 'sent') { setOp(r.op); setTries(n => n + 1); return; }
    setBusy(false);
    if (r.status === 'cancelled') setCancelled(true);
    else if (r.status === 'noAnswer') setOutcome({ kind: 'timeout', op: null });
    else if (r.status === 'failed') setOutcome({ kind: 'refused', reason: 'other' });
    else setOutcome({ kind: 'refused', reason: r.reason });
  };
  // « Réessayer » after no answer sends the same op again (contract §6); any other retry checks again, as a new launch.
  // A launch that cannot go again (the PC restarted since it took it, or the replay window is over) is never replaced by a
  // new one: the first may be running. Its receipt stays, without Réessayer.
  const again = (o: Outcome) => {
    if (o.kind === 'timeout' && o.op) {
      if (store.launchAgain(o.op)) { setOp(o.op); setTries(n => n + 1); setBusy(true); setOutcome(null); return; }
      const held = store.getState().ops[o.op];
      if (held && isLive(held.phase)) { setOutcome({ ...o }); return; }
    }
    void launch();
  };
  /** A receipt without « Réessayer »: a launch of unknown outcome that may not be sent again. */
  const stuck = (o: Outcome) => o.kind === 'timeout' && o.op !== null && !!state.ops[o.op] && isLive(state.ops[o.op]!.phase) && !store.canLaunchAgain(o.op);

  const agent = copy.tools[tool];
  const offline = !state.fresh;
  const missing: { label: string; body?: ReactNode } | null =
    offline ? { label: L.missing.machine }
    : !state.daemon?.launch ? { label: L.missing.pcOld(machine), body: <span className="text-center text-[12px] leading-4 text-muted">{L.pcOldBody}</span> }
    : !state.device?.confirm ? {
      label: L.missing.setup,
      body: <>
        <span className="text-[12px] leading-4 text-muted">{L.setupBody}</span>
        <a href="#/connection/link" className={kitButtonClass({ size: 'sm', className: 'self-start' })}><Icon name="gear" className="size-4" />{L.openSettings}</a>
      </>
    }
    : !project || where.length === 0 ? { label: L.chooseProject }
    : prompt.trim() === '' ? { label: L.missing.prompt }
    : null;
  // Offline, « n'a pas répondu » gives way to the button's own state (m2-lancement.html, Comportements).
  const shown = outcome && !(offline && outcome.kind === 'timeout') ? outcome : null;
  const modelName = pick.model === null ? null : models.find(m => m.id === pick.model)?.label ?? pick.model;
  const modelText = pick.model === null ? copy.model.byDefault : L.pick(modelName!, pick.effort ? effortLabel(pick.effort) : null);
  const modelSub = pick.model === null ? copy.model.defaultHint : (() => { const m = models.find(x => x.id === pick.model); return m ? modelHint(tool, m) : undefined; })();
  const firstFolder = folders.find(f => f.path === where[0]);
  const whereText = !firstFolder ? undefined : firstFolder === folders[0] ? (firstFolder.branch ? L.onBranch(firstFolder.branch) : L.inFolder) : base(firstFolder.path);
  const whereSub = firstFolder && firstFolder !== folders[0] ? firstFolder.branch ?? undefined : undefined;

  return (
    <>
      <DetailHeader
        back={<button type="button" aria-label={L.close} title={L.close} onClick={() => goBack({ name: 'sessions' })} className={iconButtonClass({ className: 'text-muted' })}><Icon name="close" /></button>}
        name={L.title}
      />
      <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain pt-3.5 pb-4">
        <Field label={L.project}>
          {projects.length === 0
            ? <p className="text-body text-muted">{copy.launch.noProjects} {L.noProjectsBody}</p>
            : (
              <PickRow onClick={() => setSheet('project')} lead={project ? <Dot state={offline ? 'off' : 'idle'} /> : null} label={L.project}
                text={project ? <b className="font-semibold">{project.name}</b> : L.chooseProject}
                sub={project ? [machine, offline ? L.offline : last ? L.remembered : null].filter(Boolean).join(' · ') : undefined} dim={offline} />
            )}
        </Field>
        {project && (
          <Field label={L.where}>
            <PickRow onClick={() => setSheet('where')} lead={<Icon name={firstFolder?.branch ? 'branch' : 'folder'} className="size-4 text-muted" />} label={L.where}
              text={where.length > 1 && whereText
                ? <><span aria-hidden="true">{whereText}<span className="ml-1.5 font-mono text-small text-muted">{L.more(where.length - 1)}</span></span><span className="sr-only">{L.moreLabel(whereText, where.length - 1)}</span></>
                : whereText ?? ''}
              sub={whereSub} />
          </Field>
        )}
        <Field label={L.agent}>
          <div role="group" aria-label={L.agent} className="grid grid-cols-2 gap-2">
            {TOOLS.map(t => (
              <button key={t} type="button" aria-pressed={t === tool} onClick={() => chooseTool(t)}
                className="flex flex-col items-start gap-0.5 rounded-lg border border-input px-[11px] py-[9px] text-left text-[13.5px] font-medium aria-pressed:border-ring aria-pressed:bg-raised aria-pressed:shadow-[inset_0_0_0_1px_var(--color-ring)]">
                {copy.tools[t]}<small className="text-[11.5px] font-normal text-muted">{L.tools[t]}</small>
              </button>
            ))}
          </div>
        </Field>
        <Field label={L.model}>
          <PickRow onClick={() => setSheet('model')} lead={<Icon name="cpu" className="size-4 text-muted" />} label={L.model} text={modelText} sub={modelSub} />
        </Field>
        {tool === 'omp' && (
          <Field label={L.permissions}>
            <Segmented name="launch-approval" legend={L.permissions} value={approval} onChange={v => change(() => setApproval(v))}
              options={APPROVALS.map(a => ({ value: a, label: L.approvals[a][0] }))} />
            <span className="text-[12px] leading-4 text-muted">{L.approvals[approval][1]}</span>
          </Field>
        )}
        <Field label={L.message} htmlFor={promptId}>
          <textarea id={promptId} value={prompt} onChange={e => type(e.target.value)} placeholder={L.placeholder} rows={4}
            className="min-h-[92px] resize-none rounded-lg border border-input bg-surface px-3 py-2.5 text-[15px] leading-[22px] outline-none placeholder:text-muted focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ring)_30%,transparent)]" />
          <div className="flex flex-wrap gap-1.5">
            {L.ideas.map(i => <button key={i} type="button" onClick={() => type(i)} className="h-8 rounded-lg border border-dashed border-input px-2.5 text-[12.5px] text-muted">{i}</button>)}
          </div>
        </Field>
      </main>
      <div className="bleed flex flex-none flex-col gap-1.5 border-t border-line bg-bg px-3.5 pt-2.5 pb-[calc(14px+var(--foot-inset))]">
        {shown && <OutcomeReceipt outcome={shown} agent={agent} machine={machine} onRetry={stuck(shown) ? null : () => again(shown)} />}
        {missing ? (
          <>
            <button type="button" disabled className={kitButtonClass({ variant: 'primary', className: 'w-full' })}>{missing.label}</button>
            {missing.body}
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void launch()} className={kitButtonClass({ variant: 'primary', className: 'w-full' })}>
            {busy
              ? <><Icon name="spinner" className="size-4 motion-safe:animate-spin" />{L.launching}</>
              : <>{isApple() && <Icon name="face" className="size-[18px]" />}{isApple() ? L.launchCheck : L.launchDevice}</>}
          </button>
        )}
        {cancelled && <span role="status" className="text-center text-[12px] leading-4 text-destructive">{L.cancelled}</span>}
        {!missing && project && <span className="text-center text-[12px] leading-4 text-muted">{L.summary(agent, modelName, machine, project.name)}</span>}
      </div>

      {sheet === 'project' && (
        <Sheet labelledBy="launch-project" onClose={() => setSheet(null)}>
          <h2 id="launch-project" className="text-base font-semibold">{L.project}</h2>
          <Menu>
            {projects.map(p => (
              <MenuRow key={p.id} on={p.id === project?.id} onClick={() => chooseProject(p)} lead={<Dot state={offline ? 'off' : 'idle'} />}
                text={p.name} sub={offline ? `${machine} · ${L.offline}` : machine} />
            ))}
          </Menu>
        </Sheet>
      )}
      {sheet === 'where' && project && (
        <Sheet labelledBy="launch-where" onClose={() => setSheet(null)}>
          <div>
            <h2 id="launch-where" className="text-base font-semibold">{L.where}</h2>
            <span className="text-[12px] leading-4 text-muted">{L.folders(project.name)}</span>
          </div>
          <Menu>
            {folders.map((f, i) => {
              const why = !local(f) ? L.folder.elsewhere(f.label ?? f.machine, machine) : f.exists === false ? L.folder.missing(machine) : null;
              return (
                <MenuRow key={`${f.machine}:${f.path}`} on={where.includes(f.path)} disabled={why !== null} onClick={() => toggleFolder(f.path)}
                  lead={<Icon name={why === null && f.branch ? 'branch' : 'folder'} className="size-5 text-muted" />}
                  text={i === 0 ? L.projectFolder : base(f.path)} sub={why ?? f.branch ?? undefined} />
              );
            })}
          </Menu>
          <span className="text-[12px] leading-4 text-muted">{L.folder.single}</span>
        </Sheet>
      )}
      {sheet === 'model' && (
        <Sheet labelledBy={MODEL_TITLE_ID} onClose={() => setSheet(null)}>
          <ModelSheet tool={tool} models={models} error={state.models[tool]?.error} pick={pick} onPick={p => change(() => setPick(p))}
            actions={<button type="button" onClick={() => setSheet(null)} className={kitButtonClass({ variant: 'primary', className: 'w-full' })}>{L.done}</button>} />
        </Sheet>
      )}
    </>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const Tag = htmlFor ? 'label' : 'span';
  return (
    <div className="flex flex-col gap-1.5">
      <Tag {...(htmlFor ? { htmlFor } : {})} className="text-[12px] font-medium text-muted">{label}</Tag>
      {children}
    </div>
  );
}

/** A field that opens its sheet (`.pick`): what it holds, a line under it, and the chevron. */
function PickRow({ onClick, lead, text, sub, dim = false }: { onClick: () => void; lead: ReactNode; label: string; text: ReactNode; sub?: string | undefined; dim?: boolean }) {
  return (
    <button type="button" aria-haspopup="dialog" onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-input bg-surface px-3 py-1.5 text-left ${dim ? 'opacity-60' : ''}`}>
      {lead}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body">{text}</span>
        {sub && <small className="truncate text-[12px] text-muted">{sub}</small>}
      </span>
      <Icon name="down" className="size-4 text-muted" />
    </button>
  );
}

function Menu({ children }: { children: ReactNode }) {
  return <div className="flex max-h-[50vh] flex-col overflow-y-auto rounded-[10px] border border-line">{children}</div>;
}

function MenuRow({ on, disabled = false, onClick, lead, text, sub }: { on: boolean; disabled?: boolean; onClick: () => void; lead: ReactNode; text: string; sub?: string | undefined }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className="flex min-h-12 items-center gap-3 border-b border-line px-3.5 py-1.5 text-left text-[15px] last:border-b-0 aria-pressed:bg-raised disabled:opacity-45">
      {lead}
      <span className="flex min-w-0 flex-1 flex-col"><span className="truncate">{text}</span>{sub && <small className="truncate text-[12px] text-muted">{sub}</small>}</span>
      {on && <Icon name="check" className="size-4" />}
    </button>
  );
}

/** One receipt per end (m2-lancement.html §2, M2 §9): a title, what was kept or what to do, and the action that helps. */
function OutcomeReceipt({ outcome, agent, machine, onRetry }: { outcome: Outcome; agent: string; machine: string; onRetry: (() => void) | null }) {
  const retry = { label: L.retry, onClick: onRetry ?? (() => {}) };
  // A launch that may not go again may have started a session (Q88): the receipt sends to Sessions, never to a new launch.
  if (outcome.kind === 'timeout') return onRetry
    ? <Receipt tone="warn" title={L.timeout} body={L.timeoutBody} action={retry} />
    : <Receipt tone="warn" title={L.timeout} body={L.lostBody} action={{ label: copy.atoi.seeSessions, href: href({ name: 'sessions' }) }} />;
  if (outcome.kind === 'failed') return <Receipt tone="fail" title={L.failed(agent)} body={L.failedBody(agent)} action={retry} />;
  const R = L.refused;
  switch (outcome.reason) {
    case 'not_found': return <Receipt tone="fail" title={R.not_found} body={L.kept} />;
    case 'invalid': return <Receipt tone="fail" title={R.invalid} body={R.invalidBody(agent)} />;
    case 'stale': return <Receipt tone="fail" title={R.stale} body={R.staleBody} />;
    case 'confirm_required': return <Receipt tone="fail" title={R.confirm_required} body={R.setupKept} action={{ label: L.settings, href: '#/connection/link' }} />;
    case 'assertion_invalid': return <Receipt tone="fail" title={R.assertion_invalid} body={L.kept} action={retry} />;
    case 'assertion_expired': return <Receipt tone="warn" title={R.assertion_expired} body={R.expiredBody} action={retry} />;
    case 'unavailable': return <Receipt tone="warn" title={R.unavailable(machine)} body={R.unavailableBody} />;
    default: return <Receipt tone="fail" title={R.other} body={L.kept} />;
  }
}

