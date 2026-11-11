import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../src/copy';
import { Changes, lineKind } from '../../src/screens/prs/Changes';
import { Commits, newestFirst } from '../../src/screens/prs/Commits';
import { detail, mr, pr } from '../model/forge-fixtures';

const PATCH = '@@ -84,7 +84,12 @@ export function Term(props: TermProps) {\n   const term = useRef<Terminal>();\n-  term.current.open(el);\n+  term.current.open(el);\n+  term.loadAddon(new WebglAddon());';

const changes = () => detail(pr(), {
  files: [
    { path: 'apps/desktop/src/term/Term.tsx', added: 31, removed: 8, patch: PATCH },
    { path: 'apps/desktop/src/term/copy.ts', added: 15, removed: 4, patch: '@@ -1 +1 @@\n-a\n+b' },
    { path: 'pnpm-lock.yaml', added: 1204, removed: 987 }
  ],
  threads: [{ id: 't1', resolvable: true, resolved: false, file: 'apps/desktop/src/term/Term.tsx', line: 88, comments: [{ id: 'c1', author: 'review-qa', at: '2026-11-11T14:12:00.000Z', body: 'Pourquoi ?' }] }]
});

const row = (path: string) => document.querySelector(`[data-file="${path}"]`) as HTMLElement;

afterEach(() => setLang('fr'));

describe('Modifications (M5 §7)', () => {
  it('heads the files with their count and the request\'s + and − (« 3 fichiers · +1 250 −999 »)', () => {
    render(<Changes detail={changes()} />);
    const head = screen.getByRole('heading');
    expect(head).toHaveTextContent('3 fichiers');
    expect(head.textContent).toMatch(/\+1\s250\s−999/);
  });

  it('shows each file folded, its path, its + / −, and « 1 discussion » on a file with a thread', () => {
    render(<Changes detail={changes()} />);
    const term = row('apps/desktop/src/term/Term.tsx');
    expect(term).toHaveTextContent('apps/desktop/src/term/Term.tsx');
    expect(term).toHaveTextContent('+31');
    expect(term).toHaveTextContent('−8');
    expect(within(term).getByText('1 discussion')).toHaveAttribute('data-att', 'ask');
    expect(row('apps/desktop/src/term/copy.ts').querySelector('[data-att]')).toBeNull();
    expect(document.querySelector('pre')).toBeNull();
  });

  it('a tap unfolds a file\'s diff: hunk header, additions, removals and context each with their look; a second tap folds it', () => {
    render(<Changes detail={changes()} />);
    const toggle = within(row('apps/desktop/src/term/Term.tsx')).getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const lines = [...row('apps/desktop/src/term/Term.tsx').querySelectorAll('pre > span')];
    expect(lines.map(l => l.getAttribute('data-line'))).toEqual(['hunk', 'ctx', 'del', 'add', 'add']);
    expect(lines[0]!.className).toContain('text-info');
    expect(lines[2]!.className).toContain('bg-danger-fg/15');
    expect(lines[3]!.className).toContain('bg-ok/15');
    expect(lines[0]!.className).toContain('whitespace-pre');
    expect(lines[0]!.className).toContain('text-ellipsis');
    fireEvent.click(toggle);
    expect(row('apps/desktop/src/term/Term.tsx').querySelector('pre')).toBeNull();
  });

  it('a file without its patch cannot unfold and says to open it on its forge', () => {
    render(<Changes detail={changes()} />);
    const lock = row('pnpm-lock.yaml');
    expect(within(lock).queryByRole('button')).toBeNull();
    expect(lock).toHaveTextContent('Diff trop lourd pour le téléphone : ouvre-le sur GitHub.');
    expect(lock.textContent).toMatch(/\+1\s204/);
  });

  it('names GitLab for a merge request\'s file without patch', () => {
    render(<Changes detail={detail(mr(), { files: [{ path: 'big.json', added: 1, removed: 0 }] })} />);
    expect(row('big.json')).toHaveTextContent('ouvre-le sur GitLab.');
  });

  it('says « Aucune modification. » without files', () => {
    render(<Changes detail={detail(pr(), { files: [] })} />);
    expect(screen.getByText('Aucune modification.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('keeps a long path\'s end: the path is cut from its start', () => {
    render(<Changes detail={changes()} />);
    const path = within(row('apps/desktop/src/term/Term.tsx')).getByText('apps/desktop/src/term/Term.tsx');
    expect(path).toHaveAttribute('dir', 'ltr');
    expect(path.parentElement!.className).toContain('[direction:rtl]');
  });

  it('reads a diff line\'s kind from its first character', () => {
    expect(['@@ -1 +1 @@', '+a', '-b', ' c', ''].map(lineKind)).toEqual(['hunk', 'add', 'del', 'ctx', 'ctx']);
  });

  it('speaks English', () => {
    setLang('en');
    render(<Changes detail={changes()} />);
    expect(screen.getByRole('heading')).toHaveTextContent('3 files');
    expect(row('pnpm-lock.yaml')).toHaveTextContent('Diff too heavy for the phone: open it on GitHub.');
  });
});

describe('Commits (M5 §7)', () => {
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const commits = () => detail(pr(), {
    commits: [
      { sha: '5b81d07aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', title: 'feat(term): seat capture and copy', author: 'dev-front', at: hoursAgo(72) },
      { sha: 'a3f9c1ebbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', title: 'fix(term): free the WebGL addon on close', author: 'dev-front', at: now.toISOString() }
    ]
  });

  it('lists the commits newest first, whatever order the forge gave', () => {
    render(<Commits detail={commits()} />);
    const rows = [...document.querySelectorAll('[data-commit]')];
    expect(rows.map(r => r.getAttribute('data-commit')!.slice(0, 7))).toEqual(['a3f9c1e', '5b81d07']);
  });

  it('shows the short sha, the title as written, the author and the time (« aujourd\'hui 10:24 »)', () => {
    render(<Commits detail={commits()} />);
    const first = document.querySelector('[data-commit]') as HTMLElement;
    expect(first).toHaveTextContent('a3f9c1e');
    expect(first).not.toHaveTextContent('a3f9c1eb');
    expect(first).toHaveTextContent('fix(term): free the WebGL addon on close');
    expect(within(first).getByText(/^dev-front · aujourd'hui \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('ends with the read-only hint naming the forge', () => {
    render(<Commits detail={commits()} />);
    expect(screen.getByText('Lecture seule. Le détail d\'un commit est sur GitHub (« Ouvrir sur GitHub », en haut à droite).')).toBeInTheDocument();
  });

  it('keeps the forge\'s order for two commits at the same time', () => {
    const at = now.toISOString();
    const c = [{ sha: 'x', title: 'x', author: 'a', at }, { sha: 'y', title: 'y', author: 'a', at }];
    expect(newestFirst(c).map(x => x.sha)).toEqual(['x', 'y']);
  });

  it('speaks English', () => {
    setLang('en');
    render(<Commits detail={commits()} />);
    expect(within(document.querySelector('[data-commit]') as HTMLElement).getByText(/^dev-front · today \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText(/^Read-only\. A commit's detail is on GitHub/)).toBeInTheDocument();
  });
});
