import { describe, it, expect } from 'vitest';
import { extractProposal, parseProposalBlock, parseProjectBlock, parseRelayBlock, parseCloseBlock, hideProposal, parseTeamBlock, parseTaskBlock } from '../src/proposal.js';

const block = (json: string) => '```ledge-session\n' + json + '\n```';

describe('extractProposal', () => {
  it('leaves an answer without a block untouched', () => {
    const a = 'Deux compagnons travaillent.\n\n```bash\nls\n```\n';
    expect(extractProposal(a)).toEqual({ text: a, kind: null, raw: null, blocks: [] });
  });
  it('takes the block out and returns its JSON', () => {
    expect(extractProposal('Je te propose ça.\n\n' + block('{"cwd": "/w/ledge"}'))).toMatchObject({ text: 'Je te propose ça.', kind: 'session', raw: '{"cwd": "/w/ledge"}' });
  });
  it('keeps the text after the block', () => {
    expect(extractProposal('Avant.\n' + block('{"cwd": "/a"}') + '\nAprès.')).toMatchObject({ text: 'Avant.\n\nAprès.', kind: 'session', raw: '{"cwd": "/a"}' });
  });
  it('removes every block and keeps the last one', () => {
    expect(extractProposal('A\n' + block('{"cwd": "/a"}') + '\n\nB\n' + block('{"cwd": "/b"}'))).toMatchObject({ text: 'A\n\nB', kind: 'session', raw: '{"cwd": "/b"}' });
  });
  it('takes an unclosed block to the end of the answer', () => {
    expect(extractProposal('A\n```ledge-session\n{"cwd":')).toMatchObject({ text: 'A', kind: 'session', raw: '{"cwd":' });
  });
});

describe('extractProposal: several blocks (#24)', () => {
  it('lists every block in order, the last one still giving kind and raw', () => {
    const r = extractProposal('Trois sessions.\n' + block('{"cwd": "/a"}') + '\n' + block('{"cwd": "/b"}') + '\n' + block('{"cwd": "/c"}'));
    expect(r.text).toBe('Trois sessions.');
    expect(r.blocks).toEqual([{ kind: 'session', raw: '{"cwd": "/a"}' }, { kind: 'session', raw: '{"cwd": "/b"}' }, { kind: 'session', raw: '{"cwd": "/c"}' }]);
    expect(r).toMatchObject({ kind: 'session', raw: '{"cwd": "/c"}' });
  });
  it('an answer without a block has no blocks', () => {
    expect(extractProposal('Rien.').blocks).toEqual([]);
  });
  it('keeps the kind of each block when they are mixed', () => {
    const r = extractProposal('A\n```ledge-relay\n{"session": "s1", "text": "a"}\n```\n' + block('{"cwd": "/w"}'));
    expect(r.blocks.map(b => b.kind)).toEqual(['relay', 'session']);
  });
});

describe('parseProposalBlock', () => {
  it('reads cwd and the optional prompt', () => {
    expect(parseProposalBlock('{"cwd": "~/ledge", "prompt": "Corrige le build"}')).toEqual({ cwd: '~/ledge', prompt: 'Corrige le build' });
    expect(parseProposalBlock('{"cwd": "/w/ledge"}')).toEqual({ cwd: '/w/ledge' });
  });
  it('refuses bad JSON, a missing or empty cwd, and anything that is not an object', () => {
    for (const raw of ['{"cwd":', '{"prompt": "x"}', '{"cwd": "  "}', '{"cwd": 3}', '["/w"]', 'null', '']) expect(parseProposalBlock(raw)).toBeNull();
  });
});

describe('hideProposal', () => {
  it('never shows a fence being typed nor the JSON that follows', () => {
    const steps = ['Je lance.\n`', 'Je lance.\n``', 'Je lance.\n```', 'Je lance.\n```ledge-se', 'Je lance.\n```ledge-session\n{"cwd": "/w', 'Je lance.\n' + block('{"cwd": "/w"}')];
    for (const s of steps) expect(hideProposal(s)).toBe('Je lance.');
  });
  it('shows ordinary text and other code blocks', () => {
    expect(hideProposal('Deux ')).toBe('Deux ');
    expect(hideProposal('Lance :\n```bash')).toBe('Lance :\n```bash');
  });
});

describe('relay blocks (spec 2026-10-12 relay §3)', () => {
  const relay = (json: string) => 'Je transmets à **Otto**.\n\n```ledge-relay\n' + json + '\n```';
  it('extracts a relay block and says which kind it is', () => {
    expect(extractProposal(relay('{"session": "s1", "text": "Lance les tests"}'))).toMatchObject({ text: 'Je transmets à **Otto**.', kind: 'relay', raw: '{"session": "s1", "text": "Lance les tests"}' });
    expect(extractProposal('Rien à faire.')).toEqual({ text: 'Rien à faire.', kind: null, raw: null, blocks: [] });
    expect(extractProposal('A\n```ledge-session\n{"cwd": "/w"}\n```').kind).toBe('session');
  });
  it('mixed blocks: all leave the text, the last one counts whatever its language', () => {
    const answer = 'Voilà.\n```ledge-relay\n{"session": "s1", "text": "a"}\n```\n```ledge-session\n{"cwd": "/w"}\n```';
    expect(extractProposal(answer)).toMatchObject({ text: 'Voilà.', kind: 'session', raw: '{"cwd": "/w"}' });
    const other = 'Voilà.\n```ledge-session\n{"cwd": "/w"}\n```\n```ledge-relay\n{"session": "s1", "text": "b"}\n```';
    expect(extractProposal(other)).toMatchObject({ kind: 'relay', raw: '{"session": "s1", "text": "b"}' });
  });
  it('parseRelayBlock needs both fields and a text that is not blank', () => {
    expect(parseRelayBlock('{"session": " s1 ", "text": "  Lance les tests  "}')).toEqual({ session: 's1', text: 'Lance les tests' });
    expect(parseRelayBlock('{"session": "s1"}')).toBeNull();
    expect(parseRelayBlock('{"text": "x"}')).toBeNull();
    expect(parseRelayBlock('{"session": "s1", "text": "   "}')).toBeNull();
    expect(parseRelayBlock('not json')).toBeNull();
  });
  it('hideProposal holds back a relay block, closed or not, and a relay fence being typed', () => {
    expect(hideProposal('Je transmets.\n```ledge-relay\n{"session": "s1", "te')).toBe('Je transmets.');
    expect(hideProposal('Je transmets.\n```ledge-re')).toBe('Je transmets.');
    expect(hideProposal('Je transmets.\n```ledge-')).toBe('Je transmets.');
    expect(hideProposal(relay('{"session": "s1", "text": "x"}'))).toBe('Je transmets à **Otto**.');
    expect(hideProposal('Deux ')).toBe('Deux ');
  });
});

describe('project blocks (lot 11 task 5)', () => {
  const project = (json: string) => 'Je propose **Paper** avec deux dépôts.\n\n```ledge-project\n' + json + '\n```';
  const valid = '{"name": " Paper ", "description": "Les polices", "repos": [{"path": "/w/paper-fonts", "why": " Nommé paper-* "}], "addTo": " Ledge "}';
  it('extracts a ledge-project block and says it is a project', () => {
    expect(extractProposal(project(valid))).toMatchObject({ text: 'Je propose **Paper** avec deux dépôts.', kind: 'project', raw: valid });
    expect(extractProposal('A\n```ledge-project\n{"name":').kind).toBe('project');
  });
  it('parseProjectBlock reads the block, trims, and keeps the bounds', () => {
    expect(parseProjectBlock(valid)).toEqual({ name: 'Paper', description: 'Les polices', repos: [{ path: '/w/paper-fonts', why: 'Nommé paper-*' }], addTo: 'Ledge' });
    expect(parseProjectBlock('{"name": "Paper", "repos": [{"path": "/w/p", "why": "x"}]}')).toEqual({ name: 'Paper', repos: [{ path: '/w/p', why: 'x' }] });
  });
  it('an invalid block is ignored', () => {
    const repo = { path: '/w/p', why: 'x' };
    for (const v of [
      {}, { name: 'P', repos: [] }, { name: '  ', repos: [repo] }, { name: 'P', repos: [{ path: '', why: 'x' }] }, { name: 'P', repos: [{ path: '/w', why: ' ' }] },
      { name: 'x'.repeat(81), repos: [repo] }, { name: 'P', description: 'x'.repeat(501), repos: [repo] }, { name: 'P', repos: Array(51).fill(repo) },
      { name: 'P', repos: [{ path: '/w', why: 'x'.repeat(201) }] }, { name: 'P', repos: [repo], addTo: 'x'.repeat(81) },
      { name: 'P', repos: [{ path: '/' + 'x'.repeat(4096), why: 'x' }] }
    ]) expect(parseProjectBlock(JSON.stringify(v))).toBeNull();
    // A path of 4096 characters is still read.
    expect(parseProjectBlock(JSON.stringify({ name: 'P', repos: [{ path: '/' + 'x'.repeat(4095), why: 'x' }] }))).not.toBeNull();
    expect(parseProjectBlock('{"name":')).toBeNull();
    expect(parseProjectBlock('null')).toBeNull();
  });
  it('hideProposal holds back a project block being typed, closed or not', () => {
    expect(hideProposal('Je propose.\n```ledge-pro')).toBe('Je propose.');
    expect(hideProposal('Je propose.\n```ledge-project\n{"name": "Pa')).toBe('Je propose.');
    expect(hideProposal(project(valid))).toBe('Je propose **Paper** avec deux dépôts.');
  });
});

describe('ledge-close blocks', () => {
  const close = (session: string) => '```ledge-close\n' + JSON.stringify({ session }) + '\n```';
  it('extractProposal reads several close blocks and removes them from the text', () => {
    const r = extractProposal('Je ferme Arlo et Bram.\n' + close('a1') + '\n' + close('b2'));
    expect(r.kind).toBe('close');
    expect(r.text).toBe('Je ferme Arlo et Bram.');
    expect(r.blocks.map(b => b.kind)).toEqual(['close', 'close']);
  });
  it('the last block decides the kind, and every block leaves the text', () => {
    const session = '```ledge-session\n{"cwd":"/a"}\n```';
    const relay = '```ledge-relay\n{"session":"s1","text":"go"}\n```';
    const a = extractProposal('Voilà.\n' + session + '\n' + close('a1'));
    expect(a.kind).toBe('close');
    expect(a.text).toBe('Voilà.');
    const b = extractProposal('Voilà.\n' + close('a1') + '\n' + relay);
    expect(b.kind).toBe('relay');
    expect(b.text).toBe('Voilà.');
  });
  it('parseCloseBlock trims the session and refuses an empty or missing one', () => {
    expect(parseCloseBlock('{"session":"  a1 "}')).toEqual({ session: 'a1' });
    expect(parseCloseBlock('{"session":""}')).toBeNull();
    expect(parseCloseBlock('nope')).toBeNull();
    expect(parseCloseBlock('{}')).toBeNull();
  });
  it('hideProposal holds back a close block and a close fence being typed', () => {
    expect(hideProposal('Je ferme Arlo.\n```ledge-cl')).toBe('Je ferme Arlo.');
    expect(hideProposal('Je ferme.\n```ledge-close\n{"session":"a')).toBe('Je ferme.');
  });
});

describe('team and task blocks (roles spec §3.8)', () => {
  it('a team names a folder and a template, or a name and seats', () => {
    expect(parseTeamBlock('{"cwd": "/w/ledge", "template": "workshop"}')).toEqual({ cwd: '/w/ledge', template: 'workshop' });
    expect(parseTeamBlock('{"cwd": "/w", "name": "r", "seats": [{"role": "build", "tool": "claude"}]}')).toEqual({ cwd: '/w', name: 'r', seats: [{ role: 'build', tool: 'claude' }] });
    expect(parseTeamBlock('{"cwd": "/w"}')).toBeNull();
    expect(parseTeamBlock('{"cwd": "/w", "seats": [{"role": "b", "tool": "vim"}]}')).toBeNull();
    expect(parseTeamBlock('nope')).toBeNull();
  });
  it('a task names a target and a title', () => {
    expect(parseTaskBlock('{"to": "@build", "title": "Implémenter", "text": "roles.ts"}')).toEqual({ to: '@build', title: 'Implémenter', text: 'roles.ts' });
    expect(parseTaskBlock('{"to": "a1b2"}')).toBeNull();
  });
  it('a team and its tasks come out of one answer, in order; a fence being typed is hidden', () => {
    const answer = 'Une équipe.\n```ledge-team\n{"cwd": "/w", "template": "w"}\n```\n```ledge-task\n{"to": "@build", "title": "a"}\n```\n```ledge-task\n{"to": "@qa", "title": "b"}\n```';
    const r = extractProposal(answer);
    expect(r.text).toBe('Une équipe.');
    expect(r.blocks.map(b => b.kind)).toEqual(['team', 'task', 'task']);
    expect(hideProposal('Une équipe.\n```ledge-te')).toBe('Une équipe.');
  });
});
