import { createHash } from 'node:crypto';
import type { Page, WebSocketRoute } from '@playwright/test';
import type { Ask, BrainStatus, ChatProjectProposal, ChatProposal, ChatStep, ChatTurn, ClientMessage, DaemonInfo, Escalation, Exchange, FoundRepo, LedgeThreadItem, LedgeDecision, LedgeRule, IslandPrefs, MandateCategory, Machines, ModelChoice, OpenRigStatus, Projects, Recent, Rig, RigPlan, RigResultCode, RigSpecInfo, Session, ThreadItem, Tool } from '@ledge/protocol';

/** How long a launched session stays `starting` in the fake daemon before it is `working`. */
export const LAUNCH_SETTLE_MS = 1500;
export const T0 = new Date(Date.now() - 5 * 60_000).toISOString();
/** A local daemon that can route the chat between machines (spec 2026-10-14 §5.3): the fleet coordinates through it. */
export const ROUTING: DaemonInfo = { version: '0.6.0', install: 'npm', systemd: true, routing: true };
export function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra };
}

/** The mandate the daemon writes at first start (`~/.ledge/mandat.md`, packages/ledge/src/daemon/brain/mandate.ts). */
export const DEFAULT_MANDATE = `# Le mandat de Ledge

Ledge tranche seul ce qui est dans la première liste. Tout le reste te revient.
Une ligne = une catégorie : \`- <id> : <description>\`. Les catégories design, architecture et critique te reviennent toujours, même déplacées.

## Ledge tranche seul
- git : git et branches
- tests : tests et relectures
- context : contexte et relèves
- code : petits choix de code

## Te revient toujours
- design : design (UI, copie)
- architecture : architecture (stockage, API)
- critical : critique (données, sécurité, suppression, coûts)
`;

/** Moves the line of `c` from « Ledge tranche seul » to the end of « Te revient toujours », as the daemon's `escalateCategory` does. */
function escalateLine(text: string, c: MandateCategory): string {
  const lines = text.split('\n');
  const at = lines.findIndex(l => new RegExp(`^\\s*[-*]\\s+${c}\\s+:`).test(l));
  const user = lines.findIndex(l => /^#+\s*te revient toujours/i.test(l.trim()));
  if (at < 0 || user < 0 || at > user) return text;
  const [line] = lines.splice(at, 1);
  let end = user; // the heading moved up by one
  while (end + 1 < lines.length && /^\s*[-*]\s+/.test(lines[end + 1]!)) end++;
  lines.splice(end + 1, 0, line!);
  return lines.join('\n');
}

/** A folder of the fake daemon's disk: its parent (null at `/`), its subfolders by name, the Git repositories among them with their branch. */
export interface Folder { parent: string | null; entries: string[]; repos?: { name: string; branch: string }[] }

/** Ledge's scripted answer to every `chat.ask`: what it read, its text, the session it proposes to start. */
export interface ChatReply { steps?: ChatStep[]; text: string; proposal?: ChatProposal; projectProposal?: ChatProjectProposal }

/** A machine's answer to `repos.scan`: its repositories, or the fleet's `error` for a machine it cannot ask. */
export type Found = { repos: FoundRepo[]; truncated?: boolean } | 'offline' | 'outdated';

/** Simulates the local ledge daemon inside the page: a snapshot, then the machines list, and a `push` for later updates.
 *  Like the daemon (spec §5.3) it keeps the machines list: `machines.set` replaces it and is broadcast back as `machines`,
 *  and every new connection (reload, reconnect) gets the current list. A `document.read` is answered from `extras.documents` by its path
 *  (`document.content`), or `document.error` `not_found`. A `repos.inspect` is answered from `extras.repoInfo` by path (default: the folder exists, on
 *  `main`). A `folder.list` is answered from `extras.folders` by its path (`extras.home`, default `/home/me`, when it has none) with its
 *  `requestId` and the Git `repos` among the entries, or with the asked path and `error` `not found`. A `folder.create` adds the folder to its parent there
 *  and answers with its listing; a name already there is refused (`already exists: <name>`), as the daemon does. A `session.launch` is answered as the daemon does: a `starting` session (`launched-<n>`, the message's name, harness and folder) is listed,
 *  then `session.launched`, and LAUNCH_SETTLE_MS later it is `working`; `launches: 'manual'` leaves the answer to the test (`launched`, `refuse`).
 *  A `chat.ask` is answered from `extras.chat` as the daemon streams it: each `chat.step`, the text as one `chat.delta`, then `chat.done` with the
 *  proposal. A card's `session.launch { qid }` seats its agent as above, then broadcasts the `chat.history` where that turn's proposal has its
 *  `launchedId`; that agent stays `starting` (the test may `upsert` it), so what the launch lit is never raced by the settle.
 *  A `repos.scan` is answered by its `machineId` (default `local`) from `extras.found` with `repos.found` (after `scanDelayMs`, to hold the scan view): no entry, an empty list.
 *  Like the daemon it keeps the island's settings (`extras.island`, default null: none set yet), sent after the projects, and an `island.set`
 *  replaces them and is broadcast back as `island`; `island: 'unknown'` plays a daemon too old to speak of them.
 *  It speaks of the decisions sessions asked (`asks` after the snapshot): `extras.asks`, none by default; an `ask.answer` closes its ask (`ask.updated`
 *  `answered`, then `ask.result`), and one already closed is refused as the daemon does (`code` `closed`, `déjà répondue`).
 *  It speaks of OpenRig (lot 3) after the snapshot: `openrig.status` (`extras.openrig`, none by default), one `rig.snapshot` per machine of
 *  `extras.rigs` (the local one always, empty when there are none), then an `escalation.updated` per `extras.escalations`. A `rig.specs.request`
 *  is answered `rig.specs` from `extras.specs` (none by default); a `rig.exchanges.request` is answered `rig.exchanges` from `extras.exchanges`,
 *  keyed by rig id. `pushRig`, `removeRig` and `exchange` play the daemon's later news.
 *  Launching (lot 5): a `rig.prepare` is answered `rig.plan`, computed from the spec in `extras.specs` (its fields overridden by `extras.plans[spec]`),
 *  or `rig.result` failed for an unknown spec; a `rig.launch` takes its plan once (`rig.result` ok, then the rig pushed `launching`),
 *  a plan taken again is refused `plan already launched`, an unknown one `plan expired`. A `rig.act` is answered `rig.result` ok, or `extras.rigAct`.
 *  Ledge's thread (lot 4): after the escalations, `ledge.thread.history` from `extras.thread`; `ledge.thread.request` answers the same. An `escalation.answer`
 *  is accepted after `extras.answerDelayMs` (`escalation.updated` answered, `rig.result` ok), a later one gets `rig.result` `already_answered`. A `ledge.say` adds the
 *  user's item (`to` for a leading `@seat`, which is all it does), else plays `extras.chat` as `chat.ask` does (`chat.history` first) and finishes Ledge's bubble.
 *  `pushEscalation`, `pushExchange` and `threadItem` play the later news. Every client message is kept in `received`.
 *  Ledge's brain (lot 7), only with `extras.brain`: after the escalations, `brain.status`, `mandate` (`extras.brain.mandate`, default DEFAULT_MANDATE,
 *  at `/home/me/.ledge/mandat.md`), `rules` and `decisions`, then the thread, as the daemon sends them. Each of these is answered `rig.result` ok
 *  (`invalid` for an unknown rule or decision): `brain.set` broadcasts the new `brain.status` (`on` or `off`; `first` also posts Ledge's activation
 *  bubble); `category.escalate` moves the category's line to « Te revient toujours » and `mandate.update` replaces the text, both broadcast as
 *  `mandate`; `rule.set` validates (`active`) or drops (`rejected`) the rule, broadcast as `rules`; `decision.revisit` reopens the decision's
 *  escalation (`pending`, `correcting` = the decision, no answer) with a new thread item. An answer to a `correcting` escalation records the
 *  user's decision and marks the old one `revisitedBy` it (`decisions`).
 *  The route is anchored so it never catches `/ssh/<alias>` (see `fakeRemote`). Register before `page.goto`. */
export async function fakeDaemon(page: Page, initial: Session[], extras: { machines?: Machines; launcher?: string[]; recents?: Recent[]; daemon?: DaemonInfo; projects?: Projects; threads?: Record<string, ThreadItem[]>; documents?: Record<string, string>; repoInfo?: Record<string, { exists: boolean; branch: string | null }>; folders?: Record<string, Folder>; home?: string; launches?: 'auto' | 'manual'; chat?: ChatReply; found?: Record<string, Found>; scanDelayMs?: number; island?: IslandPrefs | null | 'unknown'; models?: Partial<Record<Tool, ModelChoice[]>>; asks?: Ask[]; rigs?: Rig[]; escalations?: Escalation[]; openrig?: OpenRigStatus; specs?: RigSpecInfo[]; exchanges?: Record<string, Exchange[]>; thread?: LedgeThreadItem[]; answerDelayMs?: number; plans?: Record<string, Partial<RigPlan>>; rigAct?: { ok: false; code: RigResultCode; reason?: string }; brain?: { status: BrainStatus; mandate?: string; rules?: LedgeRule[]; decisions?: LedgeDecision[] } } = {}) {
  const threads = new Map(Object.entries(extras.threads ?? {}).map(([id, items]) => [id, [...items]]));
  const sessions = new Map(initial.map(s => [s.id, s]));
  const received: ClientMessage[] = [];
  let machines: Machines = extras.machines ?? [{ id: 'local', label: 'Local' }];
  let projects: Projects | undefined = extras.projects;
  let island: IslandPrefs | null | 'unknown' = extras.island ?? null;
  let socket: WebSocketRoute | null = null;
  let up = true;
  let launches = 0;
  const answering = new Set<string>();
  const asks = new Map((extras.asks ?? []).map(a => [a.id, a]));
  const rigs = new Map((extras.rigs ?? []).map(r => [`${r.machine}/${r.id}`, r]));
  const exchanges = new Map(Object.entries(extras.exchanges ?? {}).map(([rigId, items]) => [rigId, [...items]]));
  const escalations = new Map((extras.escalations ?? []).map(e => [e.id, e]));
  const thread: LedgeThreadItem[] = [...(extras.thread ?? [])];
  let says = 0;
  const plans = new Map<string, RigPlan | 'used'>();
  const brain = extras.brain ? { status: extras.brain.status, mandate: extras.brain.mandate ?? DEFAULT_MANDATE, rules: [...(extras.brain.rules ?? [])], decisions: [...(extras.brain.decisions ?? [])] } : null;
  let items = 0;
  const turns = new Map<string, ChatTurn>();
  const images = new Map<string, { mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string; preview: boolean }>();
  await page.routeWebSocket(/127\.0\.0\.1:47831\/?$/, ws => {
    if (!up) { ws.close(); return; }
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...(extras.launcher ? { launcher: extras.launcher } : {}), ...(extras.recents ? { recents: extras.recents } : {}), ...(extras.daemon ? { daemon: extras.daemon } : {}) }));
    ws.send(JSON.stringify({ type: 'machines', machines }));
    if (projects) ws.send(JSON.stringify({ type: 'projects', projects }));
    if (island !== 'unknown') ws.send(JSON.stringify({ type: 'island', prefs: island }));
    ws.send(JSON.stringify({ type: 'asks', asks: [...asks.values()] }));
    if (extras.openrig) ws.send(JSON.stringify({ type: 'openrig.status', status: extras.openrig }));
    const byMachine = new Map<string, Rig[]>([['local', []]]);
    for (const r of rigs.values()) byMachine.set(r.machine, [...(byMachine.get(r.machine) ?? []), r]);
    for (const [machine, list] of byMachine) ws.send(JSON.stringify({ type: 'rig.snapshot', machine, rigs: list }));
    for (const escalation of escalations.values()) ws.send(JSON.stringify({ type: 'escalation.updated', escalation }));
    if (brain) {
      ws.send(JSON.stringify({ type: 'brain.status', status: brain.status }));
      ws.send(JSON.stringify({ type: 'mandate', text: brain.mandate, path: '/home/me/.ledge/mandat.md' }));
      ws.send(JSON.stringify({ type: 'rules', items: brain.rules }));
      ws.send(JSON.stringify({ type: 'decisions', items: brain.decisions }));
    }
    ws.send(JSON.stringify({ type: 'ledge.thread.history', items: thread }));
    ws.onMessage(m => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(m)); } catch { return; }
      received.push(msg);
      if (msg.type === 'island.set') { island = msg.prefs; ws.send(JSON.stringify({ type: 'island', prefs: island })); }
      if (msg.type === 'projects.set') { projects = msg.projects; ws.send(JSON.stringify({ type: 'projects', projects })); }
      if (msg.type === 'session.decide') { const s = sessions.get(msg.id); if (s) { const { pending: _p, ...rest } = s; const next = { ...rest, state: 'working' as const }; sessions.set(s.id, next); ws.send(JSON.stringify({ type: 'session.updated', session: next })); } }
      if (msg.type === 'session.thread') { const items = threads.get(msg.id); if (items) ws.send(JSON.stringify({ type: 'session.thread', id: msg.id, items })); }
      if (msg.type === 'document.read') {
        const text = extras.documents?.[msg.path];
        ws.send(JSON.stringify(text === undefined
          ? { type: 'document.error', requestId: msg.requestId, path: msg.path, code: 'not_found' }
          : { type: 'document.content', requestId: msg.requestId, path: msg.path, text, bytes: new TextEncoder().encode(text).length, modifiedAt: T0 }));
      }
      // Attachments: a put is stored under its sha256 and answered with its ref; a get serves the stored bytes (the preview when asked and present), `attachment.error` `not_found` for an unknown id.
      if (msg.type === 'attachment.put') {
        const id = createHash('sha256').update(msg.image.data).digest('hex');
        const preview = msg.image.preview !== undefined;
        images.set(id, { mime: msg.image.mime, data: msg.image.data, preview });
        if (preview) images.set(`${id}:preview`, { mime: msg.image.preview!.mime, data: msg.image.preview!.data, preview: false });
        ws.send(JSON.stringify({ type: 'attachment.stored', requestId: msg.requestId, ref: { id, mime: msg.image.mime, width: 1440, height: 900, bytes: Math.floor(msg.image.data.length * 3 / 4), preview } }));
      }
      if (msg.type === 'attachment.get') {
        const hit = (msg.preview ? images.get(`${msg.attachment}:preview`) : undefined) ?? images.get(msg.attachment);
        ws.send(JSON.stringify(hit
          ? { type: 'attachment.data', requestId: msg.requestId, attachment: msg.attachment, mime: hit.mime, data: hit.data }
          : { type: 'attachment.error', requestId: msg.requestId, reason: 'not_found' }));
      }
      if (msg.type === 'machines.set') { machines = msg.machines; ws.send(JSON.stringify({ type: 'machines', machines })); }
      // #58: the agent's models from `extras.models`; without an entry, an empty list.
      if (msg.type === 'ask.answer') {
        const ask = asks.get(msg.id);
        if (!ask || ask.state !== 'open') ws.send(JSON.stringify({ type: 'ask.result', rid: msg.rid, code: ask ? 'closed' : 'unknown', reason: ask ? 'déjà répondue' : 'décision inconnue' }));
        else {
          const answered: Ask = { ...ask, state: 'answered', answer: { text: msg.text, at: new Date().toISOString() }, closedAt: new Date().toISOString() };
          asks.set(ask.id, answered);
          ws.send(JSON.stringify({ type: 'ask.updated', ask: answered }));
          ws.send(JSON.stringify({ type: 'ask.result', rid: msg.rid, ask: answered }));
        }
      }
      if (msg.type === 'rig.specs.request') ws.send(JSON.stringify({ type: 'rig.specs', requestId: msg.requestId, machine: 'local', specs: extras.specs ?? [] }));
      if (msg.type === 'rig.exchanges.request') ws.send(JSON.stringify({ type: 'rig.exchanges', machine: msg.machine, rigId: msg.rigId, items: exchanges.get(msg.rigId) ?? [] }));
      if (msg.type === 'rig.prepare') {
        const spec = extras.specs?.find(x => x.id === msg.spec || x.name === msg.spec);
        if (!spec) ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: `unknown spec ${msg.spec}` }));
        else {
          const w = msg.where;
          const cwd = w.kind === 'off-project' ? `/home/me/.ledge/rigs/${w.name}` : w.copy ? `${w.repo}/.worktrees/rig-${msg.spec}` : w.repo;
          const plan: RigPlan = { id: `plan-${plans.size + 1}`, machine: 'local', spec: msg.spec, goal: msg.goal, where: w, cwd,
            seats: spec.seats.map(x => ({ address: x.address, runtime: x.runtime, ...(x.model ? { model: x.model } : {}), autonomy: x.profile ?? 'default' })),
            writes: ['.openrig/', '.mcp.json', 'CLAUDE.md', '.claude/settings.local.json'], command: `rig up ${msg.spec} --cwd ${cwd} --yes --json`,
            required: w.kind === 'project' && !w.copy, ...extras.plans?.[msg.spec] };
          plans.set(plan.id, plan);
          ws.send(JSON.stringify({ type: 'rig.plan', rid: msg.rid, plan }));
        }
      }
      // A plan is taken once, as the daemon does; the launched rig is then pushed `launching`, its seats `starting`.
      if (msg.type === 'rig.launch') {
        const plan = plans.get(msg.planId);
        if (plan === undefined || plan === 'used') ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: plan ? 'plan already launched' : 'plan expired' }));
        else {
          plans.set(plan.id, 'used');
          ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: true }));
          const w = plan.where;
          const rig: Rig = { id: `r-${plan.spec}`, name: plan.spec, machine: 'local', spec: plan.spec, cwd: plan.cwd, projectId: w.kind === 'project' ? w.projectId : null,
            offProject: w.kind === 'off-project', ...(w.kind === 'project' ? { branch: w.branch } : {}), lifecycle: 'launching', kernel: false, repos: [],
            seats: plan.seats.map(x => ({ ref: `${x.address.slice(1)}@${plan.spec}`, address: x.address, name: x.address.slice(1), runtime: x.runtime, ...(x.model ? { model: x.model } : {}), state: 'starting' as const })),
            launch: { planId: plan.id, goal: plan.goal, lead: plan.seats[0]?.address ?? '', startedAt: new Date().toISOString() } };
          rigs.set(`local/${rig.id}`, rig);
          ws.send(JSON.stringify({ type: 'rig.updated', rig }));
        }
      }
      // A rig action (lot 5) is accepted (`rig.result` ok), or refused as `extras.rigAct` says; the rig itself is left as it is.
      if (msg.type === 'rig.act') ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ...(extras.rigAct ?? { ok: true }) }));
      // Filing a rig (lot 5): the project holds the rig (`projects` again), then the rig comes back with its `projectId` (`offProject` stays, as the daemon keeps it).
      if (msg.type === 'rig.adopt') {
        const rig = rigs.get(`${msg.machine}/${msg.rigId}`);
        const project = projects?.projects.find(p => p.id === msg.projectId);
        if (!rig || !projects || !project) ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: 'unknown rig or project' }));
        else {
          projects = { ...projects, projects: projects.projects.map(p => (p.id === project.id ? { ...p, rigs: [...p.rigs.filter(x => x !== rig.id), rig.id] } : p)) };
          ws.send(JSON.stringify({ type: 'projects', projects }));
          const filed = { ...rig, projectId: project.id };
          rigs.set(`${msg.machine}/${msg.rigId}`, filed);
          ws.send(JSON.stringify({ type: 'rig.updated', rig: filed }));
          ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: true }));
        }
      }
      if (msg.type === 'models.list') ws.send(JSON.stringify({ type: 'models.listing', requestId: msg.requestId, tool: msg.tool, models: extras.models?.[msg.tool] ?? [] }));
      if (msg.type === 'repos.inspect') {
        ws.send(JSON.stringify({ type: 'repos.info', requestId: msg.requestId, repos: msg.paths.map(path => ({ path, ...(extras.repoInfo?.[path] ?? { exists: true, branch: 'main' }) })) }));
      }
      if (msg.type === 'folder.list') {
        const path = msg.path ?? extras.home ?? '/home/me';
        const f = extras.folders?.[path];
        const id = msg.requestId === undefined ? {} : { requestId: msg.requestId };
        ws.send(JSON.stringify(f
          ? { type: 'folder.listing', ...id, path, parent: f.parent, entries: f.entries, repos: f.repos ?? [] }
          : { type: 'folder.listing', ...id, path, parent: null, entries: [], error: 'not found' }));
      }
      if (msg.type === 'folder.create') {
        const at = extras.folders?.[msg.parent];
        const id = msg.requestId === undefined ? {} : { requestId: msg.requestId };
        const name = msg.name.trim();
        const path = `${msg.parent === '/' ? '' : msg.parent}/${name}`;
        if (!at) ws.send(JSON.stringify({ type: 'folder.listing', ...id, path: msg.parent, parent: null, entries: [], error: 'not found' }));
        else if (at.entries.includes(name)) ws.send(JSON.stringify({ type: 'folder.listing', ...id, path: msg.parent, parent: at.parent, entries: at.entries, repos: at.repos ?? [], error: `already exists: ${name}` }));
        else {
          at.entries = [...at.entries, name].sort();
          extras.folders![path] = { parent: msg.parent, entries: [] };
          ws.send(JSON.stringify({ type: 'folder.listing', ...id, path, parent: msg.parent, entries: [], repos: [] }));
        }
      }
      if (msg.type === 'repos.scan') {
        const f = extras.found?.[msg.machineId ?? 'local'] ?? { repos: [] };
        const answer = { type: 'repos.found', requestId: msg.requestId, repos: typeof f === 'string' ? [] : f.repos, truncated: typeof f === 'string' ? false : f.truncated ?? false, ...(typeof f === 'string' ? { error: f } : {}) };
        setTimeout(() => { try { ws.send(JSON.stringify(answer)); } catch { /* the page is gone */ } }, extras.scanDelayMs ?? 0);
      }
      if (msg.type === 'ledge.thread.request') ws.send(JSON.stringify({ type: 'ledge.thread.history', items: msg.before === undefined ? thread : [], ...(msg.before === undefined ? {} : { before: msg.before }) }));
      // Lot 7: the brain, the mandate and the memory (only with `extras.brain`).
      if (brain && (msg.type === 'brain.set' || msg.type === 'category.escalate' || msg.type === 'mandate.update' || msg.type === 'rule.set' || msg.type === 'decision.revisit')) {
        const b = brain;
        const result = (ok: boolean, reason?: string) => ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok, ...(ok ? {} : { code: 'invalid' }), ...(reason ? { reason } : {}) }));
        const at = new Date().toISOString();
        if (msg.type === 'brain.set') {
          b.status = { ...b.status, enabled: msg.enabled, state: msg.enabled ? 'on' : 'off', ...(msg.tool ? { tool: msg.tool } : {}) };
          ws.send(JSON.stringify({ type: 'brain.status', status: b.status }));
          if (msg.first && msg.enabled) {
            const item: LedgeThreadItem = { kind: 'ledge', id: `brain-${++items}`, at, text: 'Je pense en continu désormais : je lis les escalades des rigs, je tranche ce que mon mandat permet après une minute, et je te passe le reste.' };
            thread.push(item);
            ws.send(JSON.stringify({ type: 'ledge.thread.item', item }));
          }
          return result(true);
        }
        if (msg.type === 'category.escalate' || msg.type === 'mandate.update') {
          b.mandate = msg.type === 'mandate.update' ? msg.text : escalateLine(b.mandate, msg.category);
          ws.send(JSON.stringify({ type: 'mandate', text: b.mandate, path: '/home/me/.ledge/mandat.md' }));
          return result(true);
        }
        if (msg.type === 'rule.set') {
          if (!b.rules.some(r => r.id === msg.id)) return result(false, 'règle inconnue');
          b.rules = msg.status === 'rejected' ? b.rules.filter(r => r.id !== msg.id) : b.rules.map(r => (r.id === msg.id ? { ...r, status: 'active' as const } : r));
          ws.send(JSON.stringify({ type: 'rules', items: b.rules }));
          return result(true);
        }
        const dec = b.decisions.find(d => d.id === msg.id);
        const e = dec && escalations.get(dec.escalationId);
        if (!dec || !e) return result(false, `aucune décision ${msg.id}`);
        if (dec.revisitedBy || e.correcting) return result(false, 'cette décision est déjà en cours de correction');
        const { answer: _a, graceUntil: _g, ...rest } = e;
        const reopened: Escalation = { ...rest, state: 'pending', correcting: dec.id };
        escalations.set(e.id, reopened);
        answering.delete(e.id);
        ws.send(JSON.stringify({ type: 'escalation.updated', escalation: reopened }));
        const item: LedgeThreadItem = { kind: 'escalation', id: `revisit-${++items}`, at, escalationId: e.id };
        thread.push(item);
        ws.send(JSON.stringify({ type: 'ledge.thread.item', item }));
        return result(true);
      }
      // The first answer to an escalation is accepted after `answerDelayMs`; a later one, or one for a closed escalation, is `already_answered`.
      if (msg.type === 'escalation.answer') {
        const e = escalations.get(msg.id);
        const taken = e === undefined || e.state === 'answered' || e.state === 'closed' || answering.has(msg.id);
        if (taken) ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: false, code: 'already_answered' }));
        else {
          answering.add(msg.id);
          setTimeout(() => {
            const now = escalations.get(msg.id)!;
            if (now.state === 'answered') { try { ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: false, code: 'already_answered' })); } catch { /* the page is gone */ } return; }
            const { correcting, ...was } = now;
            const answered: Escalation = { ...was, state: 'answered', answer: { by: 'user', answers: msg.answers, at: new Date().toISOString() } };
            escalations.set(msg.id, answered);
            try {
              ws.send(JSON.stringify({ type: 'escalation.updated', escalation: answered }));
              // A correction (Revenir dessus): the user's decision is recorded, the old one points to it.
              if (brain && correcting) {
                const old = brain.decisions.find(d => d.id === correcting);
                const id = `d-${++items}`;
                if (old) {
                  const { revisitedBy: _r, rule: _u, ...base } = old;
                  brain.decisions = [{ ...base, id, by: 'user', answers: msg.answers, at: answered.answer!.at }, ...brain.decisions.map(d => (d.id === correcting ? { ...d, revisitedBy: id } : d))];
                }
                ws.send(JSON.stringify({ type: 'decisions', items: brain.decisions }));
              }
              ws.send(JSON.stringify({ type: 'rig.result', rid: msg.rid, ok: true }));
            } catch { /* the page is gone */ }
          }, extras.answerDelayMs ?? 0);
        }
      }
      // `ledge.say`: the user's item (with `to` for a leading `@seat`), then `extras.chat` played as `chat.ask` does, then the Ledge bubble finished.
      if (msg.type === 'ledge.say') {
        const n = ++says, qid = `say-${n}`, at = new Date().toISOString();
        const at2 = /^@(\S+)/.exec(msg.text.trim());
        const user: LedgeThreadItem = { kind: 'user', id: `u-${n}`, at, text: msg.text, ...(at2 ? { to: `@${at2[1]}` } : {}), ...(at2 ? {} : { qid }) };
        thread.push(user);
        ws.send(JSON.stringify({ type: 'ledge.thread.item', item: user }));
        if (!at2) {
          const reply = extras.chat ?? { text: 'Nothing to report.' };
          const steps = reply.steps ?? [];
          turns.set(qid, { qid, question: msg.text, askedAt: at, steps, answer: reply.text, answeredAt: at, ...(reply.proposal ? { proposal: reply.proposal } : {}), ...(reply.projectProposal ? { projectProposal: reply.projectProposal } : {}) });
          // The fleet only follows a turn it knows: the history comes first.
          ws.send(JSON.stringify({ type: 'chat.history', turns: [{ qid, question: msg.text, askedAt: at, steps: [] }] }));
          const pending: LedgeThreadItem = { kind: 'ledge', id: `l-${n}`, at, text: '', qid, pending: true };
          ws.send(JSON.stringify({ type: 'ledge.thread.item', item: pending }));
          for (const step of steps) ws.send(JSON.stringify({ type: 'chat.step', qid, step }));
          ws.send(JSON.stringify({ type: 'chat.delta', qid, text: reply.text }));
          ws.send(JSON.stringify({ type: 'chat.done', qid, text: reply.text, at, ...(reply.proposal ? { proposal: reply.proposal } : {}), ...(reply.projectProposal ? { projectProposal: reply.projectProposal } : {}) }));
          const done: LedgeThreadItem = { kind: 'ledge', id: `l-${n}`, at, text: reply.text, qid };
          thread.push(done);
          ws.send(JSON.stringify({ type: 'ledge.thread.item', item: done }));
        }
      }
      if (msg.type === 'chat.ask') {
        const reply = extras.chat ?? { text: 'Nothing to report.' };
        const steps = reply.steps ?? [];
        const at = new Date().toISOString();
        turns.set(msg.qid, { qid: msg.qid, question: msg.text, askedAt: at, steps, answer: reply.text, answeredAt: at, ...(reply.proposal ? { proposal: reply.proposal } : {}), ...(reply.projectProposal ? { projectProposal: reply.projectProposal } : {}) });
        for (const step of steps) ws.send(JSON.stringify({ type: 'chat.step', qid: msg.qid, step }));
        ws.send(JSON.stringify({ type: 'chat.delta', qid: msg.qid, text: reply.text }));
        ws.send(JSON.stringify({ type: 'chat.done', qid: msg.qid, text: reply.text, at, ...(reply.proposal ? { proposal: reply.proposal } : {}), ...(reply.projectProposal ? { projectProposal: reply.projectProposal } : {}) }));
      }
      if (msg.type === 'session.launch' && extras.launches !== 'manual') {
        const id = `launched-${++launches}`;
        const project = msg.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || msg.cwd;
        const name = msg.name ?? `Agent ${launches}`;
        const s = session(id, { name, tool: msg.tool, cwd: msg.cwd, project, title: `${name} · ${project}`, state: 'starting', startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() });
        sessions.set(id, s);
        ws.send(JSON.stringify({ type: 'session.updated', session: s }));
        ws.send(JSON.stringify({ type: 'session.launched', id }));
        const turn = msg.qid === undefined ? undefined : turns.get(msg.qid);
        if (turn?.proposal) {
          turns.set(turn.qid, { ...turn, proposal: { ...turn.proposal, launchedId: id } });
          ws.send(JSON.stringify({ type: 'chat.history', turns: [...turns.values()] }));
        }
        if (msg.qid !== undefined) return;
        setTimeout(() => {
          if (sessions.get(id)?.state !== 'starting') return;
          const next = { ...s, state: 'working' as const, lastActivityAt: new Date().toISOString() };
          sessions.set(id, next);
          try { socket?.send(JSON.stringify({ type: 'session.updated', session: next })); } catch { /* the page is gone */ }
        }, LAUNCH_SETTLE_MS);
      }
    });
  });
  const push = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    push,
    /** The ref of an image the page put, as the daemon would give it back in a thread item. */
    stored(id: string) { const i = images.get(id); if (!i) throw new Error(`no stored image ${id}`); return { id, mime: i.mime, width: 1440, height: 900, bytes: Math.floor(i.data.length * 3 / 4), preview: i.preview }; },
    upsert(s: Session) { sessions.set(s.id, s); push({ type: 'session.updated', session: s }); },
    remove(id: string) { sessions.delete(id); push({ type: 'session.removed', id }); },
    /** Adds or replaces a rig, broadcast as `rig.updated`. */
    pushRig(rig: Rig) { rigs.set(`${rig.machine}/${rig.id}`, rig); push({ type: 'rig.updated', rig }); },
    /** Removes a rig, broadcast as `rig.removed`. */
    removeRig(machine: string, id: string) { rigs.delete(`${machine}/${id}`); push({ type: 'rig.removed', machine, rigId: id }); },
    /** Stores an exchange between a rig's agents (kept for `rig.exchanges.request`) and broadcasts it as `rig.exchange`. */
    exchange(e: Exchange) { exchanges.set(e.rigId, [...(exchanges.get(e.rigId) ?? []), e]); push({ type: 'rig.exchange', exchange: e }); },
    /** Alias of `exchange`: an exchange between a rig's agents, as the daemon pushes it. */
    pushExchange(e: Exchange) { exchanges.set(e.rigId, [...(exchanges.get(e.rigId) ?? []), e]); push({ type: 'rig.exchange', exchange: e }); },
    /** Adds or replaces an escalation, broadcast as `escalation.updated` (an `answered` one stops later answers: they get `already_answered`). */
    pushEscalation(e: Escalation) { escalations.set(e.id, e); push({ type: 'escalation.updated', escalation: e }); },
    /** Adds an item to Ledge's thread, broadcast as `ledge.thread.item`. */
    threadItem(item: LedgeThreadItem) { const at = thread.findIndex(i => i.id === item.id); if (at >= 0) thread[at] = item; else thread.push(item); push({ type: 'ledge.thread.item', item }); },
    /** Answers a `session.launch` as the daemon does: the session is broadcast first, then `session.launched` with its raw id. */
    launched(s: Session) { sessions.set(s.id, s); push({ type: 'session.updated', session: s }); push({ type: 'session.launched', id: s.id }); },
    /** Refuses a launch as the daemon does: an `error` with no id, naming its request (spec §9.2). */
    refuse(message: string) { push({ type: 'error', message, request: 'session.launch' }); },
    /** Answers a `folder.list` / `folder.create`. */
    listing(path: string, parent: string | null, entries: string[], error?: string) { push({ type: 'folder.listing', path, parent, entries, ...(error ? { error } : {}) }); },
    /** Stores an item in the session's thread and broadcasts it as `session.thread.item`. */
    item(id: string, item: ThreadItem) { const items = threads.get(id) ?? []; const at = items.findIndex(i => i.id === item.id); if (at >= 0) items[at] = item; else items.push(item); threads.set(id, items); push({ type: 'session.thread.item', id, item }); },
    /** Pushes a session's terminal preview. */
    preview(id: string, lines: string[]) { push({ type: 'session.preview', id, lines }); },
    /** Drops the local daemon and refuses new connections, so the fleet's own reconnect cannot quietly bring it back (see `fakeRemote`). */
    close() { up = false; socket?.close(); socket = null; }
  };
}

/** A second machine reached through the daemon's `/ssh/<alias>` relay. `close()` drops it and refuses new connections until `reopen()`,
 *  after which the fleet's own retry gets through. */
export async function fakeRemote(page: Page, alias: string, initial: Session[], extras: { recents?: Recent[]; daemon?: DaemonInfo } = {}) {
  let sessions = initial;
  let daemon = extras.daemon;
  let up = true;
  let socket: WebSocketRoute | null = null;
  const received: ClientMessage[] = [];
  await page.routeWebSocket(new RegExp(`127\\.0\\.0\\.1:47831/ssh/${alias}$`), ws => {
    if (!up) { ws.close(); return; }
    socket = ws;
    ws.send(JSON.stringify({ type: 'snapshot', sshAlias: alias, sessions, ...(extras.recents ? { recents: extras.recents } : {}), ...(daemon ? { daemon } : {}) }));
    ws.onMessage(m => { try { received.push(JSON.parse(String(m))); } catch { /* ignore */ } });
  });
  const push = (m: unknown) => socket?.send(JSON.stringify(m));
  return {
    received,
    push,
    /** Answers a `session.launch` sent to this machine (raw id; the fleet qualifies it with the machine). */
    launched(s: Session) { sessions = [...sessions.filter(x => x.id !== s.id), s]; push({ type: 'session.updated', session: s }); push({ type: 'session.launched', id: s.id }); },
    close() { up = false; socket?.close(); socket = null; },
    /** Accepts connections again; `nextDaemon`: what the daemon says of itself from now on (a daemon back from its update). */
    reopen(next: Session[] = sessions, nextDaemon: DaemonInfo | undefined = daemon) { sessions = next; daemon = nextDaemon; up = true; }
  };
}

export const twoProjects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'website', name: 'Website', color: 'green', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/website' }] }
  ],
  rules: []
};

/** Eight agents on two projects, three LEDGE-42, three WEB-18, two with a request waiting. */
export const eight = [
  session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', state: 'waiting_permission', branch: 'release/LEDGE-42-v0.5.0' }),
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'fix/LEDGE-42-ssh-reconnect' }),
  session('pim', { name: 'Pim', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'feat/bot-motion' }),
  session('bix', { name: 'Bix', project: 'ledge', cwd: '/w/ledge', state: 'idle', topic: 'LEDGE-42 · Documenter le protocole', branch: 'docs/protocol' }),
  session('luna', { name: 'Luna', project: 'website', cwd: '/w/website', state: 'waiting_input', branch: 'feat/WEB-18-homepage' }),
  session('milo', { name: 'Milo', project: 'website', cwd: '/w/website', state: 'working', branch: 'fix/WEB-18-mobile-layout' }),
  session('echo', { name: 'Echo', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'test/LEDGE-42-notifications' }),
  session('rio', { name: 'Rio', project: 'website', cwd: '/w/website', state: 'working', branch: 'feat/WEB-18-accessibility' })
];

/** The app opens on Ledge's home view (ledge home spec §2.1); a test about the atelier goes there from the sidebar. */
export async function openAtelier(page: Page, bureaux = false): Promise<void> {
  await page.locator('section.ledge-home').waitFor();
  await page.evaluate(enabled => localStorage.setItem('desktop.legacyAtelier', enabled ? '0' : '1'), bureaux);
  // The sidebar's « Atelier »; in a narrow window, where the sidebar is hidden, the home view's own way back.
  const entry = page.locator('aside.sidebar').getByRole('button', { name: /^Atelier/ });
  if (await entry.isVisible()) await entry.click();
  else await page.getByRole('button', { name: /^(Back to the atelier|Retour à l’atelier)$/ }).click();
}
