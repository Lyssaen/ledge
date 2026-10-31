import { describe, it, expect } from 'vitest';
import type { ThreadItem } from '@ledge/protocol';
import { fr } from '../src/tui/i18n/fr.js';
import { glyphsFor } from '../src/tui/glyphs.js';
import { ompPaneLines } from '../src/tui/model/ompPane.js';
import { C } from '../src/tui/theme.js';
import { until } from './helpers.js';
import { mockupSessions, startTui } from './tui-fixture.js';

const base = Date.parse('2026-10-30T16:30:00');
const at = (s: number) => new Date(base + s * 1000).toISOString();
const g = glyphsFor({});
const o = (extra: Partial<Parameters<typeof ompPaneLines>[1]> = {}) => ({ t: fr, g, width: 80, now: base + 60_000, name: 'Lyra', working: false, ...extra });
const text = (l: { text: string }[]) => l.map(s => s.text).join('');
const tool = (id: string, extra: Record<string, unknown>) => ({ kind: 'tool', id, turn: 1, at: at(2), tool: 'read', label: 'src/client.ts', status: 'success', durationMs: 40, files: [], ...extra }) as ThreadItem;

describe('ledge tui: OMP thread as a terminal', () => {
  it('a prompt, a reply and tools draw like a terminal', () => {
    const items: ThreadItem[] = [
      { kind: 'prompt', id: 'p', turn: 1, at: at(0), text: 'Ajoute la gestion du 429' } as ThreadItem,
      { kind: 'message', id: 'm', turn: 1, at: at(1), text: 'Je regarde le client.' } as ThreadItem,
      tool('t1', {}),
      { kind: 'reply', id: 'r', turn: 1, at: at(5), text: 'Fait.' } as ThreadItem,
      { kind: 'helper', id: 'h', turn: 1, at: at(3), task: 'trouver les appels à fetch', agentType: 'explorer', state: 'exited' } as ThreadItem
    ];
    const lines = ompPaneLines(items, o());
    const rows = lines.map(text);
    expect(rows).toContain('❯ Ajoute la gestion du 429');
    expect(rows.some(r => /^ {2}toi · 16:30$/.test(r))).toBe(true);
    expect(rows.filter(r => r.startsWith('π Lyra · 16:30'))).toHaveLength(1);
    const read = rows.find(r => r.includes('✓ read'))!;
    expect(read).toMatch(/src\/client\.ts +0,0 s$/);
    expect(read.length).toBe(80);
    expect(rows.some(r => r.startsWith('  ↳ explorer · trouver les appels à fetch'))).toBe(true);
    const head = lines.find(l => text(l).startsWith('π Lyra'))!;
    expect(head[0]).toMatchObject({ text: 'π', color: C.omp });
    expect(lines.find(l => text(l).startsWith('❯'))![0]).toMatchObject({ color: C.coral });
  });

  it('a running tool shows its spinner and elapsed time', () => {
    const items = [tool('t', { tool: 'bash', label: 'pnpm vitest', status: 'running', durationMs: undefined, at: at(57) })];
    const row = ompPaneLines(items, o()).map(text).find(r => r.includes('bash'))!;
    expect(row).toContain('◐ bash');
    expect(row).toContain('3,0 s');
  });

  it('a failed tool is red and the working line closes the pane', () => {
    const items = [tool('t', { status: 'failed', error: 'ENOENT' })];
    const lines = ompPaneLines(items, o({ working: true }));
    const failed = lines.find(l => text(l).includes('✗ read'))!;
    expect(failed.find(s => s.text === '✗')).toMatchObject({ color: C.red });
    expect(text(lines[lines.length - 1]!)).toBe('  ◐ écrit… · 58 s');
  });

  it('the pane keeps every line, the last one is the last item\'s', () => {
    const items = Array.from({ length: 200 }, (_, i) => tool(`t${i}`, { label: `f${i}.ts` }));
    const lines = ompPaneLines(items, o());
    expect(lines.length).toBeGreaterThanOrEqual(200);
    expect(text(lines[lines.length - 1]!)).toContain('f199.ts');
  });

  it('a tool\'s output shows its last lines under the bar', () => {
    const output = ['one', 'two', '\x1b[32m✓ test/client.test.ts (4 tests) 212ms\x1b[0m', '', '  ✓ réessaie après un 429'].join('\n');
    const rows = ompPaneLines([tool('t', { tool: 'bash', label: 'pnpm vitest', output })], o({ width: 30 })).map(text);
    expect(rows.slice(1)).toEqual(['      │ two', '      │ ✓ test/client.test.ts…', '      │   ✓ réessaie après un…']);
    expect(rows.every(r => r.length <= 30)).toBe(true);
  });

  it('draws nothing for what OMP does not send', () => {
    expect(ompPaneLines([], o())).toEqual([]);
  });
});

describe('ledge tui: an OMP session in the home', () => {
  it('shows π fil · OMP instead of a terminal, and asks for no colour preview', async () => {
    const omp = { ...mockupSessions()[1]!, id: 'omp1', name: 'Lyra', tool: 'omp' as const, backend: 'omp-rpc' as const, tmuxSession: null };
    const tui = await startTui({ sessions: [mockupSessions()[0]!, omp], colorLines: ['\x1b[31mrouge\x1b[0m'] });
    try {
      tui.daemon.thread('omp1', [
        { kind: 'prompt', id: 'p', turn: 1, at: at(0), text: 'Ajoute la gestion du 429' },
        { kind: 'reply', id: 'r', turn: 1, at: at(1), text: 'Fait, avec un test.' }
      ] as ThreadItem[]);
      await tui.resize(160, 46);
      await tui.pick('Lyra');
      await until(() => tui.frame().includes('Fait, avec un test.'));
      const f = tui.frame();
      expect(f).toContain('π FIL · OMP');
      expect(f).not.toContain('Π');
      expect(f).toContain('piloté par RPC · rien n’est tapé dans un terminal');
      expect(f).toContain('❯ Ajoute la gestion du 429');
      expect(f).not.toContain('TERMINAL · ');
      expect(tui.daemon.received.filter(m => m.type === 'session.preview.subscribe' && (m as { color?: boolean }).color && (m as { id: string | null }).id === 'omp1')).toEqual([]);
    } finally { await tui.cleanup(); }
  });

  it('t on screen 3 shows the OMP pane and asks for no colour preview', async () => {
    const omp = { ...mockupSessions()[1]!, id: 'omp1', name: 'Lyra', tool: 'omp' as const, backend: 'omp-rpc' as const, tmuxSession: null };
    const tui = await startTui({ sessions: [mockupSessions()[0]!, omp], colorLines: ['\x1b[31mrouge\x1b[0m'] });
    try {
      tui.daemon.thread('omp1', [{ kind: 'reply', id: 'r', turn: 1, at: at(1), text: 'Fait, avec un test.' }] as ThreadItem[]);
      await tui.resize(160, 46);
      await tui.pick('Lyra');
      await tui.press('\r');
      await until(() => tui.frame().includes('Fait, avec un test.'));
      await tui.press('t');
      await until(() => tui.frame().includes('π FIL · OMP'));
      expect(tui.frame()).toContain('Fait, avec un test.');
      expect(tui.daemon.received.filter(m => m.type === 'session.preview.subscribe' && (m as { color?: boolean }).color && (m as { id: string | null }).id === 'omp1')).toEqual([]);
    } finally { await tui.cleanup(); }
  });
});
