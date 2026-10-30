import { z } from 'zod';
import { CloseBlockSchema, ProjectBlockSchema, ProposalBlockSchema, RelayBlockSchema, type BlockKind } from './proposal.js';
import { EffortSchema, ModelIdSchema } from './models.js';
import { NOTE_MAX } from './decisions.js';

/**
 * What the user loses if the click was a mistake (action registry spec §2): `read` nothing (applied on click),
 * `reversible` something Ledge can undo (one click), `destructive` something it cannot (asked again, `confirmed`).
 */
export const ActionRiskSchema = z.enum(['read', 'reversible', 'destructive']);
export type ActionRisk = z.infer<typeof ActionRiskSchema>;

/** The card a registry action is drawn on: the generic one (spec §5), or one of the cards that came before it. */
export type ActionCard = 'generic' | 'launch' | 'relay' | 'close' | 'project';
/** The device check a phone needs before applying it (`ConfirmPurpose` of phone.ts): the earlier cards keep theirs;
 *  a generic row asks `act`, one check over the turn for every row applied (spec §5.1). */
export type ActionPhoneCheck = 'launch' | 'close' | 'decide' | 'act';

export const ACTION_IDS = [
  'session.launch', 'session.relay', 'session.close', 'project.propose',
  'session.model', 'session.interrupt', 'session.archive', 'session.restore', 'session.resume', 'session.decide'
] as const;
export const ActionIdSchema = z.enum(ACTION_IDS);
export type ActionId = z.infer<typeof ActionIdSchema>;

/**
 * One thing Ledge's chat may propose (spec §2): the source of the persona's section, of the daemon's validation and of
 * the card. `args` is what Ledge writes, names allowed (the daemon resolves them); `summary` and `when` are the persona's
 * French; `example` is checked against `args` by a test; `cli` the equivalent command (#93).
 */
export interface ActionDef<A extends z.ZodTypeAny = z.ZodTypeAny> {
  id: ActionId; args: A; summary: string; when: string; example: z.input<A>;
  risk: ActionRisk | ((args: z.infer<A>) => ActionRisk);
  max: number; card: ActionCard; phone: ActionPhoneCheck | null; cli?: string;
}
/** Typed against its own args where it is written, then kept as a plain entry of the registry. */
const def = <A extends z.ZodTypeAny>(d: ActionDef<A>): ActionDef => d as unknown as ActionDef;

/** A session as Ledge names it: its id or its bot name, as sessions.md gives them. */
const SessionRef = z.string().trim().min(1).max(80);

const LaunchArgs = ProposalBlockSchema.extend({ model: ModelIdSchema.optional(), effort: EffortSchema.optional() });

export const ACTIONS: readonly ActionDef[] = [
  def({
    id: 'session.launch', args: LaunchArgs, card: 'launch', phone: 'launch', risk: 'reversible', max: 8,
    summary: 'ouvrir une session d\'agent dans un dossier, avec sa première instruction',
    when: 'quand l\'utilisateur demande explicitement d\'ouvrir ou de lancer une session, et seulement si le dossier est sûr : un chemin absolu lu dans sessions.md ou folders.md, ou donné tel quel par l\'utilisateur ; une action par session, et pour un dossier incertain cite les candidats et demande lequel. model et effort seulement si l\'utilisateur les demande',
    example: { cwd: '/home/alice/projets/api', prompt: 'Lance les tests et corrige ceux qui échouent' }
  }),
  def({
    id: 'session.relay', args: RelayBlockSchema, card: 'relay', phone: null, risk: 'reversible', max: 1,
    summary: 'envoyer une instruction à une session (tout de suite si elle est libre, sinon dès qu\'elle le sera)',
    when: 'quand l\'utilisateur demande explicitement de dire, demander ou envoyer quelque chose à une session, et seulement si une seule session correspond et qu\'elle n\'est pas en lecture seule ; le texte est formulé pour l\'agent',
    example: { session: 'Nova', text: 'Ajoute un test pour le cas où la liste est vide' }
  }),
  def({
    id: 'session.close', args: CloseBlockSchema, card: 'close', phone: 'close', risk: 'reversible', max: 8, cli: 'ledge close <session>',
    summary: 'fermer proprement une session ; sa conversation reste reprenable',
    when: 'quand l\'utilisateur demande explicitement de fermer, clore, arrêter ou quitter des sessions qui correspondent sans ambiguïté, pas en lecture seule ni déjà terminées. S\'il veut d\'abord un point de reprise, propose seulement le relais de cette demande',
    example: { session: 'Nova' }
  }),
  def({
    id: 'project.propose', args: ProjectBlockSchema, card: 'project', phone: null, risk: 'reversible', max: 1,
    summary: 'créer un projet, ou compléter un projet existant (addTo), avec ses dépôts',
    when: 'seulement si l\'utilisateur demande explicitement de créer ou de compléter un projet : lis projects.md, ne cite que des chemins absolus lus dans sessions.md, folders.md ou projects.md, jamais un dépôt qui appartient déjà à un projet ; ta réponse dit le nom, chaque dépôt et pourquoi',
    example: { name: 'Facturation', description: 'Le service et son front', repos: [{ path: '/home/alice/projets/billing-api', why: 'le service' }] }
  }),
  def({
    id: 'session.model', card: 'generic', phone: null, risk: 'reversible', max: 8,
    args: z.object({ session: SessionRef, model: ModelIdSchema.nullable(), effort: EffortSchema.nullable() }),
    summary: 'changer le modèle et l\'effort d\'une session en cours (null : le défaut de l\'agent) ; elle redémarre sur la même conversation, à son prochain moment libre',
    when: 'quand l\'utilisateur demande de passer une session sur un autre modèle ou un autre effort',
    example: { session: 'Nova', model: 'claude-opus-5-5', effort: 'high' }
  }),
  def({
    id: 'session.interrupt', args: z.object({ session: SessionRef }), card: 'generic', phone: null, risk: 'reversible', max: 8,
    summary: 'interrompre le tour en cours d\'une session (comme Échap) ; la session reste ouverte',
    when: 'quand l\'utilisateur demande d\'interrompre, de stopper ou d\'arrêter ce que fait une session sans la fermer',
    example: { session: 'Nova' }
  }),
  def({
    id: 'session.archive', args: z.object({ session: SessionRef }), card: 'generic', phone: null, risk: 'reversible', max: 8,
    summary: 'archiver une session terminée : elle quitte la liste mais est gardée (restaurable)',
    when: 'quand l\'utilisateur demande d\'archiver ou de ranger des sessions ; une session encore en cours se ferme d\'abord : propose session.close puis session.archive, dans cet ordre, dans la même réponse',
    example: { session: 'Nova' }
  }),
  def({
    id: 'session.restore', args: z.object({ session: SessionRef }), card: 'generic', phone: null, risk: 'reversible', max: 8,
    summary: 'sortir une session de l\'archive, telle qu\'elle était',
    when: 'quand l\'utilisateur demande de restaurer une session archivée',
    example: { session: 'Nova' }
  }),
  def({
    id: 'session.resume', args: z.object({ session: SessionRef }), card: 'generic', phone: 'act', risk: 'reversible', max: 8,
    summary: 'relancer l\'agent d\'une session terminée sur sa conversation',
    when: 'quand l\'utilisateur demande de reprendre ou relancer une session terminée',
    example: { session: 'Nova' }
  }),
  def({
    id: 'session.decide', card: 'generic', phone: 'act', max: 1,
    args: z.object({ session: SessionRef, decision: z.enum(['accept', 'deny']), note: z.string().trim().min(1).max(NOTE_MAX).optional() }),
    risk: a => (a.decision === 'accept' ? 'destructive' : 'reversible'),
    summary: 'accepter ou refuser la demande en attente d\'une session (permission, diff ou plan), note possible avec un refus ; jamais « toujours »',
    when: 'seulement quand l\'utilisateur demande explicitement d\'accepter ou de refuser la demande d\'une session précise, et que sessions.md montre une demande en attente pour elle ; cite la demande telle quelle dans ta réponse',
    example: { session: 'Nova', decision: 'deny', note: 'Pas sur main : crée une branche' }
  })
];

const byId = new Map<string, ActionDef>(ACTIONS.map(a => [a.id, a]));
export const actionById = (id: string): ActionDef | undefined => byId.get(id);
/** The action's risk for these args (session.decide: accept is destructive, deny is not). */
export const riskOf = (a: ActionDef, args: unknown): ActionRisk => (typeof a.risk === 'function' ? a.risk(args) : a.risk);

/** What the chat writes in its ```ledge-action block (spec §3): a registry id and its args. */
export const ActionBlockSchema = z.object({ action: z.string().trim().min(1).max(40), args: z.record(z.unknown()).default({}) });
/** The action each fence written before the registry stands for (spec §3.1): its JSON is that action's args. */
export const LEGACY_FENCE_ACTION: Record<Exclude<BlockKind, 'action'>, ActionId> = {
  session: 'session.launch', relay: 'session.relay', close: 'session.close', project: 'project.propose'
};

/** A block as a registry action with its args parsed, whatever fence it came in; or why not (for the log line). */
export function parseActionBlock(kind: BlockKind, raw: string): { action: ActionDef; args: unknown } | { error: string } {
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { error: 'invalid JSON' }; }
  let id: string; let args: unknown;
  if (kind === 'action') {
    const b = ActionBlockSchema.safeParse(json);
    if (!b.success) return { error: 'not an {action, args} object' };
    id = b.data.action; args = b.data.args;
  } else { id = LEGACY_FENCE_ACTION[kind]; args = json; }
  const action = actionById(id);
  if (!action) return { error: `unknown action ${id}` };
  const parsed = action.args.safeParse(args);
  if (!parsed.success) return { error: `invalid args for ${id}: ${parsed.error.issues.map(i => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}` };
  return { action, args: parsed.data };
}

/**
 * What Ledge must never propose (spec §6.2), with the screen to name instead; the persona lists them.
 */
export const NEVER_PROPOSED: readonly string[] = [
  'tuer (kill) ou supprimer une session, la retirer de la liste',
  'mettre à jour le daemon',
  'changer les machines, les réglages, l\'accès mobile',
  'modifier les projets autrement que par la carte de projet',
  'créer un dossier',
  'répondre « toujours » à une demande, ou répondre aux questions à choix d\'OMP'
];
