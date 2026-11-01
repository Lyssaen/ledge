import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Role, RoleDraft, Session } from '@ledge/protocol';
import { listRoles, parseRole, quoteScalar } from '../src/daemon/roles.js';
import { listTemplates, parseTemplate, parseTemplateText, saveTemplate, templateHash } from '../src/daemon/teams.js';
import { definitionHash, deleteDefinition, promptRecipients, roleText, scopeDefinitions, scopeDir, templateText, writeDefinition } from '../src/daemon/definitions.js';

let home: string; let repo: string; let dir: string;
const write = (path: string, text: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ledge-defs-')); process.env.LEDGE_HOME = home;
  repo = mkdtempSync(join(tmpdir(), 'ledge-defs-repo-')); mkdirSync(join(repo, '.git'));
  dir = join(home, 'roles');
});

describe('quoteScalar', () => {
  it('leaves a plain value bare, quotes the rest, and refuses what no quote can hold', () => {
    expect(quoteScalar('claude-opus-4.5')).toBe('claude-opus-4.5');
    expect(quoteScalar('yes')).toBe('"yes"');
    expect(quoteScalar('C# · lead')).toBe('"C# · lead"');
    expect(quoteScalar('say "hi"')).toBe(`'say "hi"'`);
    expect(quoteScalar(`both " and '`)).toBeNull();
    expect(quoteScalar('two\nlines')).toBeNull();
    expect(quoteScalar('cr\rlf')).toBeNull();
  });
});

describe('roleText', () => {
  it('round-trips through parseRole field for field', () => {
    const draft: RoleDraft = { id: 'lead', label: 'C# · "lead": a', prompt: 'Line 1\n\n# Heading\nLine 3', tool: 'codex', autonomy: 'auto' };
    const text = roleText(draft)!;
    expect(text.startsWith('---\nlabel: ')).toBe(true);
    expect(text.endsWith('Line 3\n')).toBe(true);
    expect(text.indexOf('tool:')).toBeLessThan(text.indexOf('autonomy:'));
    write(join(dir, 'lead.md'), text);
    expect(parseRole('lead', readFileSync(join(dir, 'lead.md'), 'utf8'), 'home', join(dir, 'lead.md')))
      .toEqual({ ...draft, source: 'home', path: join(dir, 'lead.md') });
  });

  it('writes every set field in order', () => {
    const text = roleText({ id: 'a', label: 'A', prompt: 'p', tool: 'claude', model: 'opus', effort: 'high', autonomy: 'edits' })!;
    expect(text).toBe('---\nlabel: A\ntool: claude\nmodel: opus\neffort: high\nautonomy: edits\n---\n\np\n');
  });

  it('is null for a label holding both quotes, or a line break', () => {
    expect(roleText({ id: 'a', label: `x " y '`, prompt: 'p' })).toBeNull();
    expect(roleText({ id: 'a', label: 'x\ny', prompt: 'p' })).toBeNull();
  });
});

describe('templateText', () => {
  it('round-trips through parseTemplate', () => {
    const seats = [{ role: 'lead', tool: 'claude' as const, model: 'opus' }, { role: 'dev' }];
    const text = templateText('Revue #2: "MR"', seats)!;
    const path = join(home, 'teams', 'revue.yaml'); write(path, text);
    expect(parseTemplate('revue', readFileSync(path, 'utf8'), 'home', path)).toEqual({ id: 'revue', name: 'Revue #2: "MR"', seats, source: 'home', path });
  });

  it('keeps a seat name with a comma and a colon', () => {
    const seats = [{ role: 'dev', name: 'Zoe, the {dev}: one' }];
    const path = join(home, 'teams', 'z.yaml'); write(path, templateText('Z', seats)!);
    expect(parseTemplate('z', readFileSync(path, 'utf8'), 'home', path)).toMatchObject({ name: 'Z', seats });
  });

  it('is null when a value cannot be written', () => {
    expect(templateText('a\nb', [{ role: 'dev' }])).toBeNull();
    expect(templateText('A', [{ role: 'dev', name: `x " '` }])).toBeNull();
    expect(templateText('tab\there', [{ role: 'dev' }])).toBeNull();
  });

  it('is what saveTemplate writes', () => {
    const seats = [{ role: 'lead' }, { role: 'build', tool: 'claude' as const }];
    const r = saveTemplate('Équipe #1', seats);
    expect(r).toEqual({ path: join(home, 'teams', 'equipe-1.yaml') });
    expect(readFileSync(r.path, 'utf8')).toBe(templateText('Équipe #1', seats));
    expect(listTemplates().templates[0]).toMatchObject({ name: 'Équipe #1', seats });
  });
});

describe('saveTemplate over a template already saved (#143)', () => {
  it('leaves it as it is without the hash of the version to replace, or with another one; replaces it at that version', () => {
    const path = join(home, 'teams', 'duo.yaml');
    write(path, 'name: Duo\nseats:\n  - role: lead # à la main\n');
    const hand = readFileSync(path, 'utf8');
    expect(saveTemplate('Duo', [{ role: 'dev' }])).toEqual({ code: 'exists', path });
    expect(saveTemplate('Duo', [{ role: 'dev' }], definitionHash('autre chose'))).toEqual({ code: 'changed', path });
    expect(readFileSync(path, 'utf8')).toBe(hand);
    expect(templateHash('Duo')).toBe(definitionHash(hand));
    expect(saveTemplate('Duo', [{ role: 'dev' }], definitionHash(hand))).toEqual({ path });
    expect(readFileSync(path, 'utf8')).toBe(templateText('Duo', [{ role: 'dev' }]));
    expect(templateHash('Personne')).toBeUndefined();
  });
});

describe('definitionHash', () => {
  it('is 16 hex characters and follows the text', () => {
    expect(definitionHash('a')).toMatch(/^[0-9a-f]{16}$/);
    expect(definitionHash('a')).toBe(definitionHash('a'));
    expect(definitionHash('a')).not.toBe(definitionHash('b'));
  });
});

describe('writeDefinition', () => {
  it('creates a file with base null, then refuses to replace it', () => {
    const path = join(dir, 'new.md');
    const r = writeDefinition(path, 'one\n', null);
    expect(r).toEqual({ hash: definitionHash('one\n') });
    expect(readFileSync(path, 'utf8')).toBe('one\n');
    expect(writeDefinition(path, 'two\n', null)).toEqual({ code: 'exists' });
    expect(readFileSync(path, 'utf8')).toBe('one\n');
    expect(readdirSync(dir)).toEqual(['new.md']);
  });

  it('replaces with the hash it was given, and leaves a hand edit alone otherwise', () => {
    const path = join(dir, 'r.md');
    const { hash } = writeDefinition(path, 'one\n', null) as { hash: string };
    expect(writeDefinition(path, 'two\n', hash)).toEqual({ hash: definitionHash('two\n') });
    const second = definitionHash('two\n');
    writeFileSync(path, 'by hand\n');
    expect(writeDefinition(path, 'three\n', second)).toEqual({ code: 'changed' });
    expect(readFileSync(path, 'utf8')).toBe('by hand\n');
  });

  it('is changed, not created, when a known version is gone', () => {
    const path = join(dir, 'gone.md');
    expect(writeDefinition(path, 'x', definitionHash('old'))).toEqual({ code: 'changed' });
    expect(existsSync(path)).toBe(false);
  });

  it('leaves no temporary file', () => {
    const path = join(dir, 'a.md');
    const { hash } = writeDefinition(path, 'one', null) as { hash: string };
    writeDefinition(path, 'two', hash);
    writeDefinition(path, 'three', 'ffffffffffffffff');
    expect(readdirSync(dir)).toEqual(['a.md']);
  });
});

describe('deleteDefinition', () => {
  it('removes the file only at its known version', () => {
    const path = join(dir, 'd.md');
    const { hash } = writeDefinition(path, 'one', null) as { hash: string };
    expect(deleteDefinition(path, definitionHash('stale'))).toEqual({ code: 'changed' });
    expect(existsSync(path)).toBe(true);
    expect(deleteDefinition(path, hash)).toEqual({ ok: true });
    expect(existsSync(path)).toBe(false);
  });

  it('is missing when there is no file', () => {
    expect(deleteDefinition(join(dir, 'none.md'), definitionHash('x'))).toEqual({ code: 'missing' });
  });
});

describe('listing', () => {
  it('gives each role and template the hash of its file', () => {
    write(join(home, 'roles', 'lead.md'), '---\nlabel: Chef\n---\nlead');
    write(join(home, 'teams', 'duo.yaml'), 'name: Duo\nseats:\n  - { role: lead }\n');
    const role = listRoles().roles[0]!;
    expect(role.hash).toBe(definitionHash(readFileSync(join(home, 'roles', 'lead.md'), 'utf8')));
    expect(listTemplates().templates[0]!.hash).toBe(definitionHash(readFileSync(join(home, 'teams', 'duo.yaml'), 'utf8')));
  });

  it('tells a template whose file name is not a template id in problems, instead of listing it (issue #145)', () => {
    write(join(home, 'teams', 'mon.equipe.yaml'), 'name: Mon équipe\nseats:\n  - { role: lead }\n');
    write(join(home, 'teams', 'duo.yaml'), 'name: Duo\nseats:\n  - { role: lead }\n');
    const { templates, problems } = listTemplates();
    expect(templates.map(t => t.id)).toEqual(['duo']);
    expect(problems).toEqual([{ path: join(home, 'teams', 'mon.equipe.yaml'), reason: expect.stringContaining('nom de fichier invalide') }]);
  });

  it('keeps a quoted value holding " #" whole in a role and a template', () => {
    write(join(home, 'roles', 'q.md'), '---\nlabel: "C# · a #b" # trailing\ntool: codex # the agent\n---\np');
    write(join(home, 'teams', 'q.yaml'), 'name: "Revue #2" # c\nseats:\n  - role: lead # c\n    name: "Zoe #1"\n');
    expect(listRoles().roles[0]).toMatchObject({ label: 'C# · a #b', tool: 'codex' });
    expect(listTemplates().templates[0]).toMatchObject({ name: 'Revue #2', seats: [{ role: 'lead', name: 'Zoe #1' }] });
  });
});

describe('a value that is only a comment', () => {
  it('is empty, in a role and in a template seat', () => {
    write(join(home, 'roles', 'c.md'), '---\nlabel: C\ntool: # default\n---\np');
    const role = listRoles().roles[0]!;
    expect(role.label).toBe('C'); expect(role.tool).toBeUndefined();
    // As before the change, the seat's value is the empty string (the seat schema then decides), not "# none".
    expect(parseTemplateText('name: C\nseats:\n  - role: lead\n    model: # none\n    name: x # n\n')).toEqual({ name: 'C', seats: [{ role: 'lead', model: '', name: 'x' }] });
  });
});

describe('scopeDir and scopeDefinitions', () => {
  it('names the folder of a scope', () => {
    expect(scopeDir('roles', 'home')).toBe(join(home, 'roles'));
    mkdirSync(join(repo, 'src'));
    expect(scopeDir('teams', 'repo', join(repo, 'src'))).toBe(join(repo, '.ledge', 'teams'));
  });

  it('reads one folder pair, with no shadow merge', () => {
    write(join(home, 'roles', 'dev.md'), '---\nlabel: Home dev\n---\nh');
    write(join(repo, '.ledge', 'roles', 'dev.md'), '---\nlabel: Repo dev\n---\nr');
    write(join(repo, '.ledge', 'roles', 'bad.md'), '---\ntool: vim\n---\n');
    write(join(repo, '.ledge', 'teams', 'duo.yaml'), 'name: Duo\nseats:\n  - { role: dev }\n');
    const r = scopeDefinitions({ roles: scopeDir('roles', 'repo', repo), teams: scopeDir('teams', 'repo', repo) }, 'repo');
    expect(r.roles.map(x => [x.id, x.label, x.source, x.shadows, x.hash !== undefined])).toEqual([['dev', 'Repo dev', 'repo', undefined, true]]);
    expect(r.templates.map(t => [t.id, t.source, t.hash !== undefined])).toEqual([['duo', 'repo', true]]);
    expect(r.problems).toHaveLength(1);
    const h = scopeDefinitions({ roles: scopeDir('roles', 'home'), teams: scopeDir('teams', 'home') }, 'home');
    expect(h.roles.map(x => [x.label, x.source])).toEqual([['Home dev', 'home']]);
    expect(h.templates).toEqual([]);
  });
});

describe('promptRecipients', () => {
  const sess = (id: string, over: Partial<Session> = {}): Session => ({ id, name: id, tool: 'claude', cwd: `/w/${id}`, project: 'p', title: '', tmuxSession: null, state: 'idle', helpers: [],
    startedAt: '2026-10-28T10:00:00.000Z', lastActivityAt: '2026-10-28T10:00:00.000Z', source: 'launcher', role: 'dev', ...over });
  const role = (path: string): Role => ({ id: 'dev', label: 'Dev', prompt: '', source: 'repo', path });

  it('keeps the running launcher sessions whose role resolves to the file', () => {
    const files: Record<string, string> = { '/w/a': '/repo/.ledge/roles/dev.md', '/w/b': '/home/roles/dev.md', '/w/c': '/repo/.ledge/roles/dev.md' };
    const sessions = [sess('a'), sess('b'), sess('c', { state: 'exited' }), sess('d', { archivedAt: '2026-10-28T11:00:00.000Z' }), sess('e', { source: 'hook_only' }), sess('f', { role: 'lead' }), sess('g', { cwd: '/w/none' })];
    const got = promptRecipients('dev', '/repo/.ledge/roles/dev.md', sessions, (_id, cwd) => (files[cwd] ? role(files[cwd]!) : undefined));
    expect(got.map(s => s.id)).toEqual(['a']);
  });
});
