// The iPad Atelier's sample PC (docs/mockups/ipad-atelier/fixtures.ts, as the phone receives it): two projects, a request
// waiting, a question, a sub-agent, a rig of OMP seats, a session tied to no project.
import type { PhoneProject, PhoneSession, ThreadItem } from '@ledge/protocol';

const T0 = '2026-11-04T10:19:00.000Z';
const s = (id: string, extra: Partial<PhoneSession>): PhoneSession => ({
  id, name: 'Otto', tool: 'claude', project: 'ledge', title: `${id} · ledge`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, unread: false,
  projectId: 'ledge', ...extra
} as PhoneSession);

export const projects: PhoneProject[] = [
  { id: 'ledge', name: 'Ledge', color: 'blue' },
  { id: 'website', name: 'Website', color: 'green' }
];

export const usual: PhoneSession[] = [
  s('otto', { name: 'Otto', state: 'waiting_permission', branch: 'release/LEDGE-42-v0.5.0', topic: 'Préparer la 0.42',
    pending: { key: 'p1', kind: 'permission', text: 'npm test', source: 'hook', risk: 'low', riskReason: 'read_only_command' } }),
  s('nova', { name: 'Nova', state: 'working', branch: 'fix/LEDGE-42-ssh-reconnect', topic: 'Reconnexion SSH', helpers: [{ id: 'n1', kind: 'Explore', task: 'Lire le code SSH', state: 'working' }] as PhoneSession['helpers'] }),
  s('pim', { name: 'Pim', state: 'working', branch: 'feat/bot-motion', topic: 'Mouvement des mascottes' }),
  s('bix', { name: 'Bix', state: 'idle', branch: 'docs/protocol', topic: 'Documenter le protocole' }),
  s('luna', { name: 'Luna', project: 'website', projectId: 'website', state: 'waiting_input', branch: 'feat/WEB-18-homepage', topic: 'Page d’accueil',
    pending: { key: 'q1', kind: 'question', text: 'Garder l’ancien bandeau ?', source: 'hook', risk: 'low', riskReason: 'question' } }),
  s('milo', { name: 'Milo', project: 'website', projectId: 'website', state: 'working', branch: 'fix/WEB-18-mobile-layout', topic: 'Mise en page mobile' }),
  s('rio', { name: 'Rio', project: 'website', projectId: 'website', state: 'idle', branch: 'feat/WEB-18-accessibility', topic: 'Accessibilité' })
];

export const ompSeats: PhoneSession[] = [
  s('ivo', { name: 'Ivo', tool: 'omp', state: 'working', title: 'Ivo', rig: { name: 'dev-omp', role: 'dev.agent' } }),
  s('mia', { name: 'Mia', tool: 'omp', state: 'idle', title: 'Mia', rig: { name: 'dev-omp', role: 'design.maquettiste' } })
];

export const unfiled: PhoneSession[] = [
  s('kit', { name: 'Kit', project: 'proxy-essais', projectId: undefined, state: 'idle', topic: 'Essais du proxy' })
];

const at = (m: number) => `2026-11-04T10:${String(20 + m).padStart(2, '0')}:00.000Z`;
export const threads: Record<string, ThreadItem[]> = {
  otto: [
    { kind: 'prompt', id: 'o1', at: at(0), turn: 1, text: 'Lance les tests avant de préparer la release.' },
    { kind: 'message', id: 'o2', at: at(1), turn: 1, text: 'Je lance la suite complète, puis je mets à jour le changelog.' },
    { kind: 'tool', id: 'o3', at: at(2), turn: 1, tool: 'Bash', label: 'pnpm -r build', status: 'success', durationMs: 41_000, files: [] }
  ],
  nova: [
    { kind: 'prompt', id: 'n1', at: at(0), turn: 1, text: 'La reconnexion SSH boucle quand le Wi-Fi revient.' },
    { kind: 'message', id: 'n2', at: at(1), turn: 1, text: 'Je regarde le délai de reprise du pont SSH ; un sous-agent lit le code du relais.' }
  ],
  luna: [
    { kind: 'prompt', id: 'l1', at: at(0), turn: 1, text: 'Refais le bandeau de la page d’accueil, plus court.' },
    { kind: 'message', id: 'l2', at: at(1), turn: 1, text: 'J’ai deux versions du bandeau : l’ancienne, raccourcie, et une nouvelle avec la capture de l’Atelier.' }
  ]
};
