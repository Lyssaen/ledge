import { describe, it, expect, vi } from 'vitest';
import type { ThreadItem } from '@ledge/protocol';
import { fr } from '../src/tui/i18n/fr.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import { threadView } from '../src/tui/model/thread.js';

// The parser counted: a thread drawn again must not parse its texts again.
const parsed = vi.hoisted(() => ({ n: 0 }));
vi.mock('@ledge/ui/documents/mdast', async real => {
  const mod = await real<typeof import('@ledge/ui/documents/mdast')>();
  return { ...mod, parseMarkdown: (text: string) => { parsed.n++; return mod.parseMarkdown(text); } };
});

const at = (s: number) => new Date(Date.parse('2026-10-26T08:00:00Z') + s * 1000).toISOString();
const msg = (i: number): ThreadItem => ({ kind: 'message', id: `m${i}`, turn: 1, at: at(i), text: `Je regarde **${i}** dans \`thread.ts\`.` } as ThreadItem);

describe('ledge tui: the thread drawn again (#95 lot C)', () => {
  it('more than 500 texts: the next change parses only what is new', () => {
    const items: ThreadItem[] = [{ kind: 'prompt', id: 'p1', turn: 1, at: at(0), text: 'Fais la tâche' } as ThreadItem];
    for (let i = 1; i <= 600; i++) items.push(msg(i));
    const o = { t: fr, g: glyphsFor({}), width: 100, diffs: false, unfolded: false };
    threadView(items, o);
    parsed.n = 0;
    threadView([...items, msg(601)], o);
    expect(parsed.n).toBe(1);
  });
});
