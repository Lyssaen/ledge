import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extractProposal, MAX_PROPOSALS, parseActionBlock, type ChatAction, type ChatPoint, type Tool } from '@ledge/protocol';
import { resolveAction } from '../daemon/actions.js';
import { buildPersona } from '../chat/persona.js';
import { chatEnv, runTool, writeChatContext, type ChatDeps } from '../chat/service.js';
import { log } from '../log.js';
import { LEAD_LINES_MAX } from './constants.js';
import type { JournalEvent } from './journal.js';

export interface LeadResult {
  lead: string | null;
  /** The resolved rows the agent attached to one item of the point, by item id. */
  suggestions: Array<{ item: string; action: ChatAction }>;
  /** The resolved rows without an item: the turn's plan card. */
  actions: ChatAction[];
  error?: string;
}

const LEAD_MAX = 300;
const failed = (error: string): LeadResult => ({ lead: null, suggestions: [], actions: [], error });

/** The first sentence of the answer, cut to what the point's lead holds. */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = /^[\s\S]*?[.!?…](?=\s|$)/.exec(t);
  return (m ? m[0] : t.split('\n')[0]!).trim().slice(0, LEAD_MAX);
}

const INSTRUCTION = `Ledge wrote the point's items itself (listed below as JSON). Write one sentence of at most 25 words for the notch and the phone, in the user's language, waiting items first. `
  + `Then optionally \`ledge-action\` blocks for the items you report (one per item at most, by item id in \`args.item\`), or one plan. At most ${LEAD_LINES_MAX} lines in all.`;

/**
 * One fresh, read-only run of the chat's harness per wake: the lead sentence of the point and optional action blocks. It never resumes the
 * day's conversation and reads its own temporary context folder. Any failure returns `lead: null` with `error`: the caller falls back to
 * the daemon's own lead.
 */
export async function runLead(o: { deps: ChatDeps; tool: Tool; events: readonly JournalEvent[]; point: ChatPoint; timeoutMs?: number }): Promise<LeadResult> {
  const { deps, tool, point } = o;
  const dir = join(deps.home, 'chat', 'operator', randomUUID());
  try {
    await mkdir(dir, { recursive: true });
    const env = await chatEnv(deps);
    const ctx = await writeChatContext(deps, dir, { journal: [...o.events] });
    const question = `${INSTRUCTION}\n\n${JSON.stringify(point.items)}`;
    let answer = ''; let resultError: string | null = null;
    const handle = runTool(tool, { persona: buildPersona(tool), question, cwd: ctx.dir, addDirs: ctx.repoPaths, sessionId: randomUUID(), resume: false, env, bin: deps.bins?.[tool] ?? deps.bin }, e => {
      if (e.type === 'delta') answer += e.text;
      else if (e.type === 'result') { if (e.text) answer = e.text; if (e.isError) resultError = e.text || 'the harness reported an error'; }
    }, deps.spawn);
    let timedOut = false;
    const timer = setTimeout(() => { log('operator lead: timed out'); timedOut = true; handle.kill(); }, o.timeoutMs ?? deps.timeoutMs ?? 180_000);
    const r = await handle.done; clearTimeout(timer);
    if (timedOut) return failed('the lead run timed out');
    if (r.code !== 0) return failed(r.code === null ? `could not start: ${r.stderr.trim() || 'not found in PATH'}` : r.stderr.trim() || `exited with code ${r.code}`);
    if (resultError) return failed(resultError);
    const { text, blocks: found } = extractProposal(answer);
    const lead = firstSentence(text);
    if (!lead) return failed('empty answer');

    const ctxNow = { sessions: deps.store.all(), tasks: deps.tasks?.() ?? [], closing: new Set<string>(), rigs: deps.rigs?.(), asks: deps.asks?.(), goals: deps.goals?.(), prs: deps.prs?.() };
    const itemIds = new Set(point.items.map(i => i.id));
    const suggestions: LeadResult['suggestions'] = []; const actions: ChatAction[] = [];
    const per = new Map<string, number>();
    for (const b of found) {
      if (b.kind !== 'action') continue;
      let item: string | undefined; let raw = b.raw;
      try {
        const j = JSON.parse(b.raw) as { args?: Record<string, unknown> };
        if (j && typeof j === 'object' && j.args && typeof j.args === 'object' && 'item' in j.args) {
          const { item: it, ...args } = j.args;
          item = typeof it === 'string' ? it : undefined;
          raw = JSON.stringify({ ...j, args });
          if (item === undefined) { log('operator lead: action ignored: item is not a string'); continue; }
        }
      } catch { log('operator lead: action ignored: invalid JSON'); continue; }
      const p = parseActionBlock('action', raw);
      if ('error' in p) { log(`operator lead: action ignored: ${p.error}`); continue; }
      if ((per.get(p.action.id) ?? 0) >= p.action.max) { log(`operator lead: ${p.action.id} beyond ${p.action.max} ignored`); continue; }
      if (suggestions.length + actions.length >= MAX_PROPOSALS) { log(`operator lead: action beyond ${MAX_PROPOSALS} ignored`); continue; }
      if (item !== undefined && !itemIds.has(item)) { log(`operator lead: action ignored: unknown item ${item}`); continue; }
      if (item !== undefined && suggestions.some(s => s.item === item)) { log(`operator lead: action ignored: second suggestion for ${item}`); continue; }
      const res = resolveAction(p.action.id, p.args, ctxNow);
      if ('refused' in res) { log(`operator lead: action ignored: ${res.refused}`); continue; }
      per.set(p.action.id, (per.get(p.action.id) ?? 0) + 1);
      if (item !== undefined) suggestions.push({ item, action: res }); else actions.push(res);
    }
    return { lead, suggestions, actions };
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
