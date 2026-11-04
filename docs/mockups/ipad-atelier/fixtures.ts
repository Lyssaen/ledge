// Sample sessions and projects for the iPad Atelier mockup (the shapes of apps/desktop/e2e/daemon.ts).
import type { Projects, Session } from '@ledge/protocol';

const T0 = new Date(Date.now() - 5 * 60_000).toISOString();
export function session(id: string, extra: Partial<Session> = {}): Session {
  return { id, name: 'Otto', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Otto · ledge', tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra } as Session;
}

export const projects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'website', name: 'Website', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/website' }] }
  ],
  rules: []
} as Projects;

/** The usual day: two projects, a request waiting, a question, a rig of OMP seats. */
export const usual: Session[] = [
  session('otto', { name: 'Otto', state: 'waiting_permission', branch: 'release/LEDGE-42-v0.5.0', topic: 'Préparer la 0.42' }),
  session('nova', { name: 'Nova', state: 'working', branch: 'fix/LEDGE-42-ssh-reconnect', topic: 'Reconnexion SSH', helpers: [{ id: 'n1', kind: 'Explore', task: 'Lire le code SSH', state: 'working' }] as Session['helpers'] }),
  session('pim', { name: 'Pim', state: 'working', branch: 'feat/bot-motion', topic: 'Mouvement des mascottes' }),
  session('bix', { name: 'Bix', state: 'idle', branch: 'docs/protocol', topic: 'Documenter le protocole' }),
  session('luna', { name: 'Luna', project: 'website', cwd: '/w/website', state: 'waiting_input', branch: 'feat/WEB-18-homepage', topic: 'Page d’accueil' }),
  session('milo', { name: 'Milo', project: 'website', cwd: '/w/website', state: 'working', branch: 'fix/WEB-18-mobile-layout', topic: 'Mise en page mobile' }),
  session('rio', { name: 'Rio', project: 'website', cwd: '/w/website', state: 'idle', branch: 'feat/WEB-18-accessibility', topic: 'Accessibilité' })
];

/** OMP seats of the dev-omp rig, as Ledge follows them (source rig, tool omp, no backend). */
export const ompSeats: Session[] = [
  session('ivo', { name: 'Ivo', tool: 'omp' as Session['tool'], source: 'rig', cwd: '/w/ledge', project: 'ledge', state: 'working', tmuxSession: 'dev-agent@dev-omp', rig: { seat: 'dev-agent@dev-omp', name: 'dev-omp', role: 'dev.agent' } }),
  session('mia', { name: 'Mia', tool: 'omp' as Session['tool'], source: 'rig', cwd: '/w/ledge', project: 'ledge', state: 'idle', tmuxSession: 'design-maquettiste@dev-omp', rig: { seat: 'design-maquettiste@dev-omp', name: 'dev-omp', role: 'design.maquettiste' } })
];

const COLORS = ['blue', 'green', 'violet', 'amber', 'rose', 'teal'] as const;
const NAMES = ['Ledge', 'Website', 'Speos API', 'Docs', 'Mobile', 'Infra'];
/** Six projects, two or three agents each. */
export const manyProjects: Projects = {
  projects: NAMES.map((name, i) => ({ id: name.toLowerCase().replace(/ /g, '-'), name, color: COLORS[i]!, description: '', repos: [{ machine: 'local', path: `/w/${name.toLowerCase()}` }] })),
  rules: []
} as Projects;
const BOTS = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lea', 'Max', 'Noa', 'Oli'];
const STATES = ['working', 'idle', 'working', 'waiting_permission', 'working', 'idle', 'waiting_input'] as const;
export const many: Session[] = BOTS.map((name, i) => {
  const p = manyProjects.projects[i % 6]!;
  return session(name.toLowerCase(), { name, project: p.id, cwd: `/w/${p.id}`, state: STATES[i % STATES.length]!, topic: `Tâche de ${name}` });
});

/** Nobody at work: every session has ended. */
export const quiet: Session[] = usual.map(s => ({ ...s, state: 'exited' as Session['state'] }));
