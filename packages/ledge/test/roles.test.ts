import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autonomyArgs, findRole, frontMatter, listRoles, ompApprovalFor, parseRole, repoRoot } from '../src/daemon/roles.js';
import { listTemplates, parseTemplate, parseTemplateText, resolveSeats, saveTemplate, templateId } from '../src/daemon/teams.js';
import { roleArgs } from '../src/cli/launch.js';

let home: string; let repo: string;
const write = (path: string, text: string) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ledge-roles-')); process.env.LEDGE_HOME = home;
  repo = mkdtempSync(join(tmpdir(), 'ledge-repo-')); mkdirSync(join(repo, '.git')); mkdirSync(join(repo, 'packages', 'a'), { recursive: true });
});

describe('roles', () => {
  it('reads a front matter and a body; a file without one is all body', () => {
    expect(frontMatter('---\nlabel: Relecteur\ntool: codex # the agent\nmodel: "gpt-5.5"\n---\nTu relis.\n')).toEqual({ fields: { label: 'Relecteur', tool: 'codex', model: 'gpt-5.5' }, body: 'Tu relis.' });
    expect(frontMatter('Tu relis.')).toEqual({ fields: {}, body: 'Tu relis.' });
    expect(() => frontMatter('---\nnot a pair\n---\n')).toThrow(/without a key/);
  });

  it('parses a role, its label defaulting to its id; refuses an unknown key, a bad agent, a bad autonomy', () => {
    expect(parseRole('review', '---\nlabel: Relecteur\ntool: codex\neffort: high\nautonomy: edits\n---\nTu relis.', 'home', '/h/review.md'))
      .toEqual({ id: 'review', label: 'Relecteur', prompt: 'Tu relis.', tool: 'codex', effort: 'high', autonomy: 'edits', source: 'home', path: '/h/review.md' });
    expect(parseRole('build', 'Tu construis.', 'repo', '/r/build.md')).toMatchObject({ id: 'build', label: 'build', prompt: 'Tu construis.' });
    expect(parseRole('x', '---\ncolor: red\n---\n', 'home', '/x')).toBe('unknown key color');
    expect(parseRole('x', '---\ntool: vim\n---\n', 'home', '/x')).toMatch(/^tool:/);
    expect(parseRole('x', '---\nautonomy: yolo\n---\n', 'home', '/x')).toMatch(/^autonomy:/);
    expect(parseRole('x', 'p'.repeat(8001), 'home', '/x')).toBe('prompt over 8000 characters');
  });

  it("lists the repository's roles over the home's, skipping a bad file with its reason", () => {
    write(join(home, 'roles', 'review.md'), '---\nlabel: Relecteur maison\n---\nhome');
    write(join(home, 'roles', 'lead.md'), '---\nlabel: Chef\n---\nlead');
    write(join(home, 'roles', 'bad.md'), '---\ntool: vim\n---\n');
    write(join(repo, '.ledge', 'roles', 'review.md'), '---\nlabel: Relecteur du dépôt\n---\nrepo');
    const { roles, problems } = listRoles(join(repo, 'packages', 'a'));
    expect(roles.map(r => [r.id, r.label, r.source])).toEqual([['lead', 'Chef', 'home'], ['review', 'Relecteur du dépôt', 'repo']]);
    expect(problems).toEqual([{ path: join(home, 'roles', 'bad.md'), reason: expect.stringMatching(/^tool:/) }]);
    expect(findRole('review')?.label).toBe('Relecteur maison');
    expect(repoRoot(join(repo, 'packages', 'a'))).toBe(repo);
  });

  it("a repository role names the home role of the same id it shadows; a role alone shadows nothing", () => {
    write(join(home, 'roles', 'review.md'), 'home');
    write(join(home, 'roles', 'lead.md'), 'lead');
    write(join(repo, '.ledge', 'roles', 'review.md'), 'repo');
    write(join(repo, '.ledge', 'roles', 'build.md'), 'build');
    const roles = new Map(listRoles(repo).roles.map(r => [r.id, r]));
    expect(roles.get('review')).toMatchObject({ source: 'repo', shadows: join(home, 'roles', 'review.md') });
    expect(roles.get('lead')).not.toHaveProperty('shadows');
    expect(roles.get('build')).not.toHaveProperty('shadows');
    expect(listRoles().roles.find(r => r.id === 'review')).not.toHaveProperty('shadows');
  });

  it('maps autonomy to each agent’s own switch, nothing for ask', () => {
    expect(autonomyArgs('claude', 'ask')).toEqual([]);
    expect(autonomyArgs('claude', undefined)).toEqual([]);
    expect(autonomyArgs('claude', 'edits')).toEqual(['--permission-mode', 'acceptEdits']);
    expect(autonomyArgs('claude', 'auto')).toEqual(['--permission-mode', 'auto']);
    expect(autonomyArgs('codex', 'edits')).toEqual(['--ask-for-approval', 'on-request']);
    expect(autonomyArgs('codex', 'auto')).toEqual(['--ask-for-approval', 'never', '--sandbox', 'workspace-write']);
    expect(autonomyArgs('cursor', 'edits')).toEqual([]);
    expect(autonomyArgs('cursor', 'auto')).toEqual(['--force']);
    expect([ompApprovalFor('ask'), ompApprovalFor('edits'), ompApprovalFor('auto'), ompApprovalFor(undefined)]).toEqual(['always-ask', 'always-ask', 'yolo', undefined]);
  });

  it('`ledge claude --role`: the role’s model, effort and autonomy, unless the user gave their own model', () => {
    const role = { id: 'build', label: 'Build', prompt: '', model: 'opus', effort: 'high', autonomy: 'edits' as const, source: 'home' as const, path: '' };
    expect(roleArgs('claude', role, [])).toEqual(['--model', 'opus', '--effort', 'high', '--permission-mode', 'acceptEdits']);
    expect(roleArgs('claude', role, ['--model', 'sonnet'])).toEqual(['--effort', 'high', '--permission-mode', 'acceptEdits']);
    expect(roleArgs('codex', { ...role, tool: 'claude' }, [])).toEqual(['--ask-for-approval', 'on-request']);
  });
});

describe('team templates', () => {
  it('reads flow and block seats, and JSON', () => {
    expect(parseTemplateText('name: workshop\nseats:\n  - { role: lead }\n  - { role: build, tool: claude, model: opus }\n  - role: review\n    tool: codex\n    effort: high\n'))
      .toEqual({ name: 'workshop', seats: [{ role: 'lead' }, { role: 'build', tool: 'claude', model: 'opus' }, { role: 'review', tool: 'codex', effort: 'high' }] });
    expect(parseTemplateText('{"name": "j", "seats": [{"role": "a"}]}')).toEqual({ name: 'j', seats: [{ role: 'a' }] });
    expect(() => parseTemplateText('seats:\n\t- { role: a }')).toThrow(/tabs/);
  });

  it('refuses a role twice, no seat, more than 8 seats; the name defaults to the id', () => {
    expect(parseTemplate('w', 'seats:\n  - { role: a }\n  - { role: a }\n', 'home', '/w')).toMatch(/a role twice/);
    expect(parseTemplate('w', 'name: w\n', 'home', '/w')).toMatch(/^seats/);
    expect(parseTemplate('w', `seats:\n${Array.from({ length: 9 }, (_, i) => `  - { role: r${i} }`).join('\n')}\n`, 'home', '/w')).toMatch(/^seats/);
    expect(parseTemplate('w', 'seats:\n  - { role: a }\n', 'repo', '/w')).toEqual({ id: 'w', name: 'w', seats: [{ role: 'a' }], source: 'repo', path: '/w' });
  });

  it("a seat's agent, model and effort are the seat's, else the role's, else the form's; unknown roles are named", () => {
    const roles = [
      { id: 'lead', label: 'Chef', prompt: '', source: 'home' as const, path: '' },
      { id: 'review', label: 'Relecteur', prompt: '', tool: 'codex' as const, model: 'gpt-5.5', effort: 'high', source: 'home' as const, path: '' }
    ];
    expect(resolveSeats([{ role: 'lead' }, { role: 'review' }, { role: 'review', tool: 'claude' }], roles, { tool: 'claude', model: 'sonnet' }))
      .toEqual([
        { role: roles[0], tool: 'claude', model: 'sonnet' },
        { role: roles[1], tool: 'codex', model: 'gpt-5.5', effort: 'high' },
        { role: roles[1], tool: 'claude', model: 'sonnet' }
      ]);
    expect(resolveSeats([{ role: 'qa' }, { role: 'lead' }, { role: 'ops' }], roles)).toEqual({ unknown: ['qa', 'ops'] });
  });

  it('saves an ad hoc team as a template that reads back the same', () => {
    const path = saveTemplate('Équipe rôles', [{ role: 'lead' }, { role: 'build', tool: 'claude', model: 'claude-opus-4.5' }]);
    expect(path).toBe(join(home, 'teams', 'equipe-roles.yaml'));
    expect(readFileSync(path, 'utf8')).toContain('name: "Équipe rôles"');
    expect(listTemplates().templates).toEqual([{ id: 'equipe-roles', name: 'Équipe rôles', seats: [{ role: 'lead' }, { role: 'build', tool: 'claude', model: 'claude-opus-4.5' }], source: 'home', path }]);
    expect(templateId('  ')).toBe('team');
  });
});
