import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIONS, NEVER_PROPOSED } from '@ledge/protocol';
import { installedAgents, ledgeMd, readGuide } from '../src/chat/guide.js';
import { writeContext, stepFor } from '../src/chat/context.js';
import { buildPersona } from '../src/chat/persona.js';

const T0 = '2026-10-11T10:00:00.000Z';
const tmp = () => mkdtempSync(join(tmpdir(), 'guide-'));

describe('ledge.md', () => {
  it('finds the hand-written guide in the repository docs', async () => {
    const guide = await readGuide();
    expect(guide).toBe(readFileSync(new URL('../../../docs/ledge-guide.md', import.meta.url), 'utf8'));
  });

  it('holds the guide, then the version, the agents, every action and what is never proposed', () => {
    const md = ledgeMd({ guide: '# Guide\n\nLe guide.', version: '1.2.3', agents: ['claude', 'omp'] });
    expect(md.startsWith('# Guide\n\nLe guide.')).toBe(true);
    expect(md).toContain('- Daemon version: 1.2.3');
    expect(md).toContain('- Agents installed (found on the PATH): claude, omp');
    for (const a of ACTIONS) expect(md).toContain(`- \`${a.id}\` — ${a.summary} — `);
    for (const n of NEVER_PROPOSED) expect(md).toContain(`- ${n}`);
  });

  it('says what it does not know: a missing guide, version or agents', () => {
    const md = ledgeMd({ guide: null });
    expect(md).toContain('The Ledge guide is missing');
    expect(md).toContain('- Daemon version: unknown');
    expect(md).toContain('- Agents installed (found on the PATH): unknown');
    expect(ledgeMd({ guide: 'g', agents: [] })).toContain('none found');
  });

  it('writeContext writes it when asked, as a step', async () => {
    const dir = tmp();
    const ctx = await writeContext(dir, { sessions: [], now: T0, capture: async () => null, git: async () => null, ledge: { guide: '# G', version: '9.9.9' } });
    expect(readFileSync(join(dir, 'ledge.md'), 'utf8')).toContain('9.9.9');
    expect(stepFor(join(dir, 'ledge.md'), ctx)).toEqual({ kind: 'repo', name: 'Ledge', path: 'ledge.md' });
    const none = tmp();
    await writeContext(none, { sessions: [], now: T0, capture: async () => null, git: async () => null });
    expect(existsSync(join(none, 'ledge.md'))).toBe(false);
  });

  it('finds the agents whose executable is on the PATH, executable only', async () => {
    const a = tmp(); const b = tmp();
    writeFileSync(join(a, 'claude'), ''); chmodSync(join(a, 'claude'), 0o755);
    writeFileSync(join(b, 'cursor-agent'), ''); chmodSync(join(b, 'cursor-agent'), 0o755);
    writeFileSync(join(b, 'codex'), ''); chmodSync(join(b, 'codex'), 0o644);
    expect(await installedAgents(`${a}:${b}`)).toEqual(['claude', 'cursor']);
    expect(await installedAgents(undefined)).toEqual([]);
  });
});

describe('the persona', () => {
  it('sends a question about Ledge to ledge.md and one about the user\'s environment to the notes index', () => {
    const p = buildPersona('claude');
    expect(p).toMatch(/question sur Ledge lui-même[^\n]*lis ledge\.md/);
    expect(p).toMatch(/environnement de l'utilisateur[^\n]*lis context-index\.md[^\n]*seulement les notes pertinentes[^\n]*cite la note et sa date/);
  });
});
