import { describe, it, expect } from 'vitest';
import { MESSAGES } from '../src/i18n/messages';
import { errorText } from '../src/chat/errors';

const fr = MESSAGES.fr.chat.errors;
const en = MESSAGES.en.chat.errors;

/** Every message the daemon (packages/ledge/src/daemon, chat) and the fleet (packages/fleet/src/fleet.ts) put in a turn error,
 *  a card error or an id-less `error` for the chat, launch and relay paths. */
const KNOWN: [raw: string, french: string][] = [
  ['one question at a time', 'une autre question est en cours, attendez sa réponse'],
  ['one question at a time: wait for the answer', 'une autre question est en cours, attendez sa réponse'],
  ['one routing request at a time', 'une autre question est en cours, attendez sa réponse'],
  ['Devbox is offline', 'Devbox est hors ligne'],
  ['Local is offline', 'Local est hors ligne'],
  ['Update a connected daemon to enable multi-machine chat', 'mettez à jour un daemon connecté pour parler à plusieurs machines'],
  ['Routing timed out', 'le choix de la machine a pris trop de temps'],
  ['Routing failed', 'le choix de la machine a échoué'],
  ['Unknown routing destination', 'le choix de la machine a échoué'],
  ['Unknown clarification choice', 'le choix de la machine a échoué'],
  ['Conflicting routing result', 'le choix de la machine a échoué'],
  ['Claude Code did not answer within 3 minutes', 'Claude Code n’a pas répondu en 3 minutes'],
  ['Codex exited with code 2', 'Codex s’est arrêté (code 2)'],
  ['Cursor Agent reported an error', 'Cursor Agent a signalé une erreur'],
  ['unknown proposal', 'cette proposition n’existe plus'],
  ['already launched', 'cette session est déjà lancée'],
  ['unknown relay', 'cette instruction n’existe plus'],
  ['already sent', 'cette instruction est déjà envoyée'],
  ['already queued', 'cette instruction attend déjà son tour'],
  ['nothing queued', 'aucune instruction en attente'],
  ['Unknown conversation destination', 'la machine de cette question est inconnue'],
  ['Otto stopped before it got the instruction', 'la session Otto s’est arrêtée avant de recevoir l’instruction'],
  ['unknown session', 'la session n’existe plus'],
  ['session started without ledge, read only', 'session démarrée hors de Ledge, en lecture seule'],
  ['a permission prompt takes accept or deny, not a reply', 'la session attend une acceptation ou un refus, pas un texte'],
  ['empty reply', 'l’instruction est vide'],
  ['free-text answers are not supported yet, answer in the terminal', 'les réponses libres ne sont pas encore prises en charge, répondez dans le terminal'],
  ['no prompt visible in the terminal, open the tab', 'aucune invite visible dans le terminal, ouvrez l’onglet'],
  ['the terminal did not take it', 'le terminal ne l’a pas prise en compte'],
  ['invalid message', 'le daemon a refusé la demande'],
  ['no such folder: /w/gone', 'le dossier /w/gone n’existe pas'],
  ['not a folder: /w/file.txt', '/w/file.txt n’est pas un dossier'],
  ['not an absolute path: w/rel', 'w/rel n’est pas un chemin absolu']
];

describe('errorText', () => {
  it.each(KNOWN)('%s is said in French, with no detail', (raw, french) => {
    expect(errorText(raw, fr)).toEqual({ text: french });
  });
  it('every known message has its English wording too, never the raw text for a code', () => {
    expect(errorText('already launched', en)).toEqual({ text: 'this session has already been started' });
    expect(errorText('Devbox is offline', en)).toEqual({ text: 'Devbox is offline' });
    expect(errorText('no such folder: /w/gone', en)).toEqual({ text: 'the folder /w/gone does not exist' });
  });
  it('a failure with the tool’s own words keeps them as the detail', () => {
    expect(errorText('Claude Code could not start: not found in PATH', fr)).toEqual({ text: 'Claude Code n’a pas pu démarrer', detail: 'not found in PATH' });
    expect(errorText('tmux new-session failed: no server running', fr)).toEqual({ text: 'tmux n’a pas pu ouvrir la session', detail: 'tmux new-session failed: no server running' });
  });
  it('the fleet’s machine prefix on an id-less error names the machine', () => {
    expect(errorText('Devbox: already launched', fr)).toEqual({ text: 'Devbox : cette session est déjà lancée' });
    expect(errorText('Devbox: already launched', en)).toEqual({ text: 'Devbox: this session has already been started' });
  });
  it('anything else is a localized generic message, the raw text kept as the detail', () => {
    expect(errorText('folder vanished', fr)).toEqual({ text: 'erreur inattendue', detail: 'folder vanished' });
    expect(errorText('Devbox: folder vanished', en)).toEqual({ text: 'unexpected error', detail: 'Devbox: folder vanished' });
    expect(errorText('API Error: 529 overloaded', fr)).toEqual({ text: 'erreur inattendue', detail: 'API Error: 529 overloaded' });
  });
});
