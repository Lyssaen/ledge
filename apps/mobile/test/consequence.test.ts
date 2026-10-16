import { describe, expect, it } from 'vitest';
import type { RiskReason } from '@ledge/protocol';
import { consequenceFor, lowRiskNoticeFor, parsePushTarget } from '../src/model/consequence';
import type { InboxItem } from '../src/model/requests';

const item = (over: Partial<InboxItem>): InboxItem => ({ sessionId: 's', pendingId: 'p', pendingVersion: 1, kind: 'permission', filter: 'permission', task: 't', botName: 'Kai', tool: 'claude', repo: 'r', since: '2026-10-14T10:00:00Z', text: '', risk: 'high', readOnly: false, ...over });

describe('parsePushTarget', () => {
  it('reads a forced push target', () => expect(parsePushTarget('git push --force origin main')).toEqual({ remote: 'origin', branch: 'main', force: true }));
  it('reads a plain push', () => expect(parsePushTarget('git push origin feature/x')).toEqual({ remote: 'origin', branch: 'feature/x', force: false }));
  it('knows -f, force-with-lease and a + refspec rewrite history', () => {
    expect(parsePushTarget('git push -f origin main')?.force).toBe(true);
    expect(parsePushTarget('git push --force-with-lease origin main')?.force).toBe(true);
    expect(parsePushTarget('git push origin +main')).toEqual({ remote: 'origin', branch: 'main', force: true });
  });
  it('deleting or mirroring pushes count as rewriting history, whichever refspec carries it', () => {
    for (const cmd of ['git push origin :main', 'git push origin --delete main', 'git push -d origin main', 'git push --mirror origin', 'git push origin main :old', 'git push origin main +dev', 'git push --prune origin'])
      expect(parsePushTarget(cmd)?.force, cmd).toBe(true);
    expect(parsePushTarget('git push origin :main')).toEqual({ remote: 'origin', branch: 'main', force: true });
    expect(parsePushTarget('git push origin main dev')?.force).toBe(false);
  });
  it('takes the destination of a src:dst refspec and skips flag values', () => {
    expect(parsePushTarget('git push -o ci.skip origin HEAD:release')).toEqual({ remote: 'origin', branch: 'release', force: false });
    expect(parsePushTarget('git push -u origin main')).toEqual({ remote: 'origin', branch: 'main', force: false });
  });
  it('names no remote when the command gives none', () => expect(parsePushTarget('git push --force')).toEqual({ remote: '', force: true }));
  it('is null for anything that is not a git push', () => {
    expect(parsePushTarget('pnpm test')).toBeNull();
    expect(parsePushTarget('git status')).toBeNull();
  });
});

describe('consequenceFor', () => {
  it('is null for a low-risk request', () => expect(consequenceFor(item({ risk: 'low' }))).toBeNull());
  it('a forced push can replace the remote history and names its destination', () => {
    expect(consequenceFor(item({ riskReason: 'pushes', text: 'git push --force origin main' }))).toMatchObject({ title: 'Peut remplacer l’historique distant', destination: 'origin/main' });
  });
  it('a plain push publishes; with no remote it names the configured one', () => {
    expect(consequenceFor(item({ riskReason: 'pushes', text: 'git push origin main' }))).toMatchObject({ title: 'Publie sur un dépôt distant', destination: 'origin/main' });
    expect(consequenceFor(item({ riskReason: 'pushes', text: 'git push' }))).toMatchObject({ destination: 'le dépôt distant configuré' });
  });
  it.each<[RiskReason, string]>([
    ['destroys', 'Supprime des fichiers ou des modifications'], ['deploys', 'Modifie un déploiement ou une infrastructure'], ['publishes', 'Publie un paquet'],
    ['pipes_to_shell', 'Exécute un script téléchargé'], ['network', 'Accède au réseau'], ['writes_outside_folder', 'Écrit hors du dossier de la session'],
    ['sensitive_path', 'Touche un fichier sensible'], ['plan', 'Valide un plan : l’agent passera à l’exécution'],
    ['unsafe_flag', 'Commande que Ledge ne sait pas analyser'], ['shell_syntax', 'Commande que Ledge ne sait pas analyser'], ['unknown', 'Commande que Ledge ne sait pas analyser']
  ])('%s says %s', (riskReason, title) => expect(consequenceFor(item({ riskReason }))?.title).toBe(title));
  it('a script request says it can change files or reach the network', () => {
    const c = consequenceFor(item({ riskReason: 'script', text: 'pnpm test' }));
    expect(c?.title).toBe('Exécute un script du dépôt');
    expect(c?.body).toBe('Il s’exécute avec les permissions de cette session et peut modifier des fichiers ou accéder au réseau.');
  });
  it('a request without a reason is unassessed, a plan without one is a plan', () => {
    expect(consequenceFor(item({}))?.title).toBe('Commande que Ledge ne sait pas analyser');
    expect(consequenceFor(item({ kind: 'plan' }))?.title).toBe('Valide un plan : l’agent passera à l’exécution');
  });
});

describe('lowRiskNoticeFor', () => {
  it('says nothing for a read-only command or a question', () => {
    expect(lowRiskNoticeFor(item({ risk: 'low', riskReason: 'read_only_command', text: 'ls' }))).toBeNull();
    expect(lowRiskNoticeFor(item({ kind: 'question', risk: 'low', riskReason: 'question' }))).toBeNull();
  });
  it('names the edit inside the folder', () => expect(lowRiskNoticeFor(item({ risk: 'low', riskReason: 'edit_inside_folder' }))?.title).toBe('Modification dans le projet'));
  it('is null for a high-risk request: the consequence speaks for it', () => expect(lowRiskNoticeFor(item({ risk: 'high', riskReason: 'script' }))).toBeNull());
});
