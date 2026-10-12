import { describe, it, expect } from 'vitest';
import { extractProposal, parseProposalBlock, hideProposal } from '../src/proposal.js';

const block = (json: string) => '```ledge-session\n' + json + '\n```';

describe('extractProposal', () => {
  it('leaves an answer without a block untouched', () => {
    const a = 'Deux compagnons travaillent.\n\n```bash\nls\n```\n';
    expect(extractProposal(a)).toEqual({ text: a, raw: null });
  });
  it('takes the block out and returns its JSON', () => {
    expect(extractProposal('Je te propose ça.\n\n' + block('{"cwd": "/w/ledge"}'))).toEqual({ text: 'Je te propose ça.', raw: '{"cwd": "/w/ledge"}' });
  });
  it('keeps the text after the block', () => {
    expect(extractProposal('Avant.\n' + block('{"cwd": "/a"}') + '\nAprès.')).toEqual({ text: 'Avant.\n\nAprès.', raw: '{"cwd": "/a"}' });
  });
  it('removes every block and keeps the last one', () => {
    expect(extractProposal('A\n' + block('{"cwd": "/a"}') + '\n\nB\n' + block('{"cwd": "/b"}'))).toEqual({ text: 'A\n\nB', raw: '{"cwd": "/b"}' });
  });
  it('takes an unclosed block to the end of the answer', () => {
    expect(extractProposal('A\n```ledge-session\n{"cwd":')).toEqual({ text: 'A', raw: '{"cwd":' });
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
