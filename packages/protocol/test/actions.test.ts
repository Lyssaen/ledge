import { describe, it, expect } from 'vitest';
import { ACTIONS, ACTION_IDS, actionById, riskOf, ActionRiskSchema, parseActionBlock, LEGACY_FENCE_ACTION } from '../src/actions.js';
import { extractProposal, hideProposal } from '../src/proposal.js';
import { MAX_PROPOSALS } from '../src/chat.js';

describe('the action registry', () => {
  it('holds every id once, in ACTION_IDS order', () => {
    expect(ACTIONS.map(a => a.id)).toEqual([...ACTION_IDS]);
  });
  it.each(ACTIONS.map(a => [a.id, a] as const))('%s: its example parses against its args', (_id, a) => {
    expect(a.args.safeParse(a.example).success).toBe(true);
  });
  it.each(ACTIONS.map(a => [a.id, a] as const))('%s: a bounded max, a summary, a rule and a risk', (_id, a) => {
    expect(a.max).toBeGreaterThanOrEqual(1); expect(a.max).toBeLessThanOrEqual(MAX_PROPOSALS);
    expect(a.summary.length).toBeGreaterThan(10); expect(a.when.length).toBeGreaterThan(10);
    expect(ActionRiskSchema.safeParse(riskOf(a, a.example)).success).toBe(true);
  });
  it('finds an action by id, and nothing for an unknown one', () => {
    expect(actionById('team.dissolve')?.risk).toBe('destructive');
    expect(actionById('session.kill')).toBeUndefined();
  });
  it('makes accepting a request destructive and refusing it reversible', () => {
    const decide = actionById('session.decide')!;
    expect(riskOf(decide, { session: 'Nova', decision: 'accept' })).toBe('destructive');
    expect(riskOf(decide, { session: 'Nova', decision: 'deny' })).toBe('reversible');
  });
  it('never lets Ledge answer « always »', () => {
    expect(actionById('session.decide')!.args.safeParse({ session: 'Nova', decision: 'always' }).success).toBe(false);
  });
  it('asks a phone for its device check before every destructive action', () => {
    for (const a of ACTIONS) if (riskOf(a, a.example) === 'destructive') expect(a.phone, a.id).not.toBeNull();
    expect(ACTIONS.filter(a => a.card === 'generic' && a.phone).map(a => a.phone)).toEqual(['act', 'act', 'act', 'act', 'act', 'act']);
  });
  it('keeps the six earlier cards on their own card', () => {
    expect(Object.fromEntries(ACTIONS.filter(a => a.card !== 'generic').map(a => [a.id, a.card]))).toEqual({
      'session.launch': 'launch', 'session.relay': 'relay', 'session.close': 'close', 'project.propose': 'project', 'team.launch': 'team', 'task.give': 'task'
    });
  });
});

describe('parseActionBlock', () => {
  it('reads a ledge-action block against its action', () => {
    const r = parseActionBlock('action', '{"action": "session.model", "args": {"session": "Nova", "model": "claude-opus-5-5", "effort": null}}');
    expect(r).toMatchObject({ action: { id: 'session.model' }, args: { session: 'Nova', model: 'claude-opus-5-5', effort: null } });
  });
  it('reads each earlier fence as its action', () => {
    expect(Object.entries(LEGACY_FENCE_ACTION)).toHaveLength(6);
    expect(parseActionBlock('close', '{"session": "s1"}')).toMatchObject({ action: { id: 'session.close' }, args: { session: 's1' } });
    expect(parseActionBlock('session', '{"cwd": "/a"}')).toMatchObject({ action: { id: 'session.launch' }, args: { cwd: '/a' } });
    expect(parseActionBlock('team', '{"cwd": "/a", "template": "dev"}')).toMatchObject({ action: { id: 'team.launch' } });
  });
  it('trims the args as their schema says', () => {
    expect(parseActionBlock('action', '{"action": "team.dissolve", "args": {"team": " team-3fa2 "}}')).toMatchObject({ args: { team: 'team-3fa2' } });
  });
  it.each([
    ['not JSON', 'action', '{"action":', 'invalid JSON'],
    ['no action', 'action', '{"args": {}}', 'not an {action, args} object'],
    ['an unknown action', 'action', '{"action": "session.kill", "args": {"session": "s1"}}', 'unknown action session.kill'],
    ['bad args', 'action', '{"action": "session.decide", "args": {"session": "s1", "decision": "always"}}', 'invalid args for session.decide'],
    ['a bad legacy block', 'relay', '{"session": "s1"}', 'invalid args for session.relay']
  ] as const)('refuses %s', (_what, kind, raw, error) => {
    const r = parseActionBlock(kind, raw);
    expect('error' in r && r.error).toContain(error);
  });
});

describe('the ledge-action fence', () => {
  it('is taken out of the answer like the other blocks', () => {
    const r = extractProposal('Je passe Nova sur Opus.\n\n```ledge-action\n{"action": "session.model", "args": {}}\n```');
    expect(r).toMatchObject({ text: 'Je passe Nova sur Opus.', kind: 'action', raw: '{"action": "session.model", "args": {}}' });
  });
  it('is hidden while it streams', () => {
    expect(hideProposal('Je passe Nova sur Opus.\n```ledge-ac')).toBe('Je passe Nova sur Opus.');
    expect(hideProposal('Fait.\n```ledge-action\n{"action": "sess')).toBe('Fait.');
  });
});
