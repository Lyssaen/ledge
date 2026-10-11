import { describe, expect, it } from 'vitest';
import { findDocumentReferences, parseDocumentReference } from '../src/documents/references';

describe('document references', () => {
  it.each([
    ['README.md', { path: 'README.md' }],
    ['./docs/plan.md:42:7', { path: './docs/plan.md', line: 42, column: 7 }],
    ['~/skills/SKILL.MD', { path: '~/skills/SKILL.MD' }],
    ['/tmp/my folder/plan.markdown#intention', { path: '/tmp/my folder/plan.markdown', anchor: 'intention' }],
    ['docs/plan.md#L42', { path: 'docs/plan.md', line: 42 }]
  ])('parses %s', (input, expected) => { expect(parseDocumentReference(input)).toEqual(expected); });

  it('leaves remote, unsupported and non-Markdown paths alone', () => {
    for (const input of ['https://example.com/a.md', 'file:///tmp/a.md', 'C:\\a.md', 'readme.mdx', 'plan.md:0', 'plan.md#L0']) expect(parseDocumentReference(input)).toBeNull();
  });
  it('finds bare paths without treating spaces or punctuation as part of them', () => {
    const text = 'Lis docs/plan.md, puis SKILL.md:12.';
    expect(findDocumentReferences(text)).toEqual([
      { start: 4, end: 16, reference: { path: 'docs/plan.md' } },
      { start: 23, end: 34, reference: { path: 'SKILL.md', line: 12 } }
    ]);
  });
});
