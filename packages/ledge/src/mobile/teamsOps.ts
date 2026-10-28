// The phone's roles and teams (spec 2026-10-28 mobile teams): the catalog it reads, and the writes and live-team changes it
// makes behind its passkey. The challenge of each is bound to the digest of the operation (`teamsDigest`), so a confirmation
// given for one content never covers another. The phone names a project, never a folder: the id is found here, and a name
// the daemon does not know is refused before anything is sent.
import { randomUUID } from 'node:crypto';
import { teamsDigest, teamsPurpose, type ClientMessage, type PhoneClientMessage, type PhoneServerMessage, type ServerMessage, type TeamsOperation } from '@ledge/protocol';
import type { Outcome, PhoneOperation } from './operations.js';
import { toPhoneCatalog, toPhoneRole, type DefinitionsListing } from './project.js';

type Assertion = NonNullable<Extract<PhoneOperation, { type: 'role.write' }>['assertion']>;

export interface TeamsOpsDeps {
  dispatch: (msg: ClientMessage, reply: (m: ServerMessage) => void) => Promise<void>;
  /** The id of the project of this name, or null: a name the daemon does not know. */
  projectByName: (name: string) => string | null;
  projectName: (id: string | null) => string | null;
  /** The device check, as the gateway's: undefined when the assertion holds over `subject`, else the refusal. */
  checkAssertion: (deviceId: string, assertion: Assertion | undefined, purpose: 'define' | 'team', subject: string | undefined) => Outcome | undefined;
  /** Dispatches a message and reads its answer: `ok` maps an answer, `silent` is the outcome when none came, `error` when the daemon refused. */
  ask: (out: ClientMessage, ok: (m: ServerMessage) => boolean | Outcome | undefined, opts?: { silent?: Outcome; error?: Outcome }) => Promise<Outcome>;
  push: (deviceId: string, m: PhoneServerMessage) => void;
  log: (line: string) => void;
}

const FAILED: Outcome = { status: 'failed' };
const invalid: Outcome = { status: 'rejected', reason: 'invalid' };

export function createTeamsOps(deps: TeamsOpsDeps) {
  /** Every scope's definitions, as the daemon lists them now; undefined when it could not. */
  const listing = async (): Promise<DefinitionsListing | undefined> => {
    let found: DefinitionsListing | undefined;
    const requestId = randomUUID();
    await deps.dispatch({ type: 'definitions.list', requestId }, m => {
      if (m.type === 'definitions.listing' && (m.requestId === undefined || m.requestId === requestId)) found ??= m;
    });
    return found;
  };

  const catalog = async (deviceId: string): Promise<void> => {
    const l = await listing();
    if (!l) return deps.push(deviceId, { type: 'error', code: 'invalid', request: 'teams.catalog' });
    deps.push(deviceId, { type: 'teams.catalog', catalog: toPhoneCatalog(l, deps.projectName) });
  };

  /** The whole of one role, for an editor whose catalog cut its prompt (« Lire et modifier la consigne »). */
  const role = async (deviceId: string, msg: Extract<PhoneClientMessage, { type: 'teams.role' }>): Promise<void> => {
    const refuse = () => deps.push(deviceId, { type: 'error', code: 'invalid', request: 'teams.role' });
    if ((msg.scope === 'repo') !== (msg.project !== undefined)) return refuse();
    const project = msg.project === undefined ? null : deps.projectByName(msg.project);
    if (msg.project !== undefined && project === null) return refuse();
    const l = await listing();
    // From the listing itself, not the catalog: a role the catalog dropped for its budget can still be read by its address.
    const shown = l ? toPhoneRole(l, deps.projectName, msg.scope, project, msg.id) : undefined;
    if (!shown) return refuse();
    deps.push(deviceId, { type: 'teams.role', role: shown });
  };

  /** The daemon's message for an operation, its project named by id. */
  const toDaemon = (msg: TeamsOperation, project: string | undefined): ClientMessage => {
    const rid = msg.op;
    const at = project === undefined ? {} : { project };
    switch (msg.type) {
      case 'role.write': return { type: 'role.write', rid, scope: msg.scope, ...at, role: msg.role, base: msg.base };
      case 'role.delete': return { type: 'role.delete', rid, scope: msg.scope, ...at, id: msg.id, base: msg.base };
      case 'template.write': return { type: 'template.write', rid, scope: msg.scope, ...at, ...(msg.id !== undefined ? { id: msg.id } : {}), name: msg.name, seats: msg.seats, base: msg.base };
      case 'template.delete': return { type: 'template.delete', rid, scope: msg.scope, ...at, id: msg.id, base: msg.base };
      case 'team.launch': return { type: 'team.launch', rid, ...at, name: msg.name, seats: msg.seats, ...(msg.template !== undefined ? { template: msg.template } : {}) };
      case 'team.compose': return { type: 'team.compose', rid, team: msg.team, seats: msg.seats };
      case 'team.seat': return { type: 'team.seat', rid, team: msg.team, role: msg.role, action: msg.action };
      case 'team.dissolve': return { type: 'team.dissolve', team: msg.team };
    }
  };

  /** What the daemon's answer to the operation `rid` comes to. */
  const outcomeOf = (rid: string, type: TeamsOperation['type']) => (m: ServerMessage): boolean | Outcome | undefined => {
    switch (m.type) {
      case 'definition.result':
        if (m.rid !== rid) return undefined;
        if (!m.code) return true;
        if (m.code === 'missing') return FAILED;
        return { status: 'rejected', reason: m.code };
      case 'team.changed':
        if (m.rid !== rid) return undefined;
        // A composition answers with its team and a reason when it was saved but an added seat did not start: applied, with the warning.
        if (m.reason && m.team && type === 'team.compose') return { status: 'applied', reason: 'seat_failed' };
        return !m.reason;
      case 'team.launched': return m.rid === rid ? true : undefined;
      case 'team.failed': return m.rid === rid ? false : undefined;
      default: return undefined;
    }
  };

  const run = async (deviceId: string, msg: TeamsOperation): Promise<Outcome> => {
    // A repo scope names its project and a home scope none (the message schema says so too): refused before the digest and any dispatch.
    if ('scope' in msg && (msg.scope === 'repo') !== (msg.project !== undefined)) return invalid;
    // Over the message as parsed, like the phone's: a message the digest refuses is no operation.
    let digest: string;
    try { digest = await teamsDigest(msg); }
    catch { return invalid; }
    const refused = deps.checkAssertion(deviceId, msg.assertion, teamsPurpose(msg.type), digest);
    if (refused) return refused;
    let project: string | undefined;
    if ('project' in msg && msg.project !== undefined) {
      const id = deps.projectByName(msg.project);
      if (id === null) return { status: 'rejected', reason: 'unknown_project' };
      project = id;
    }
    const out = toDaemon(msg, project);
    // The dissolve answers nothing when it is done: silence is applied. Every other answer names its `rid`; none is a failure.
    return deps.ask(out, outcomeOf(msg.op, msg.type), { silent: msg.type === 'team.dissolve' ? { status: 'applied' } : FAILED, error: FAILED });
  };

  return {
    catalog: (deviceId: string): void => { void catalog(deviceId).catch((e: unknown) => { deps.log(`phone teams.catalog failed (${e instanceof Error ? e.name : 'error'})`); deps.push(deviceId, { type: 'error', code: 'invalid', request: 'teams.catalog' }); }); },
    role: (deviceId: string, msg: Extract<PhoneClientMessage, { type: 'teams.role' }>): void => { void role(deviceId, msg).catch((e: unknown) => { deps.log(`phone teams.role failed (${e instanceof Error ? e.name : 'error'})`); deps.push(deviceId, { type: 'error', code: 'invalid', request: 'teams.role' }); }); },
    run
  };
}

export type TeamsOps = ReturnType<typeof createTeamsOps>;
