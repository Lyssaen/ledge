import type { PhoneChatTurn, PhoneSession } from '@ledge/protocol';
const T = new Date(Date.now() - 4 * 60_000).toISOString();
const base = (id: string, name: string, project: string, extra: Partial<PhoneSession> = {}): PhoneSession => ({
  id, name, tool: 'claude', project, title: `${name} · ${project}`, state: 'working', helpers: [], startedAt: T, lastActivityAt: T, unread: false, ...extra
});
export const sessions: PhoneSession[] = [
  base('orch', 'orch-lead', 'Ledge', { state: 'waiting_input', unread: true, topic: 'Mener le rig factory', branch: 'feat/rigs', role: 'lead', roleLabel: 'Lead', team: 'team-fac1',
    pending: { key: 'q1', kind: 'question', text: 'Sessions : passer du fichier JSON à SQLite ?', options: ['SQLite', 'Garder le JSON'], source: 'hook', risk: 'low', riskReason: 'question' } }),
  base('luna', 'Luna', 'Website', { state: 'waiting_input', unread: true, topic: 'Nouvelle page d\'accueil', branch: 'feat/WEB-18',
    pending: { key: 'q2', kind: 'question', text: 'Quel port pour le serveur de preview ?', options: ['5173', '4321'], source: 'hook', risk: 'low', riskReason: 'question' } }),
  base('otto', 'Otto', 'Ledge', { state: 'waiting_permission', unread: true, topic: 'Préparer la release', branch: 'release/LEDGE-0.30',
    pending: { key: 'p1', kind: 'permission', text: 'npm test', source: 'hook', risk: 'low', riskReason: 'read_only_command' } }),
  base('build', 'build', 'Ledge', { topic: 'Reprise après reboot', branch: 'feat/rigs', role: 'build', roleLabel: 'Build', team: 'team-fac1' }),
  base('qa', 'qa', 'Ledge', { topic: 'Vérifier la reprise', branch: 'feat/rigs', role: 'qa', roleLabel: 'QA', team: 'team-fac1' }),
  base('reva', 'review-a', 'Ledge', { tool: 'codex', topic: 'Relire 3f2a1c0', branch: 'feat/rigs', role: 'review', roleLabel: 'Revue', team: 'team-fac1' }),
  base('devb', 'dev-build', 'Ledge', { topic: 'Corriger l\'encoche', branch: 'fix/notch', role: 'build', roleLabel: 'Build', team: 'team-sta1' }),
  base('nova', 'Nova', 'Ledge', { state: 'idle', topic: 'Reconnexion ssh', branch: 'fix/LEDGE-42' }),
  base('milo', 'Milo', 'Website', { topic: 'Mise en page mobile', branch: 'fix/WEB-18-m' })
];
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
export const turns: PhoneChatTurn[] = [
  { qid: '0b3f6c1e-1a2b-4c3d-8e9f-000000000001', question: 'Où en est factory ?', askedAt: at(20), steps: [{ kind: 'sessions' }], answeredAt: at(19),
    answer: 'factory avance sur la reprise après reboot : build a un candidat sur feat/rigs (3f2a1c0), review-a le relit. orch-lead attend ta décision sur le stockage des sessions.' },
  { qid: '0b3f6c1e-1a2b-4c3d-8e9f-000000000002', question: 'Pourquoi review-b a été relancé ?', askedAt: at(3), steps: [{ kind: 'sessions' }], answeredAt: at(2),
    answer: 'Il approchait 82 % de contexte. L\'operator l\'a relevé, la relève a repris sa revue.' }
];
