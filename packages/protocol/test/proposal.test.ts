import { describe, it, expect } from 'vitest';
import { extractProposal, parseProposalBlock, parseRelayBlock, hideProposal } from '../src/proposal.js';

const block = (json: string) => '```ledge-session\n' + json + '\n```';

describe('extractProposal', () => {
  it('leaves an answer without a block untouched', () => {
    const a = 'Deux compagnons travaillent.\n\n```bash\nls\n```\n';
    expect(extractProposal(a)).toEqual({ text: a, kind: null, raw: null });
  });
  it('takes the block out and returns its JSON', () => {
    expect(extractProposal('Je te propose ça.\n\n' + block('{"cwd": "/w/ledge"}'))).toEqual({ text: 'Je te propose ça.', kind: 'session', raw: '{"cwd": "/w/ledge"}' });
  });
  it('keeps the text after the block', () => {
    expect(extractProposal('Avant.\n' + block('{"cwd": "/a"}') + '\nAprès.')).toEqual({ text: 'Avant.\n\nAprès.', kind: 'session', raw: '{"cwd": "/a"}' });
  });
  it('removes every block and keeps the last one', () => {
    expect(extractProposal('A\n' + block('{"cwd": "/a"}') + '\n\nB\n' + block('{"cwd": "/b"}'))).toEqual({ text: 'A\n\nB', kind: 'session', raw: '{"cwd": "/b"}' });
  });
  it('takes an unclosed block to the end of the answer', () => {
    expect(extractProposal('A\n```ledge-session\n{"cwd":')).toEqual({ text: 'A', kind: 'session', raw: '{"cwd":' });
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
    expect(extractProposal(relay('{"session": "s1", "text": "Lance les tests"}'))).toEqual({ text: 'Je transmets à **Otto**.', kind: 'relay', raw: '{"session": "s1", "text": "Lance les tests"}' });
    expect(extractProposal('Rien à faire.')).toEqual({ text: 'Rien à faire.', kind: null, raw: null });
    expect(extractProposal('A\n```ledge-session\n{"cwd": "/w"}\n```').kind).toBe('session');
  });
  it('mixed blocks: all leave the text, the last one counts whatever its language', () => {
    const answer = 'Voilà.\n```ledge-relay\n{"session": "s1", "text": "a"}\n```\n```ledge-session\n{"cwd": "/w"}\n```';
    expect(extractProposal(answer)).toEqual({ text: 'Voilà.', kind: 'session', raw: '{"cwd": "/w"}' });
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
