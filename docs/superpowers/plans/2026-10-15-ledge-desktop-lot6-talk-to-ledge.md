# Ledge Desktop, lot 6 : parler à Ledge — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Parler à Ledge » (bouton de la tête et bouton de l'espace vide) ouvre, dans le même panneau que les conversations, un fil dédié avec Ledge qui suit la maquette `ledge-chat.js` : portrait `ResidentMascot`, accueil et trois suggestions envoyées telles quelles, question envoyée par `chat.ask` au fleet (qui route par `chat.route` avec son `RoutingContext`), clarification rendue en boutons, étapes, réponse en direct, Annuler (`chat.cancel`), « Nouvelle conversation » (`chat.reset`), cartes de lancement (`session.launch { qid }`) et de relais (`session.relay` / `session.relay.cancel`), liens vers les sessions par id qualifié (désactivés quand la session n'existe plus), brouillon `ledge` et position de lecture `ledge` séparés de ceux des agents, et un chat utilisable sans session et avec une machine distante hors ligne.

**Architecture:** Le fleet (`@ledge/fleet`) fait déjà tout le protocole multi-machine du chat (routage, liaisons `qid` → machine, historique du jour dans `desktop.fleet.history`, échecs « X is offline ») ; Desktop envoie `chat.ask` / `chat.cancel` / `chat.reset` / les actions de carte par `client.send` du fleet et lit `chat` / `chatLive` du store. Ce qui se décide sans DOM est pur et testé seul dans `chat/turns.ts` (tour en cours, liens vers les sessions, réponse découpée en blocs, marque d'une carte). Le hook `useChat` garde la seule règle d'état propre à Desktop : une action de carte à la fois, libérée par l'issue de sa carte, une `error` sans id de sa machine, la perte de sa machine ou du daemon local. Le panneau `ChatPane` réutilise du lot 4 le formulaire de réponse (extrait en `ComposerForm`), la position de lecture du fil (extraite en `useReadingPosition`), l'en-tête `.conversation-top` et les classes `.thread-*`, et porte de l'île les cartes (`LaunchCard`, `RelayCard`) en composants Desktop.

**Tech Stack:** TypeScript, React 19, Vite 6, Tauri 2.6, vitest 3 + Testing Library + jsdom, Playwright 1.49, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-14-ledge-desktop-design.md` (**§9.3 en entier**, §5 fleet et pseudo-machine `ledge`, §6 daemon local injoignable = lecture seule et machines distantes figées, §7 clés `desktop.selected` = id qualifié ou `ledge`, `desktop.drafts` clé `ledge`, `desktop.thread` par id, aucun message d'agent stocké par Desktop, §12 vitest « isolation des brouillons et des fils entre agents et chat » et Playwright « un message au chat avec clarification », §13 lot 6 « routage, chat, cartes, suggestions, liens »). Plans précédents (contrat d'interfaces) : lot 4 `docs/superpowers/plans/2026-10-15-ledge-desktop-lot4-conversations.md`, lot 5 `2026-10-15-ledge-desktop-lot5-new-session.md`. Maquette (lecture seule, hors dépôt) : `../ledge-desktop/mockup/assets/ledge-chat.js`, `app.js` (bouton `[data-open-ledge]`), `ledge-chat.css`, `../ledge-desktop/HANDOFF.md`. Référence de comportement (inchangée) : l'île, `apps/overlay/src/surface/ChatView.tsx`, `LaunchCard.tsx`, `RelayCard.tsx`, `Surface.tsx`, `apps/overlay/e2e/fleet.spec.ts`.

## Global Constraints

- Prérequis : lots 1 à 5 terminés. Branche `desktop/lot6-talk-to-ledge`, empilée sur le lot 5 : `git checkout desktop/lot5-new-session && git checkout -b desktop/lot6-talk-to-ledge`.
- **Fichiers des lots 4 et 5.** Ce plan décrit `App.tsx`, `Heading.tsx`, `EmptyWorkspace.tsx`, `messages.ts`, `app.css` et `e2e/daemon.ts` dans l'état prévu par le plan du lot 5 (`useLaunch`, `LaunchScreen`, `launching`, `canLaunch`, `openLaunch`, `replyFor`, `pick`, `onNewSession`, `data-open-launch`, `launch/form.ts` avec `loadTool()`, `fakeDaemon(..., { machines, launcher, recents })`, `fakeRemote(page, alias, initial, { recents })` avec `received`, `push`, `launched`). Lire le fichier réel avant de le modifier et appliquer le changement à son état réel ; si un nom diffère, garder celui du dépôt.
- Portes de chaque tâche : `pnpm -r typecheck`, `pnpm --filter desktop test`, et à partir de la tâche 6 `pnpm --filter desktop exec playwright test` (port **5299** ; toute erreur console ou `pageerror` fait échouer la spec via `e2e/fixtures.ts`). La tâche 6 touche `packages/fleet/test/mockDaemon.ts` : portes `pnpm --filter @ledge/fleet test` et `pnpm --filter overlay test` en plus.
- **L'île (`apps/overlay`) ne change pas.** On ne déplace pas `ChatView`, `LaunchCard`, `RelayCard` dans `@ledge/ui` (ils dépendent du `Button`, des icônes et des styles en ligne de l'île) : Desktop porte leur logique (états des cartes, `relayPill`, libellés des étapes et des sources, règle des choix) dans ses propres composants, testés. Seul changement partagé : `push(m)` ajouté (additif) au faux daemon de `@ledge/fleet/test/mockDaemon`.
- Protocole (spec §9.3, `packages/protocol/src/messages.ts`) : Desktop envoie **uniquement** par `client.send` du fleet : `chat.ask { qid, text, tool }`, `chat.cancel { qid }`, `chat.reset`, `session.launch { tool, cwd, prompt?, qid }`, `session.relay { qid }`, `session.relay.cancel { qid }`. Desktop ne construit **jamais** `chat.route` ni le `RoutingContext` : le fleet le fait (`inventory()`, `online` = `MachineState.ready`). Le fleet route chaque message porteur d'un `qid` vers la machine du tour (liaison) ; `fleet.sendTo` n'est pas utilisé par le chat.
- `qid` : chaîne de 1 à 100 caractères (`chat.route`), créée par `newQid()` (`q-…`), sans `crypto.randomUUID` (absent de certains environnements jsdom).
- Pseudo-machine (spec §5/§7) : l'id `ledge` (`CHAT_ID`) n'est jamais une session. `desktop.selected === 'ledge'` ⇔ le chat est ouvert ; le réducteur `visible` du lot 3 le garde déjà, `prune.ts` ne le retire jamais. Brouillon : `desktop.drafts['ledge']` ; lecture : `desktop.thread['ledge']`, tous deux par le seul écrivain `useConversations` (lot 4). Desktop ne stocke aucun message de Ledge (le fleet tient l'historique du jour dans `desktop.fleet.history`).
- Lecture seule (spec §6) : daemon local injoignable → historique lisible, compositeur figé (désactivé, brouillon affiché), suggestions, « Nouvelle conversation », choix et cartes désactivés. Une machine distante injoignable est annoncée dans le chat (`role="status"`) ; le fleet la passe `online: false` au routage.
- Le panneau du chat est `aside#conversation-pane.detail.conversation[data-ledge-chat]` : jamais `data-session` (les vues comptent `[data-session]`), jamais `data-conversation` (les tests des lots 4/5 lisent `#conversation-pane[data-conversation]`). **Aucun `role="alert"`** dans le chat : erreurs et notices sont `role="status"` (l'alerte du daemon local reste la seule, `e2e/offline.spec.ts`).
- Ids du compositeur du chat (maquette) : `form#ledge-chat-form`, `textarea#ledge-chat-reply`, `small#ledge-reply-hint`. Ceux du lot 4 (`conversation-form`, `conversation-reply`, `reply-hint`) ne changent pas.
- L'app remplit la fenêtre : le fil défile **dans** `.thread-scroll` ; `document.documentElement.scrollHeight` reste égal à la hauteur de la fenêtre (vérifié par la tâche 7).
- Textes en français et en anglais dans `src/i18n/messages.ts` (`fr` source de vérité, `en: typeof fr`), bloc `chat` ; Desktop vouvoie (« ou reformulez votre demande », « à vous », « attend votre réponse »), là où l'île tutoie.
- Commits : `feat(desktop): …`, `test(desktop): …`, `refactor(desktop): …`, `test(fleet): …`.

## Décisions sur les points ouverts de la spec

1. **Envoi** : Desktop envoie `chat.ask { qid, text, tool }` au client du fleet ; le fleet choisit l'envoi direct (une seule machine) ou `chat.route` (plusieurs) et construit le `RoutingContext`. `tool` = `loadTool()` (`desktop.tool`, lot 5).
2. **Carte de lancement** : `session.launch { tool, cwd, prompt?, qid }` (le schéma exige `tool` et `cwd` ; le daemon se sert de la proposition liée au `qid`), comme l'île (`Surface.tsx`).
3. **Clarification** : les choix sont des boutons sur le **dernier** tour seulement ; un clic envoie « Sur {machine}. » / « On {machine}. » comme une nouvelle question (règle de l'île) ; répondre au clavier marche aussi (le fleet renvoie l'historique au routeur).
4. **Ouvrir / fermer le chat** : `desktop.selected = 'ledge'`. Le bouton « Parler à Ledge » ouvre toujours (pas de bascule) et met le curseur dans `#ledge-chat-reply` (dans le fil si le compositeur est figé). On le quitte en choisissant une session ou un lien. Disponible sans session (espace vide à gauche, chat à droite) et avec des machines hors ligne.
5. **Brouillon** : effacé seulement quand la question figure dans l'historique du fleet (acceptée) ; refusée (« one question at a time »), il reste avec un indice. Pendant une réponse, on peut taper, pas envoyer.
6. **Suggestions** : toujours affichées sous le fil (maquette), trois textes fixes envoyés tels quels, sans toucher au brouillon ; désactivées pendant une réponse ou en lecture seule.
7. **Liens** : par tour répondu, dans l'ordre d'apparition : sessions des étapes portant un id (`pane`, `reply`, `git`), cible du relais, session lancée. Désactivé si la session n'est plus listée ; une session figée (machine hors ligne) reste un lien. Dans la réponse, `**Nom**` devient un lien seulement si une session **de la machine du tour** porte ce nom de façon unique ; un lien markdown `[texte](url)` est rendu comme son seul texte.
8. **Carte lancée** : le lancement ne navigue pas ; la carte dit « Ari a démarré » et le lien « Ouvrir Ari » apparaît dans les liens du tour. Pas de bouton Terminal (il est dans les actions de la conversation, lot 4).
9. **Une action de carte à la fois** : libérée par le changement de la carte de son tour, par une `error` sans id venue de sa machine (affichée sous la carte si elle diffère de l'erreur de la carte), par la perte de sa machine ou du daemon local. Pas de minuterie.
10. **Exclusion avec le lot 5** : « Nouvelle session » (tête, espace vide, tray) est désactivé tant qu'une action de carte attend (sinon le `session.launched` de la carte serait pris pour celui de l'écran de lancement). L'inverse n'arrive pas : l'écran de lancement recouvre le chat. Cas résiduel accepté : une `error` tardive d'un lancement annulé du lot 5 sur la même machine libère une carte en attente (avec sa note).
11. **Annuler** (spec « `chat.cancel` sur Annuler ») : bouton « Annuler » sur le tour en cours (nom accessible « Annuler la question en cours ») ; un tour annulé affiche « Question annulée. » (`role="status"`), sans réponse partielle.
12. **« Nouvelle conversation »** : dans la ligne d'identité, désactivé pendant une réponse, sans tour, pendant une action de carte, ou en lecture seule.
13. **Machine distante hors ligne** : notice `role="status"` en tête du fil (« Devbox : connexion perdue. Ledge s'appuie sur le dernier état connu de ces machines. ») ; le fleet passe la machine `online: false` au routage. Destination d'une carte : libellé de la machine du fleet, suivi de « · déconnectée » quand elle n'est plus prête (carte désactivée).
14. **Sources** : ligne « Sources : … · HH:MM » (heure de la réponse, pas d'horloge relative qui tourne). La mascotte du portrait fait un `pulse` à chaque nouvelle étape (pas d'intervalle).
15. **Pas d'`role="alert"`** dans le chat ; jamais `data-session` ni `data-conversation` dans son panneau.
16. **Réutilisation du lot 4** : le formulaire de réponse (extrait en `ComposerForm`), la position de lecture (extraite en `useReadingPosition`), l'en-tête `.conversation-top` avec « Agrandir », les classes `.thread-*`. Différences : ids propres au chat, indice de la maquette (« Ctrl / ⌘ + Entrée pour envoyer »), envoi conditionné par `canAsk` (pas de `replyBlock`), compositeur figé seulement quand le daemon local est injoignable, blocs = tours de Ledge (pas des `ThreadItem`), réponse découpée en paragraphes / listes / titres (une conversation d'agent reste en texte brut).
17. **Cartes** : portées de l'île en composants Desktop (classes CSS au lieu de styles en ligne, `Avatar` de Desktop, `role="status"` au lieu d'`alert`, vouvoiement) ; l'île n'est pas modifiée.
18. **Indice de clarification** sous les choix : « Vous pouvez aussi répondre par écrit. » / « You can also answer in writing. ».

## Review Focus

1. **Double clic** sur « Lancer la session », « Envoyer » (relais), une suggestion, un choix ou Ctrl+Entrée répété : un seul `session.launch` / `session.relay` / `chat.ask` part (la règle lit le store et une référence, pas l'état React). Tests ajoutés aux tâches 3 et 5.
2. Un **message qui n'est pas l'issue de la carte** — `chat.history` d'un autre tour (même marque), `error` sans id d'**une autre machine**, `error` **avec** id (réponse d'un agent, lot 4) — ne libère pas la carte ; la vraie issue (proposition `launchedId` / `error`, relais `status` / `error`) la libère. Tests ajoutés à la tâche 3.
3. **Machine perdue** pendant une action de carte ou pendant que Ledge répond : la carte est libérée et désactivée avec « · déconnectée », le tour montre l'erreur du fleet en `status`, rien ne reste « Lancement… » pour toujours. Tests ajoutés aux tâches 3 et 5.
4. **Session liée disparue**, conversation réinitialisée, ou **même nom sur une autre machine** : lien désactivé, nom en simple gras dans la réponse, jamais de lien vers la mauvaise session. Tests ajoutés aux tâches 2 et 5.
5. **Daemon local injoignable chat ouvert** (au démarrage ou en cours) : historique lisible, compositeur figé avec le brouillon gardé, suggestions / reset / choix / cartes désactivés, aucune nouvelle `role="alert"`. Tests ajoutés aux tâches 5, 6 et 7.

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `apps/desktop/src/conversation/ComposerForm.tsx` | Formulaire de réponse partagé (Ctrl/⌘+Entrée, IME, figé) extrait de `Composer` |
| `apps/desktop/src/conversation/useReadingPosition.ts` | Position de lecture d'un fil (`desktop.thread`) extraite de `Thread` |
| `apps/desktop/src/conversation/Composer.tsx` (modifier) | Utilise `ComposerForm` |
| `apps/desktop/src/conversation/Thread.tsx` (modifier) | Utilise `useReadingPosition` |
| `apps/desktop/src/chat/turns.ts` | Pur : `CHAT_ID`, `newQid`, tour en cours, liens, réponse en blocs, marque de carte |
| `apps/desktop/src/chat/useChat.ts` | Hook : question, annulation, reset, action de carte unique, libération |
| `apps/desktop/src/chat/LaunchCard.tsx`, `RelayCard.tsx` | Cartes portées de l'île |
| `apps/desktop/src/chat/ChatTurn.tsx` | Un tour : question, étapes, réponse, choix, destination, carte, liens, sources, Annuler |
| `apps/desktop/src/chat/ChatPane.tsx` | Le panneau : en-tête, notices, fil, accueil, suggestions, compositeur |
| `apps/desktop/src/chat/ChatTrigger.tsx` | Bouton « Parler à Ledge » |
| `apps/desktop/src/shell/Heading.tsx`, `EmptyWorkspace.tsx` (modifier) | Bouton « Parler à Ledge » |
| `apps/desktop/src/App.tsx` (modifier) | Shell : `useChat`, panneau du chat, ouverture, liens, exclusion avec le lot 5 |
| `apps/desktop/src/i18n/messages.ts` (modifier) | Bloc `chat`, fr/en |
| `apps/desktop/src/styles/app.css` (modifier) | Port de `ledge-chat.css`, cartes |
| `packages/fleet/test/mockDaemon.ts` (modifier) | `push(m)` |
| `apps/desktop/e2e/daemon.ts` (modifier) | `daemon` (avec `routing`) dans le snapshot local, `ROUTING` |
| `apps/desktop/test/composer-form.test.tsx`, `chat-turns.test.ts`, `chat-helpers.ts`, `use-chat.test.tsx`, `chat-cards.test.tsx`, `chat-pane.test.tsx`, `app-chat.test.tsx` | vitest |
| `apps/desktop/test/team-view.test.tsx` (modifier) | Bouton de la tête |
| `apps/desktop/e2e/chat.spec.ts` | Playwright : clarification, sans session avec Devbox hors ligne, brouillons et daemon local perdu |

---

### Task 1: Formulaire de réponse et position de lecture partagés (refactor)

Le chat réutilise le compositeur et le fil du lot 4 (spec §9.3 : « même panneau que les conversations »). On extrait, sans changer aucun comportement, le formulaire de `Composer` en `ComposerForm` (ids, libellés, indice et règle d'envoi passés en props) et la position de lecture de `Thread` en `useReadingPosition` (code déplacé tel quel). Les tests existants `composer.test.tsx` et `thread.test.tsx` doivent passer sans modification : c'est la preuve que rien n'a bougé.

**Files:**
- Create: `apps/desktop/src/conversation/ComposerForm.tsx`
- Create: `apps/desktop/src/conversation/useReadingPosition.ts`
- Modify: `apps/desktop/src/conversation/Composer.tsx`
- Modify: `apps/desktop/src/conversation/Thread.tsx`
- Test: `apps/desktop/test/composer-form.test.tsx`

**Interfaces:**
- Consumes: `DRAFT_MAX` (`src/state/drafts.ts`), `Conversations` (`src/conversation/useConversations.ts`, méthodes `pref(id): ThreadPref` et `setPref(id, patch)`).
- Produces:
  - `ComposerForm(p: ComposerFormProps)` avec `interface ComposerFormProps { ids: { form: string; field: string; hint: string }; label: string; placeholder: string; send: string; hint: ReactNode; value: string; frozen: boolean; canSend: boolean; onChange: (text: string) => void; onSend: () => void }` ;
  - `useReadingPosition(id: string, api: Pick<Conversations, 'pref' | 'setPref'>, loaded: boolean, tail: string): { ref: RefObject<HTMLElement | null>; onScroll: () => void }`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/composer-form.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ComposerForm } from '../src/conversation/ComposerForm';

const ids = { form: 'f-form', field: 'f-field', hint: 'f-hint' };
function Harness({ canSend = true, frozen = false, initial = '', onSend }: { canSend?: boolean; frozen?: boolean; initial?: string; onSend: () => void }) {
  const [value, setValue] = useState(initial);
  return <ComposerForm ids={ids} label="Talk" placeholder="Ask…" send="Go" hint="Ctrl + Enter" value={value}
    frozen={frozen} canSend={canSend} onChange={setValue} onSend={onSend} />;
}
const box = () => screen.getByRole('textbox', { name: 'Talk' }) as HTMLTextAreaElement;

describe('ComposerForm', () => {
  it('uses the ids it is given and ties the hint to the field', () => {
    render(<Harness onSend={vi.fn()} />);
    expect(document.getElementById('f-form')?.tagName).toBe('FORM');
    expect(box().id).toBe('f-field');
    expect(box()).toHaveAttribute('aria-describedby', 'f-hint');
    expect(box()).toHaveAttribute('maxlength', '10000');
    expect(box()).toHaveAttribute('placeholder', 'Ask…');
    expect(document.getElementById('f-hint')).toHaveTextContent('Ctrl + Enter');
    expect(document.getElementById('f-hint')).toHaveAttribute('aria-live', 'polite');
  });
  it('sends once on Ctrl or ⌘ + Enter, never on Enter alone or during an IME composition', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    fireEvent.change(box(), { target: { value: 'Hello' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onSend).toHaveBeenCalledTimes(3);
  });
  it('never sends a blank message', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initial={'  \n '} />);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    fireEvent.submit(document.getElementById('f-form')!);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('canSend false keeps typing possible but blocks the button, the shortcut and the submit', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} canSend={false} initial="Ready" />);
    expect(box()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    fireEvent.submit(document.getElementById('f-form')!);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('frozen disables the field and keeps the draft on screen', () => {
    render(<Harness onSend={vi.fn()} frozen canSend={false} initial="Kept draft" />);
    expect(box()).toBeDisabled();
    expect(box()).toHaveValue('Kept draft');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test composer-form`
Expected: FAIL — `Cannot find module '../src/conversation/ComposerForm'`.

- [ ] **Step 3: Implement**

`apps/desktop/src/conversation/ComposerForm.tsx` (le balisage est celui de `Composer`, ids et règle d'envoi venus des props) :

```tsx
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { DRAFT_MAX } from '../state/drafts';

export interface ComposerFormProps {
  ids: { form: string; field: string; hint: string };
  label: string; placeholder: string; send: string; hint: ReactNode;
  value: string;
  /** Disabled field, draft shown (spec §6 read-only). */
  frozen: boolean;
  /** False: typing stays possible, sending does not (a request waits, Ledge is answering). */
  canSend: boolean;
  onChange: (text: string) => void;
  onSend: () => void;
}

/** The reply form shared by a session's conversation and the chat with Ledge (spec §9.1, §9.3; mockup conversation.js l. 58 and
 *  94-95, ledge-chat.js): Ctrl/⌘ + Enter sends, Enter goes to a new line, an IME composition never sends, blank never sends. */
export function ComposerForm(p: ComposerFormProps) {
  const go = () => { if (p.canSend && p.value.trim()) p.onSend(); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); go(); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    go();
  };
  return (
    <form className="conversation-composer" id={p.ids.form} onSubmit={onSubmit}>
      <label htmlFor={p.ids.field}>{p.label}</label>
      <textarea id={p.ids.field} name="reply" rows={3} maxLength={DRAFT_MAX} placeholder={p.placeholder} aria-describedby={p.ids.hint}
        value={p.value} disabled={p.frozen} onChange={e => p.onChange(e.target.value)} onKeyDown={onKeyDown} />
      <div className="composer-bottom">
        <small id={p.ids.hint} aria-live="polite">{p.hint}</small>
        <button type="submit" className="primary" disabled={!p.canSend || !p.value.trim()}>{p.send}</button>
      </div>
    </form>
  );
}
```

`apps/desktop/src/conversation/Composer.tsx` devient (le commentaire de tête et le calcul de `hint` / `frozen` ne changent pas) :

```tsx
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { ComposerForm } from './ComposerForm';
import { replyBlock } from './sends';
import type { Conversations } from './useConversations';

const IDS = { form: 'conversation-form', field: 'conversation-reply', hint: 'reply-hint' };

/** (commentaire de tête existant, inchangé) */
export function Composer({ session: s, api }: { session: Session; api: Conversations }) {
  const { t } = useI18n();
  const c = t.conversation.composer;
  const draft = api.draft(s.id);
  const block = replyBlock(s);
  const sent = api.sends.sent[s.id];
  const failed = api.sends.failed[s.id];
  const hint = block ? c.blocked[block] : failed?.kind === 'reply' ? c.failed(failed.message) : sent?.kind === 'reply' ? c.sent : c.hint;
  const frozen = block === 'offline' || block === 'readonly';
  return <ComposerForm ids={IDS} label={c.label(s.name)} placeholder={c.placeholder} send={c.send} hint={hint} value={draft}
    frozen={frozen} canSend={!block} onChange={text => api.setDraft(s.id, text)} onSend={() => api.reply(s, draft)} />;
}
```

`apps/desktop/src/conversation/useReadingPosition.ts` (logique déplacée de `Thread.tsx` sans modification, constantes comprises) :

```ts
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Conversations } from './useConversations';

const SAVE_MS = 250;
const END_SLACK = 24;

/** A thread's reading position in `desktop.thread[id]` (spec §7), for a session (lot 4) or the chat (`ledge`): it comes back once
 *  the thread is loaded, is saved 250 ms after scrolling stops and on leaving; at the end of the thread, a new `tail` stays in view.
 *  `scroll: null` means "at the end". The caller mounts one per id (`key`). */
export function useReadingPosition(id: string, api: Pick<Conversations, 'pref' | 'setPref'>, loaded: boolean, tail: string): { ref: RefObject<HTMLElement | null>; onScroll: () => void } {
  const ref = useRef<HTMLElement>(null);
  const restored = useRef(false);
  const atEnd = useRef(true);
  const pending = useRef<number | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(api);
  latest.current = api;

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current === undefined) return;
    latest.current.setPref(id, { scroll: pending.current });
    pending.current = undefined;
  };
  // Leaving the thread (it remounts per id) saves where the reader was.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || restored.current) return;
    if (!loaded) { atEnd.current = true; el.scrollTop = el.scrollHeight; return; }
    const at = latest.current.pref(id).scroll;
    el.scrollTop = at ?? el.scrollHeight;
    atEnd.current = at === null;
    restored.current = true;
  }, [loaded, id]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (restored.current || !loaded) && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [tail]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = ref.current;
    // Never record a position while a partial fallback is shown (the collapsed content would clamp it).
    if (!el || !restored.current || !loaded) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < END_SLACK;
    pending.current = atEnd.current ? null : Math.round(el.scrollTop);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_MS);
  };
  return { ref, onScroll };
}
```

Dans `apps/desktop/src/conversation/Thread.tsx` : supprimer `SAVE_MS`, `END_SLACK`, les refs `scroller` / `restored` / `atEnd` / `pending` / `timer` / `latest`, `flush`, les deux `useLayoutEffect`, l'effet de démontage et `onScroll` ; les remplacer, juste après `const loaded = items !== undefined;`, par :

```tsx
  const tail = `${blocks.length}|${items?.at(-1)?.id ?? ''}|${session.pending?.text ?? ''}|${session.lastReply?.at ?? ''}`;
  const { ref: scroller, onScroll } = useReadingPosition(session.id, api, loaded, tail);
```

et mettre à jour les imports (`import { useMemo, type SyntheticEvent } from 'react';`, `import { useReadingPosition } from './useReadingPosition';`). Le `<section ref={scroller} … onScroll={onScroll}>` et `onToggle` ne changent pas. Si TypeScript refuse `ref={scroller}` (`RefObject<HTMLElement | null>` sur un `<section>`), typer le retour du hook `RefObject<HTMLElement>` comme l'ancien `useRef<HTMLElement>(null)` de `Thread`.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test composer-form composer thread && pnpm -r typecheck`
Expected: PASS — les suites `composer` et `thread` du lot 4 passent **sans modification**.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/conversation/ComposerForm.tsx apps/desktop/src/conversation/useReadingPosition.ts apps/desktop/src/conversation/Composer.tsx apps/desktop/src/conversation/Thread.tsx apps/desktop/test/composer-form.test.tsx
git commit -m "refactor(desktop): share the composer form and the reading position"
```

---

### Task 2: Règles pures du chat (`chat/turns.ts`)

Tout ce qui se décide sans DOM : l'id de la pseudo-machine, la création d'un `qid`, le tour en cours, les liens vers les sessions d'un tour, la réponse découpée en blocs avec ses noms de session cliquables, le type et la marque d'une carte (pour savoir si son issue est arrivée). Les ids des étapes, du relais et de la session lancée sont déjà **qualifiés** par le fleet (`machine:id`).

**Files:**
- Create: `apps/desktop/src/chat/turns.ts`
- Test: `apps/desktop/test/chat-turns.test.ts`

**Interfaces:**
- Consumes: `ChatTurn`, `Session` de `@ledge/protocol` ; `splitId(id)` de `@ledge/fleet`.
- Produces :
  - `CHAT_ID = 'ledge'` ; `newQid(): string` ;
  - `isRunning(t: ChatTurn): boolean` ; `runningTurn(turns: readonly ChatTurn[]): ChatTurn | null` ;
  - `interface SessionLink { id: string; name: string; live: boolean }` ; `turnLinks(turn: ChatTurn, sessions: readonly Session[]): SessionLink[]` ;
  - `mentionable(turn: ChatTurn, sessions: readonly Session[]): Map<string, string>` (nom → id) ;
  - `type Inline = { kind: 'text'; text: string } | { kind: 'strong'; text: string } | { kind: 'code'; text: string } | { kind: 'session'; id: string; name: string }` ; `inline(text: string, names: ReadonlyMap<string, string>): Inline[]` ;
  - `type AnswerBlock = { kind: 'p'; lines: Inline[][] } | { kind: 'ul'; items: Inline[][] } | { kind: 'h'; text: Inline[] }` ; `answerBlocks(text: string, names: ReadonlyMap<string, string>): AnswerBlock[]` ;
  - `cardKind(turn: ChatTurn): 'launch' | 'relay' | null` ; `cardMark(turn: ChatTurn): string`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/chat-turns.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import type { ChatTurn } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { answerBlocks, cardKind, cardMark, CHAT_ID, inline, mentionable, newQid, runningTurn, turnLinks } from '../src/chat/turns';

const T = '2026-10-15T09:00:00.000Z';
const turn = (qid: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({ qid, question: 'Q', askedAt: T, steps: [], machineId: 'local', machineName: 'Local', ...extra });
const otto = fakeSession('local:otto', { name: 'Otto', machineId: 'local' });
const nova = fakeSession('local:nova', { name: 'Nova', machineId: 'local' });
const remoteOtto = fakeSession('devbox:otto', { name: 'Otto', machineId: 'devbox' });

describe('ids', () => {
  it('the chat is the `ledge` pseudo-machine and every qid is new and short enough for chat.route', () => {
    expect(CHAT_ID).toBe('ledge');
    const ids = new Set(Array.from({ length: 200 }, newQid));
    expect(ids.size).toBe(200);
    for (const id of ids) { expect(id).toMatch(/^q-/); expect(id.length).toBeLessThanOrEqual(100); }
  });
});

describe('runningTurn', () => {
  it('is the turn with neither an answer nor an error', () => {
    expect(runningTurn([turn('a', { answeredAt: T, answer: 'ok' }), turn('b', { error: 'cancelled' })])).toBeNull();
    expect(runningTurn([turn('a', { answeredAt: T }), turn('b')])?.qid).toBe('b');
  });
});

describe('turnLinks', () => {
  it('lists the sessions the answer read, its relay target and the launched one, once each, in order', () => {
    const t = turn('a', {
      answeredAt: T, answer: 'ok',
      steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'local:otto', name: 'Otto' }, { kind: 'git', id: 'local:otto', name: 'Otto' }, { kind: 'reply', id: 'local:nova', name: 'Nova' }, { kind: 'repo', path: 'README.md' }],
      proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'claude', launchedId: 'local:ari' }
    });
    expect(turnLinks(t, [otto, nova])).toEqual([
      { id: 'local:otto', name: 'Otto', live: true },
      { id: 'local:nova', name: 'Nova', live: true },
      { id: 'local:ari', name: 'ari', live: false }
    ]);
  });
  it('a session that left the list stays named but is not live (Review Focus 4)', () => {
    const t = turn('a', { answeredAt: T, relay: { id: 'local:pim', name: 'Pim', tool: 'claude', text: 'Run the tests' } });
    expect(turnLinks(t, [otto])).toEqual([{ id: 'local:pim', name: 'Pim', live: false }]);
  });
  it('the listed name wins over the step name', () => {
    const t = turn('a', { answeredAt: T, steps: [{ kind: 'pane', id: 'local:otto', name: 'Old name' }] });
    expect(turnLinks(t, [otto])[0]!.name).toBe('Otto');
  });
  it('nothing while the turn runs or after an error', () => {
    const steps = [{ kind: 'pane' as const, id: 'local:otto', name: 'Otto' }];
    expect(turnLinks(turn('a', { steps }), [otto])).toEqual([]);
    expect(turnLinks(turn('a', { steps, error: 'Local is offline' }), [otto])).toEqual([]);
  });
});

describe('mentionable', () => {
  it('only the names of the turn machine, only when unique there (Review Focus 4)', () => {
    const twin = fakeSession('local:otto2', { name: 'Otto', machineId: 'local' });
    expect([...mentionable(turn('a'), [otto, nova, remoteOtto])]).toEqual([['Otto', 'local:otto'], ['Nova', 'local:nova']]);
    expect([...mentionable(turn('a', { machineId: 'devbox' }), [otto, nova, remoteOtto])]).toEqual([['Otto', 'devbox:otto']]);
    expect(mentionable(turn('a'), [otto, twin, nova]).has('Otto')).toBe(false);
    expect(mentionable(turn('a', { machineId: undefined }), [otto]).size).toBe(0);
  });
});

describe('inline', () => {
  const names = new Map([['Otto', 'local:otto']]);
  it('bold, code, a known session and a markdown link rendered as its text', () => {
    expect(inline('Ask **Otto** and **Pim** to run `pnpm test`, see [the doc](https://x.y/z).', names)).toEqual([
      { kind: 'text', text: 'Ask ' }, { kind: 'session', id: 'local:otto', name: 'Otto' }, { kind: 'text', text: ' and ' },
      { kind: 'strong', text: 'Pim' }, { kind: 'text', text: ' to run ' }, { kind: 'code', text: 'pnpm test' },
      { kind: 'text', text: ', see the doc.' }
    ]);
  });
  it('plain text stays one piece', () => {
    expect(inline('Nothing special', names)).toEqual([{ kind: 'text', text: 'Nothing special' }]);
  });
});

describe('answerBlocks', () => {
  it('paragraphs, lists and headings', () => {
    const blocks = answerBlocks('## Status\nTwo agents:\nall good\n\n- **Otto** waits\n* Nova works\nAfter the list', new Map([['Otto', 'local:otto']]));
    expect(blocks.map(b => b.kind)).toEqual(['h', 'p', 'ul', 'p']);
    expect(blocks[1]).toEqual({ kind: 'p', lines: [[{ kind: 'text', text: 'Two agents:' }], [{ kind: 'text', text: 'all good' }]] });
    expect(blocks[2]).toEqual({ kind: 'ul', items: [[{ kind: 'session', id: 'local:otto', name: 'Otto' }, { kind: 'text', text: ' waits' }], [{ kind: 'text', text: 'Nova works' }]] });
  });
  it('empty text gives no block', () => {
    expect(answerBlocks('\n\n', new Map())).toEqual([]);
  });
});

describe('cards', () => {
  const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const };
  const relay = { id: 'local:otto', name: 'Otto', tool: 'claude' as const, text: 'Run the tests' };
  it('a card shows on an answered turn only, the relay first', () => {
    expect(cardKind(turn('a', { proposal }))).toBeNull();
    expect(cardKind(turn('a', { answeredAt: T, proposal }))).toBe('launch');
    expect(cardKind(turn('a', { answeredAt: T, relay, proposal }))).toBe('relay');
    expect(cardKind(turn('a', { answeredAt: T }))).toBeNull();
  });
  it('the mark changes with the card outcome, not with the steps or the answer', () => {
    const before = turn('a', { answeredAt: T, proposal });
    expect(cardMark({ ...before, steps: [{ kind: 'sessions' }], answer: 'x' })).toBe(cardMark(before));
    expect(cardMark({ ...before, proposal: { ...proposal, launchedId: 'local:ari' } })).not.toBe(cardMark(before));
    expect(cardMark({ ...before, proposal: { ...proposal, error: 'no such folder' } })).not.toBe(cardMark(before));
    expect(cardMark({ ...before, relay: { ...relay, status: 'queued' } })).not.toBe(cardMark(before));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test chat-turns`
Expected: FAIL — `Cannot find module '../src/chat/turns'`.

- [ ] **Step 3: Implement**

`apps/desktop/src/chat/turns.ts` :

```ts
import type { ChatTurn, Session } from '@ledge/protocol';
import { splitId } from '@ledge/fleet';

/** The pseudo-machine of the chat (spec §5, §7): `desktop.selected`, `desktop.drafts` and `desktop.thread` key. Never a session id. */
export const CHAT_ID = 'ledge';

let seq = 0;
/** A question id (1 to 100 characters, `chat.route`). No crypto.randomUUID: some jsdom builds lack it. */
export function newQid(): string {
  return `q-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const isRunning = (t: ChatTurn): boolean => t.answeredAt === undefined && t.error === undefined;
/** The fleet answers one question at a time: at most one turn runs. */
export const runningTurn = (turns: readonly ChatTurn[]): ChatTurn | null => turns.find(isRunning) ?? null;

export interface SessionLink { id: string; name: string; live: boolean }

/** The sessions an answered turn points at (spec §9.3 « liens vers les sessions par id qualifié »): the ones its steps read, its relay
 *  target, the session its card launched; first appearance wins. `live` is false once the session left the fleet's list (the link is
 *  then shown disabled); a stale session of a fallen machine is still listed, so still live. */
export function turnLinks(turn: ChatTurn, sessions: readonly Session[]): SessionLink[] {
  if (turn.answeredAt === undefined) return [];
  const found: { id: string; name?: string }[] = [];
  for (const s of turn.steps) if ((s.kind === 'pane' || s.kind === 'reply' || s.kind === 'git') && s.id) found.push({ id: s.id, name: s.name });
  if (turn.relay) found.push({ id: turn.relay.id, name: turn.relay.name });
  if (turn.proposal?.launchedId) found.push({ id: turn.proposal.launchedId });
  const seen = new Set<string>();
  const out: SessionLink[] = [];
  for (const f of found) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const listed = sessions.find(s => s.id === f.id);
    out.push({ id: f.id, name: listed?.name ?? f.name ?? splitId(f.id)?.id ?? f.id, live: !!listed });
  }
  return out;
}

/** Names `**Name**` may link in an answer: sessions of the turn's machine whose name is unique there. A name shared by two sessions,
 *  or only found on another machine, stays plain bold: never a link to the wrong session. */
export function mentionable(turn: ChatTurn, sessions: readonly Session[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!turn.machineId) return out;
  const twice = new Set<string>();
  for (const s of sessions) {
    if (s.machineId !== turn.machineId) continue;
    if (out.has(s.name)) twice.add(s.name); else out.set(s.name, s.id);
  }
  for (const n of twice) out.delete(n);
  return out;
}

export type Inline = { kind: 'text'; text: string } | { kind: 'strong'; text: string } | { kind: 'code'; text: string } | { kind: 'session'; id: string; name: string };
const MARKS = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\([^)\s]*\)/g;

/** Inline marks of an answer: bold (a session link when `names` knows it), code, and markdown links kept as their text only
 *  (Desktop opens no URL from Ledge's answer). */
export function inline(text: string, names: ReadonlyMap<string, string>): Inline[] {
  const out: Inline[] = [];
  const push = (i: Inline) => {
    const last = out.at(-1);
    if (i.kind === 'text' && last?.kind === 'text') last.text += i.text; else out.push(i);
  };
  let at = 0;
  for (const m of text.matchAll(MARKS)) {
    if (m.index > at) push({ kind: 'text', text: text.slice(at, m.index) });
    if (m[1] !== undefined) {
      const id = names.get(m[1]);
      push(id ? { kind: 'session', id, name: m[1] } : { kind: 'strong', text: m[1] });
    } else if (m[2] !== undefined) push({ kind: 'code', text: m[2] });
    else push({ kind: 'text', text: m[3]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) push({ kind: 'text', text: text.slice(at) });
  return out;
}

export type AnswerBlock = { kind: 'p'; lines: Inline[][] } | { kind: 'ul'; items: Inline[][] } | { kind: 'h'; text: Inline[] };

/** Simple Markdown, as the island renders it: paragraphs (one line per `<br>`), `-` / `*` lists, `#` to `###` headings. */
export function answerBlocks(text: string, names: ReadonlyMap<string, string>): AnswerBlock[] {
  const out: AnswerBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const endPara = () => { if (para.length) out.push({ kind: 'p', lines: para.map(l => inline(l, names)) }); para = []; };
  const endList = () => { if (list.length) out.push({ kind: 'ul', items: list.map(l => inline(l, names)) }); list = []; };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { endPara(); endList(); continue; }
    const head = /^#{1,3} (.*)$/.exec(line);
    if (head) { endPara(); endList(); out.push({ kind: 'h', text: inline(head[1]!, names) }); continue; }
    const item = /^\s*[-*] (.*)$/.exec(line);
    if (item) { endPara(); list.push(item[1]!); continue; }
    endList();
    para.push(line);
  }
  endPara(); endList();
  return out;
}

/** The card an answered turn carries (the relay first, like the island). */
export function cardKind(turn: ChatTurn): 'launch' | 'relay' | null {
  if (turn.answeredAt === undefined) return null;
  return turn.relay ? 'relay' : turn.proposal ? 'launch' : null;
}

/** What changes when a card action has an outcome (`launchedId`, `error`, relay `status`): compared before and after the click. */
export const cardMark = (turn: ChatTurn): string => JSON.stringify([turn.proposal ?? null, turn.relay ?? null]);
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test chat-turns && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat/turns.ts apps/desktop/test/chat-turns.test.ts
git commit -m "feat(desktop): chat turn rules: links, answer blocks, card marks"
```

---

### Task 3: Hook `useChat` : question, annulation, reset, une action de carte à la fois

Le hook lit `chat` / `chatLive` du store (`useDaemon`) et envoie par le client du fleet. Les gardes lisent `daemonStore.getState()` et une référence, jamais seulement l'état React : deux appels dans le même événement (double clic, Ctrl+Entrée répété) n'envoient qu'un message (Review Focus 1). Une action de carte attend son issue ; elle est libérée par le changement de la carte de son tour (`cardMark`), par une `error` **sans id** venue de **sa** machine (`fleet.onMachineMessage`, avant le traitement du fleet), par la perte de sa machine (`ready` faux) ou du daemon local (Review Focus 2 et 3). Pourquoi l'`error` sans id : le daemon répond à un lancement de carte raté par l'historique (proposition avec `error`) **puis** par une `error` sans id ; quand l'historique ne change pas (même erreur au second essai), seule l'`error` arrive (`packages/ledge/src/chat/service.ts`, et l'île libère de la même façon, `apps/overlay/src/surface/Surface.tsx`).

**Files:**
- Create: `apps/desktop/src/chat/useChat.ts`
- Create: `apps/desktop/test/chat-helpers.ts`
- Test: `apps/desktop/test/use-chat.test.tsx`

**Interfaces:**
- Consumes: `CHAT_ID`, `newQid`, `runningTurn`, `cardMark` (tâche 2) ; `loadTool(): Tool` de `src/launch/form.ts` (lot 5, clé `desktop.tool`) ; `daemonStore`, `useDaemon`, `DaemonClient`, `Fleet`, `MachineState` de `@ledge/fleet`.
- Produces :
  - `type ChatFleet = Pick<Fleet, 'turnMachine' | 'onMachineMessage'>` ;
  - `type CardAction = 'launch' | 'relay' | 'relay.cancel'` ; `interface ChatInFlight { qid: string; kind: CardAction; machine: string; mark: string }` ; `interface ChatNote { qid: string; message: string }` ;
  - `interface ChatApi { turns: ChatTurn[]; live: { qid: string; text: string } | null; running: ChatTurn | null; canAsk: boolean; card: ChatInFlight | null; note: ChatNote | null; ask(text: string): boolean; cancel(): void; reset(): void; launch(qid: string): void; relay(qid: string): void; relayCancel(qid: string): void; available(qid: string): boolean }` ;
  - `useChat(client: DaemonClient, fleet: ChatFleet, machines: readonly MachineState[], localDown: boolean): ChatApi` ;
  - aides de test (`test/chat-helpers.ts`) : `T`, `turn(qid, extra?)`, `history(turns)`, `machinesUp(down?: string[])`, `fakeChatClient(opts?)` → `{ client, sent, state }`, `fakeChatFleet()` → `{ fleet, setMachines(list), machineMessage(machine, m) }`.

- [ ] **Step 1: Write the test helpers**

`apps/desktop/test/chat-helpers.ts` :

```ts
import { daemonStore, type DaemonClient, type MachineState } from '@ledge/fleet';
import type { ChatTurn, ClientMessage, ServerMessage } from '@ledge/protocol';
import type { ChatFleet } from '../src/chat/useChat';

export const T = '2026-10-15T09:00:00.000Z';
export function turn(qid: string, extra: Partial<ChatTurn> = {}): ChatTurn {
  return { qid, question: `Question ${qid}`, askedAt: T, steps: [], machineId: 'local', machineName: 'Local', ...extra };
}
/** What the fleet broadcasts after every change of the day's turns. */
export const history = (turns: ChatTurn[]) => daemonStore.apply({ type: 'chat.history', turns });

/** Local and Devbox, `down` ones unreachable. */
export function machinesUp(down: string[] = []): MachineState[] {
  return [['local', 'Local'], ['devbox', 'Devbox']].map(([id, label]) => ({
    id, label, status: down.includes(id!) ? 'unreachable' : 'open', ready: !down.includes(id!), recents: [], sessions: [], launcher: null
  })) as unknown as MachineState[];
}

/** The fleet as the chat sees it: a `chat.ask` becomes a running turn in the store unless one already runs (the fleet's
 *  « one question at a time ») or `state.refuse` is set; `chat.reset` empties the history. Everything sent is in `sent`. */
export function fakeChatClient(opts: { refuse?: boolean } = {}) {
  const sent: ClientMessage[] = [];
  const state = { refuse: opts.refuse ?? false };
  const client = {
    send(m: ClientMessage) {
      sent.push(m);
      const turns = daemonStore.getState().chat;
      if (m.type === 'chat.ask' && !state.refuse && !turns.some(t => t.answeredAt === undefined && t.error === undefined)) history([...turns, turn(m.qid, { question: m.text })]);
      if (m.type === 'chat.reset') history([]);
    }
  } as unknown as DaemonClient;
  return { client, sent, state };
}

/** `turnMachine` answers with the machine named by the turn; `machineMessage` plays a raw daemon message from one machine. */
export function fakeChatFleet() {
  let list = machinesUp();
  const listeners = new Set<(machine: string, m: ServerMessage) => void>();
  const fleet: ChatFleet = {
    turnMachine(qid) {
      const t = daemonStore.getState().chat.find(x => x.qid === qid);
      return t?.machineId ? list.find(m => m.id === t.machineId) : undefined;
    },
    onMachineMessage(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
  return {
    fleet,
    setMachines(next: MachineState[]) { list = next; },
    machineMessage(machine: string, m: ServerMessage) { for (const l of listeners) l(machine, m); }
  };
}
```

- [ ] **Step 2: Write the failing tests**

`apps/desktop/test/use-chat.test.tsx` :

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { daemonStore, type MachineState } from '@ledge/fleet';
import type { ChatTurn } from '@ledge/protocol';
import { useChat } from '../src/chat/useChat';
import { fakeChatClient, fakeChatFleet, history, machinesUp, T, turn } from './chat-helpers';

beforeEach(() => { localStorage.clear(); daemonStore.reset(); });

function setup(opts: { refuse?: boolean } = {}) {
  const c = fakeChatClient(opts);
  const f = fakeChatFleet();
  const hook = renderHook(({ machines, localDown }: { machines: MachineState[]; localDown: boolean }) => useChat(c.client, f.fleet, machines, localDown),
    { initialProps: { machines: machinesUp(), localDown: false } });
  return { ...c, ...f, hook, api: () => hook.result.current };
}
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };
const relay = { id: 'local:otto', name: 'Otto', tool: 'claude' as const, text: 'Run the tests' };
const answered = (qid: string, extra: Partial<ChatTurn> = {}) => turn(qid, { answeredAt: T, answer: 'Done.', ...extra });

describe('useChat: questions', () => {
  it('asks with the stored harness and says whether the fleet took the question', () => {
    localStorage.setItem('desktop.tool', JSON.stringify('codex'));
    const s = setup();
    let ok = false;
    act(() => { ok = s.api().ask('  Who needs me?  '); });
    expect(ok).toBe(true);
    expect(s.sent).toEqual([{ type: 'chat.ask', qid: expect.stringMatching(/^q-/), text: 'Who needs me?', tool: 'codex' }]);
    expect(s.api().running?.question).toBe('Who needs me?');
    expect(s.api().canAsk).toBe(false);
  });
  it('two asks in the same event send one question (Review Focus 1)', () => {
    const s = setup();
    act(() => { s.api().ask('One'); s.api().ask('Two'); });
    expect(s.sent.filter(m => m.type === 'chat.ask')).toHaveLength(1);
  });
  it('a blank question, a down local daemon or a refused question are not taken', () => {
    const s = setup({ refuse: true });
    let ok = true;
    act(() => { ok = s.api().ask('   '); });
    expect(ok).toBe(false);
    expect(s.sent).toEqual([]);
    act(() => { ok = s.api().ask('Hello'); });
    expect(ok).toBe(false);                       // sent, but the fleet did not list it
    expect(s.sent).toHaveLength(1);
    s.hook.rerender({ machines: machinesUp(['local', 'devbox']), localDown: true });
    act(() => { ok = s.api().ask('Hello'); });
    expect(ok).toBe(false);
    expect(s.sent).toHaveLength(1);
    expect(s.api().canAsk).toBe(false);
  });
  it('cancel targets the running turn, and nothing when none runs', () => {
    const s = setup();
    act(() => { s.api().cancel(); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().ask('Status?'); });
    const qid = s.api().running!.qid;
    act(() => { s.api().cancel(); });
    expect(s.sent.at(-1)).toEqual({ type: 'chat.cancel', qid });
  });
  it('reset only between questions, with something to forget, local daemon up', () => {
    const s = setup();
    act(() => { s.api().reset(); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().ask('Status?'); });
    act(() => { s.api().reset(); });
    expect(s.sent.map(m => m.type)).toEqual(['chat.ask']);
    act(() => { history([answered('a')]); });
    act(() => { s.api().reset(); });
    expect(s.sent.at(-1)).toEqual({ type: 'chat.reset' });
    expect(s.api().turns).toEqual([]);
  });
});

describe('useChat: card actions', () => {
  it('launches the proposal once, with its tool, folder, prompt and qid (Review Focus 1)', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal }), answered('b', { proposal })]); });
    act(() => { s.api().launch('a'); s.api().launch('a'); s.api().launch('b'); s.api().relay('b'); });
    expect(s.sent).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the build', qid: 'a' }]);
    expect(s.api().card).toMatchObject({ qid: 'a', kind: 'launch', machine: 'local' });
  });
  it('no prompt key when the proposal has none; nothing for a running, launched or unknown turn', () => {
    const s = setup();
    act(() => { history([turn('run', { proposal }), answered('done', { proposal: { ...proposal, launchedId: 'local:ari' } }), answered('bare', { proposal: { cwd: '/w/x', project: 'x', tool: 'codex' } })]); });
    act(() => { s.api().launch('run'); s.api().launch('done'); s.api().launch('nope'); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().launch('bare'); });
    expect(s.sent).toEqual([{ type: 'session.launch', tool: 'codex', cwd: '/w/x', qid: 'bare' }]);
  });
  it('frames that are not the outcome keep the card busy (Review Focus 2)', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal })]); });
    act(() => { s.api().launch('a'); });
    act(() => { history([answered('a', { proposal }), answered('b')]); });                         // another turn, same mark
    act(() => { s.machineMessage('devbox', { type: 'error', message: 'Devbox: no such folder' }); }); // another machine
    act(() => { s.machineMessage('local', { type: 'error', id: 'otto', message: 'pane gone' }); });   // an agent's answer (lot 4)
    expect(s.api().card?.qid).toBe('a');
    expect(s.api().note).toBeNull();
    act(() => { history([answered('a', { proposal: { ...proposal, launchedId: 'local:ari' } }), answered('b')]); });
    expect(s.api().card).toBeNull();
  });
  it('a proposal error frees the card and the next try can go', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal })]); });
    act(() => { s.api().launch('a'); });
    act(() => { history([answered('a', { proposal: { ...proposal, error: 'no such folder' } })]); });
    expect(s.api().card).toBeNull();
    act(() => { s.api().launch('a'); });
    expect(s.sent.filter(m => m.type === 'session.launch')).toHaveLength(2);
  });
  it('an id-less error from its own machine frees the card and is kept as a note', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal: { ...proposal, error: 'no such folder' } })]); });
    act(() => { s.api().launch('a'); });
    act(() => { s.machineMessage('local', { type: 'error', message: 'no such folder' }); });   // same error: the history did not change
    expect(s.api().card).toBeNull();
    expect(s.api().note).toEqual({ qid: 'a', message: 'no such folder' });
    act(() => { s.api().ask('Try /w/other'); });
    expect(s.api().note).toBeNull();
  });
  it('losing its machine or the local daemon frees the card and makes the turn unavailable (Review Focus 3)', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal, machineId: 'devbox', machineName: 'Devbox' })]); });
    expect(s.api().available('a')).toBe(true);
    act(() => { s.api().launch('a'); });
    expect(s.api().card?.machine).toBe('devbox');
    s.setMachines(machinesUp(['devbox']));
    s.hook.rerender({ machines: machinesUp(['devbox']), localDown: false });
    expect(s.api().card).toBeNull();
    expect(s.api().available('a')).toBe(false);
    act(() => { s.api().launch('a'); });
    expect(s.sent.filter(m => m.type === 'session.launch')).toHaveLength(1);

    s.setMachines(machinesUp());
    s.hook.rerender({ machines: machinesUp(), localDown: false });
    act(() => { s.api().launch('a'); });
    expect(s.api().card).not.toBeNull();
    s.hook.rerender({ machines: machinesUp(), localDown: true });
    expect(s.api().card).toBeNull();
    expect(s.api().available('a')).toBe(false);
  });
  it('relay: send while proposed or failed, cancel only while queued', () => {
    const s = setup();
    act(() => { history([answered('a', { relay })]); });
    act(() => { s.api().relayCancel('a'); });
    expect(s.sent).toEqual([]);
    act(() => { s.api().relay('a'); s.api().relay('a'); });
    expect(s.sent).toEqual([{ type: 'session.relay', qid: 'a' }]);
    expect(s.api().card?.kind).toBe('relay');
    act(() => { history([answered('a', { relay: { ...relay, status: 'queued' } })]); });
    expect(s.api().card).toBeNull();
    act(() => { s.api().relay('a'); });
    expect(s.sent).toHaveLength(1);
    act(() => { s.api().relayCancel('a'); });
    expect(s.sent.at(-1)).toEqual({ type: 'session.relay.cancel', qid: 'a' });
    act(() => { history([answered('a', { relay: { ...relay, error: 'cancelled' } })]); });
    act(() => { s.api().relay('a'); });
    expect(s.sent.at(-1)).toEqual({ type: 'session.relay', qid: 'a' });
  });
  it('reset waits for the card', () => {
    const s = setup();
    act(() => { history([answered('a', { proposal })]); });
    act(() => { s.api().launch('a'); });
    act(() => { s.api().reset(); });
    expect(s.sent.map(m => m.type)).toEqual(['session.launch']);
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `pnpm --filter desktop test use-chat`
Expected: FAIL — `Cannot find module '../src/chat/useChat'`.

- [ ] **Step 4: Implement**

`apps/desktop/src/chat/useChat.ts` :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { daemonStore, useDaemon, type DaemonClient, type Fleet, type MachineState } from '@ledge/fleet';
import type { ChatTurn, ClientMessage } from '@ledge/protocol';
import { loadTool } from '../launch/form';
import { cardMark, newQid, runningTurn } from './turns';

export type ChatFleet = Pick<Fleet, 'turnMachine' | 'onMachineMessage'>;
export type CardAction = 'launch' | 'relay' | 'relay.cancel';
/** The one card action waiting for its outcome: its turn, the machine it went to, the card as it was when clicked. */
export interface ChatInFlight { qid: string; kind: CardAction; machine: string; mark: string }
/** An id-less daemon error that answered a card action (shown under the card when it says something the card does not). */
export interface ChatNote { qid: string; message: string }

export interface ChatApi {
  turns: ChatTurn[];
  live: { qid: string; text: string } | null;
  running: ChatTurn | null;
  /** A question can be sent now: local daemon up, no turn running. */
  canAsk: boolean;
  card: ChatInFlight | null;
  note: ChatNote | null;
  /** True when the fleet listed the question (the draft can go); false when it was not sent or not taken. */
  ask(text: string): boolean;
  cancel(): void;
  reset(): void;
  launch(qid: string): void;
  relay(qid: string): void;
  relayCancel(qid: string): void;
  /** The turn's machine is reachable (its card can act). */
  available(qid: string): boolean;
}

const stored = () => daemonStore.getState().chat;

/** The chat with Ledge (spec §9.3). The fleet owns the protocol (routing, bindings, the day's history); this hook adds the one rule
 *  of Desktop's own: one card action at a time, freed by its outcome, by an id-less error from its machine, or by losing that
 *  machine or the local daemon. Guards read the store and a ref, so a double click sends one message. */
export function useChat(client: DaemonClient, fleet: ChatFleet, machines: readonly MachineState[], localDown: boolean): ChatApi {
  const { chat: turns, chatLive: live } = useDaemon();
  const [card, setCard] = useState<ChatInFlight | null>(null);
  const [note, setNote] = useState<ChatNote | null>(null);
  const flight = useRef<ChatInFlight | null>(null);
  const down = useRef(localDown);
  down.current = localDown;
  const release = useCallback(() => { flight.current = null; setCard(null); }, []);

  useEffect(() => {
    const f = flight.current;
    if (!f) return;
    const turn = turns.find(t => t.qid === f.qid);
    const machine = machines.find(m => m.id === f.machine);
    if (!turn || cardMark(turn) !== f.mark || localDown || !machine?.ready) release();
  }, [turns, machines, localDown, release]);

  useEffect(() => fleet.onMachineMessage((machine, m) => {
    const f = flight.current;
    if (!f || m.type !== 'error' || m.id !== undefined || machine !== f.machine) return;
    release();
    setNote({ qid: f.qid, message: m.message });
  }), [fleet, release]);

  const ask = (text: string): boolean => {
    const q = text.trim();
    if (!q || down.current || runningTurn(stored())) return false;
    const qid = newQid();
    setNote(null);
    client.send({ type: 'chat.ask', qid, text: q, tool: loadTool() });
    return stored().some(t => t.qid === qid);
  };
  const cancel = () => {
    const r = runningTurn(stored());
    if (r && !down.current) client.send({ type: 'chat.cancel', qid: r.qid });
  };
  const reset = () => {
    const all = stored();
    if (down.current || flight.current || runningTurn(all) || all.length === 0) return;
    setNote(null);
    client.send({ type: 'chat.reset' });
  };
  const begin = (qid: string, kind: CardAction, build: (t: ChatTurn) => ClientMessage | null) => {
    if (flight.current || down.current) return;
    const turn = stored().find(t => t.qid === qid);
    const machine = fleet.turnMachine(qid);
    if (!turn || turn.answeredAt === undefined || !machine?.ready) return;
    const msg = build(turn);
    if (!msg) return;
    const f: ChatInFlight = { qid, kind, machine: machine.id, mark: cardMark(turn) };
    flight.current = f;
    setCard(f);
    setNote(null);
    client.send(msg);
  };

  return {
    turns, live, card, note,
    running: runningTurn(turns),
    canAsk: !localDown && !runningTurn(turns),
    ask, cancel, reset,
    launch: qid => begin(qid, 'launch', t => {
      const p = t.proposal;
      return p && !t.relay && p.launchedId === undefined ? { type: 'session.launch', tool: p.tool, cwd: p.cwd, ...(p.prompt ? { prompt: p.prompt } : {}), qid } : null;
    }),
    relay: qid => begin(qid, 'relay', t => (t.relay && t.relay.status === undefined ? { type: 'session.relay', qid } : null)),
    relayCancel: qid => begin(qid, 'relay.cancel', t => (t.relay?.status === 'queued' ? { type: 'session.relay.cancel', qid } : null)),
    available: qid => !localDown && !!fleet.turnMachine(qid)?.ready
  };
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm --filter desktop test use-chat && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/chat/useChat.ts apps/desktop/test/chat-helpers.ts apps/desktop/test/use-chat.test.tsx
git commit -m "feat(desktop): chat hook with one card action at a time"
```

---

### Task 4: Textes du chat et cartes de lancement et de relais

Le bloc `chat` des messages (fr / en), puis les deux cartes portées de l'île (`apps/overlay/src/surface/LaunchCard.tsx`, `RelayCard.tsx`) en composants Desktop : mêmes états (`proposed` / `failed` / `launched` ; `proposed` / `failed` / `queued` / `sent`), même règle de pastille (`relayPill`), mêmes `data-launch-card` / `data-relay-card`. Différences voulues : classes CSS au lieu de styles en ligne, `Avatar` de Desktop au lieu du `Bot` de l'île, erreur en `role="status"` (jamais `alert`), pas de bouton Terminal ni de lien dans la carte lancée (les liens du tour s'en chargent, décision 8), vouvoiement.

**Files:**
- Modify: `apps/desktop/src/i18n/messages.ts`
- Create: `apps/desktop/src/chat/LaunchCard.tsx`
- Create: `apps/desktop/src/chat/RelayCard.tsx`
- Test: `apps/desktop/test/chat-cards.test.tsx`

**Interfaces:**
- Consumes: `Avatar({ session, size })`, `TOOL_NAMES` de `src/shell/Person.tsx` ; `botState` de `@ledge/ui` ; `ChatProposal`, `ChatRelay`, `Session` de `@ledge/protocol`.
- Produces :
  - `t.chat` (clés ci-dessous, utilisées par les tâches 5 et 6) ;
  - `LaunchCard(p: { proposal: ChatProposal; session?: Session; busy: boolean; disabled: boolean; onLaunch: () => void })` ;
  - `type Pill = 'yours' | 'working' | 'waiting' | 'stopped'` ; `relayPill(s: Session | undefined): Pill` ;
  - `RelayCard(p: { relay: ChatRelay; session?: Session; busy: boolean; disabled: boolean; onSend: () => void; onCancel: () => void })`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/chat-cards.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { LaunchCard } from '../src/chat/LaunchCard';
import { RelayCard, relayPill } from '../src/chat/RelayCard';

const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };
const relay = { id: 'local:otto', name: 'Otto', tool: 'claude' as const, text: 'Run the tests' };
const otto = fakeSession('local:otto', { name: 'Otto', state: 'idle', project: 'ledge', branch: 'fix/build', machineId: 'local' });
const card = () => document.querySelector('section.ledge-card')!;

describe('LaunchCard', () => {
  it('a proposal shows the folder, the harness and the instruction, and starts on click', () => {
    const onLaunch = vi.fn();
    render(<LaunchCard proposal={proposal} busy={false} disabled={false} onLaunch={onLaunch} />);
    expect(screen.getByRole('region', { name: 'Proposed session' })).toHaveAttribute('data-launch-card', 'proposed');
    expect(card()).toHaveTextContent('ledge');
    expect(card()).toHaveTextContent('/w/ledge');
    expect(card()).toHaveTextContent('Claude Code · default');
    expect(card()).toHaveTextContent('Fix the build');
    expect(card()).toHaveTextContent('or rephrase your request');
    fireEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(onLaunch).toHaveBeenCalledOnce();
  });
  it('no instruction says so; busy and disabled block the button', () => {
    const { rerender } = render(<LaunchCard proposal={{ ...proposal, prompt: undefined }} busy disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveTextContent('None, empty session');
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    rerender(<LaunchCard proposal={proposal} busy={false} disabled onLaunch={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeDisabled();
  });
  it('a failure is a status, never an alert, with a retry', () => {
    render(<LaunchCard proposal={{ ...proposal, error: 'no such folder' }} busy={false} disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveAttribute('data-launch-card', 'failed');
    expect(screen.getByRole('status')).toHaveTextContent('Could not start: no such folder');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(card()).toHaveTextContent('or give me another folder');
  });
  it('launched: names the session when listed, no button', () => {
    const ari = fakeSession('local:ari', { name: 'Ari' });
    const { rerender } = render(<LaunchCard proposal={{ ...proposal, launchedId: 'local:ari' }} session={ari} busy={false} disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveAttribute('data-launch-card', 'launched');
    expect(card()).toHaveTextContent('Ari has started');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<LaunchCard proposal={{ ...proposal, launchedId: 'local:ari' }} busy={false} disabled={false} onLaunch={vi.fn()} />);
    expect(card()).toHaveTextContent('Session started');
  });
  it('speaks French with vouvoiement', () => {
    render(<LangProvider lang="fr"><LaunchCard proposal={proposal} busy={false} disabled={false} onLaunch={vi.fn()} /></LangProvider>);
    expect(screen.getByRole('button', { name: 'Lancer la session' })).toBeEnabled();
    expect(card()).toHaveTextContent('ou reformulez votre demande');
    expect(card()).toHaveTextContent('Claude Code · par défaut');
  });
});

describe('relayPill', () => {
  it('your turn, working, waiting for you, stopped', () => {
    expect(relayPill(otto)).toBe('yours');
    expect(relayPill({ ...otto, state: 'working' })).toBe('working');
    expect(relayPill({ ...otto, state: 'waiting_input' })).toBe('waiting');
    expect(relayPill({ ...otto, state: 'waiting_permission' })).toBe('waiting');
    expect(relayPill({ ...otto, state: 'exited' })).toBe('stopped');
    expect(relayPill(undefined)).toBe('stopped');
  });
});

describe('RelayCard', () => {
  it('proposed: the session, its state, the instruction, and Send', () => {
    const onSend = vi.fn();
    render(<RelayCard relay={relay} session={otto} busy={false} disabled={false} onSend={onSend} onCancel={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Instruction to send' })).toHaveAttribute('data-relay-card', 'proposed');
    expect(card()).toHaveTextContent('Claude Code · ledge fix/build');
    expect(card().querySelector('[data-pill]')).toHaveAttribute('data-pill', 'yours');
    expect(card().querySelector('[data-pill]')).toHaveTextContent('your turn');
    expect(card().querySelector('blockquote')).toHaveTextContent('Run the tests');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledOnce();
  });
  it('queued: says it will go when the session is done, and can be cancelled', () => {
    const onCancel = vi.fn();
    render(<RelayCard relay={{ ...relay, status: 'queued' }} session={{ ...otto, state: 'working' }} busy={false} disabled={false} onSend={vi.fn()} onCancel={onCancel} />);
    expect(card()).toHaveAttribute('data-relay-card', 'queued');
    expect(card()).toHaveTextContent("Otto is working; I'll send it as soon as it's done");
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it('sent: to whom and when', () => {
    const sentAt = '2026-10-15T09:41:00.000Z';
    render(<RelayCard relay={{ ...relay, status: 'sent', sentAt }} session={otto} busy={false} disabled={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    const time = new Date(sentAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    expect(card()).toHaveTextContent(`Sent to Otto · ${time}`);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('failed: a status with a retry; a session that left the list is stopped', () => {
    render(<RelayCard relay={{ ...relay, error: 'pane gone' }} busy={false} disabled={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Could not send: pane gone');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(card().querySelector('[data-pill]')).toHaveTextContent('stopped');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
  it('speaks French with vouvoiement', () => {
    render(<LangProvider lang="fr"><RelayCard relay={relay} session={{ ...otto, state: 'waiting_input' }} busy={false} disabled={false} onSend={vi.fn()} onCancel={vi.fn()} /></LangProvider>);
    expect(card().querySelector('[data-pill]')).toHaveTextContent('attend votre réponse');
    expect(card()).toHaveTextContent('ou reformulez votre demande');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test chat-cards`
Expected: FAIL — modules `../src/chat/LaunchCard` et `../src/chat/RelayCard` introuvables.

- [ ] **Step 3: Implement the messages**

Dans `apps/desktop/src/i18n/messages.ts`, ajouter un bloc `chat` en **dernière clé** de `fr` (après `conversation`, ou après le bloc du lot 5 s'il est le dernier) :

```ts
  chat: {
    trigger: 'Parler à Ledge',
    label: 'Parler à Ledge',
    eyebrow: 'PARLER À LEDGE',
    identity: (sessions: number, projects: number) => `${sessions} ${plural(sessions, 'session', 'sessions')} · ${projects} ${plural(projects, 'projet', 'projets')}`,
    purpose: 'Faites le point sur vos projets ou préparez votre prochaine tâche.',
    reset: 'Nouvelle conversation',
    thread: 'Historique avec Ledge',
    welcome: { title: 'De quoi avez-vous besoin ?', text: 'Retrouvez les demandes en attente et le contexte de votre équipe.' },
    starters: { label: 'Suggestions pour Ledge', items: ['Qui a besoin de moi ?', 'Fais le point sur les projets', 'Préparer une nouvelle session'] as readonly string[] },
    author: 'Ledge',
    thinking: 'Ledge cherche…',
    step: { sessions: 'Relit les sessions', pane: (name: string) => `Lit le terminal de ${name}`, reply: (name: string) => `Lit la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => `Lit ${path}` },
    source: { sessions: 'les sessions', pane: (name: string) => `le terminal de ${name}`, reply: (name: string) => `la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => path },
    sourcesNone: 'aucune lecture',
    sourcesLine: (list: string, time: string) => `Sources : ${list} · ${time}`,
    stop: 'Annuler',
    stopLabel: 'Annuler la question en cours',
    stopped: 'Question annulée.',
    error: (why: string) => `Ledge n’a pas pu répondre : ${why}`,
    choose: (name: string) => `Sur ${name}.`,
    choices: 'Machines proposées',
    clarification: 'Vous pouvez aussi répondre par écrit.',
    destination: (name: string) => `Destination : ${name}`,
    unavailable: 'déconnectée',
    links: 'Sessions citées',
    open: (name: string) => `Ouvrir ${name}`,
    readonly: 'Lecture seule : le daemon local ne répond pas. L’historique avec Ledge reste lisible.',
    frozen: (names: string) => `${names} : connexion perdue. Ledge s’appuie sur le dernier état connu de ces machines.`,
    composer: {
      label: 'Parler à Ledge',
      placeholder: 'Posez votre question à Ledge…',
      send: 'Envoyer ↑',
      hint: 'Ctrl / ⌘ + Entrée pour envoyer',
      busy: 'Ledge répond… Vous pouvez préparer la suite.',
      refused: 'Ledge n’a pas pris cette question. Réessayez dans un instant.',
      readonly: 'Lecture seule : le daemon local ne répond pas.'
    },
    card: {
      label: 'Session proposée', folder: 'Dossier', tool: 'Harnais', byDefault: (tool: string) => `${tool} · par défaut`, prompt: 'Instruction', noPrompt: 'Aucune, session vide',
      launch: 'Lancer la session', launching: 'Lancement…', retry: 'Réessayer', orRephrase: 'ou reformulez votre demande', orFolder: 'ou indiquez un autre dossier',
      failed: (why: string) => `Échec du lancement : ${why}`, started: (name: string) => `${name} a démarré`, startedUnknown: 'Session démarrée'
    },
    relay: {
      label: 'Instruction à envoyer', session: 'Session', instruction: 'Instruction',
      send: 'Envoyer', sending: 'Envoi…', cancel: 'Annuler', retry: 'Réessayer', orRephrase: 'ou reformulez votre demande',
      queued: 'travaille ; l’instruction partira dès qu’il aura fini', sentTo: 'Envoyé à', failed: (why: string) => `Échec de l’envoi : ${why}`,
      pill: { yours: 'à vous', working: 'travaille', waiting: 'attend votre réponse', stopped: 'arrêtée' }
    }
  }
```

et en dernière clé de `en` :

```ts
  chat: {
    trigger: 'Talk to Ledge',
    label: 'Talk to Ledge',
    eyebrow: 'TALK TO LEDGE',
    identity: (sessions, projects) => `${sessions} ${plural(sessions, 'session', 'sessions')} · ${projects} ${plural(projects, 'project', 'projects')}`,
    purpose: 'Check where your projects stand or prepare your next task.',
    reset: 'New conversation',
    thread: 'History with Ledge',
    welcome: { title: 'What do you need?', text: 'Find the waiting requests and your team’s context.' },
    starters: { label: 'Suggestions for Ledge', items: ['Who needs me?', 'Give me a status of the projects', 'Prepare a new session'] },
    author: 'Ledge',
    thinking: 'Ledge is looking…',
    step: { sessions: 'Reads the sessions', pane: name => `Reads ${name}'s terminal`, reply: name => `Reads ${name}'s last reply`, git: name => `git in ${name}'s folder`, repo: path => `Reads ${path}` },
    source: { sessions: 'the sessions', pane: name => `${name}'s terminal`, reply: name => `${name}'s last reply`, git: name => `git in ${name}'s folder`, repo: path => path },
    sourcesNone: 'nothing read',
    sourcesLine: (list, time) => `Sources: ${list} · ${time}`,
    stop: 'Cancel',
    stopLabel: 'Cancel the current question',
    stopped: 'Question cancelled.',
    error: why => `Ledge could not answer: ${why}`,
    choose: name => `On ${name}.`,
    choices: 'Suggested machines',
    clarification: 'You can also answer in writing.',
    destination: name => `Destination: ${name}`,
    unavailable: 'disconnected',
    links: 'Sessions mentioned',
    open: name => `Open ${name}`,
    readonly: 'Read-only: the local daemon does not answer. The history with Ledge stays readable.',
    frozen: names => `${names}: connection lost. Ledge relies on the last known state of these machines.`,
    composer: {
      label: 'Talk to Ledge',
      placeholder: 'Ask Ledge your question…',
      send: 'Send ↑',
      hint: 'Ctrl / ⌘ + Enter to send',
      busy: 'Ledge is answering… You can prepare what comes next.',
      refused: 'Ledge did not take this question. Try again in a moment.',
      readonly: 'Read-only: the local daemon does not answer.'
    },
    card: {
      label: 'Proposed session', folder: 'Folder', tool: 'Harness', byDefault: tool => `${tool} · default`, prompt: 'Instruction', noPrompt: 'None, empty session',
      launch: 'Start the session', launching: 'Starting…', retry: 'Retry', orRephrase: 'or rephrase your request', orFolder: 'or give me another folder',
      failed: why => `Could not start: ${why}`, started: name => `${name} has started`, startedUnknown: 'Session started'
    },
    relay: {
      label: 'Instruction to send', session: 'Session', instruction: 'Instruction',
      send: 'Send', sending: 'Sending…', cancel: 'Cancel', retry: 'Retry', orRephrase: 'or rephrase your request',
      queued: "is working; I'll send it as soon as it's done", sentTo: 'Sent to', failed: why => `Could not send: ${why}`,
      pill: { yours: 'your turn', working: 'working', waiting: 'waiting for you', stopped: 'stopped' }
    }
  }
```

(Si `en` est écrit avec des paramètres annotés, comme `actions: (n: number) => …` du lot 4, annoter de même : le type vient de `typeof fr` dans les deux cas.)

- [ ] **Step 4: Implement the cards**

`apps/desktop/src/chat/LaunchCard.tsx` :

```tsx
import type { ChatProposal, Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { TOOL_NAMES } from '../shell/Person';

export interface LaunchCardProps {
  proposal: ChatProposal;
  /** The launched session, once the fleet lists `launchedId`. */
  session?: Session;
  busy: boolean; disabled: boolean;
  onLaunch: () => void;
}

/** The session Ledge proposes (spec §9.3; the island's LaunchCard): proposed, launched, or failed with a retry. Launching is the
 *  person's click. Once launched, the turn's links open the session (no link or Terminal button here). */
export function LaunchCard(p: LaunchCardProps) {
  const { t } = useI18n();
  const c = t.chat.card;
  const pr = p.proposal;
  const state = pr.launchedId !== undefined ? 'launched' : pr.error !== undefined ? 'failed' : 'proposed';
  return (
    <section className="ledge-card" data-launch-card={state} aria-label={c.label}>
      {state === 'launched' ? <p className="ledge-card-done">{p.session ? c.started(p.session.name) : c.startedUnknown}</p> : <>
        <dl>
          <dt>{c.folder}</dt><dd><strong>{pr.project}</strong> <code>{pr.cwd}</code></dd>
          <dt>{c.tool}</dt><dd>{c.byDefault(TOOL_NAMES[pr.tool])}</dd>
          <dt>{c.prompt}</dt><dd>{pr.prompt ?? <span className="ledge-card-muted">{c.noPrompt}</span>}</dd>
        </dl>
        {state === 'failed' && <p className="ledge-card-error" role="status">{c.failed(pr.error!)}</p>}
        <div className="ledge-card-foot">
          <button type="button" className="primary" disabled={p.busy || p.disabled} onClick={p.onLaunch}>{p.busy ? c.launching : state === 'failed' ? c.retry : c.launch}</button>
          <span>{state === 'failed' ? c.orFolder : c.orRephrase}</span>
        </div>
      </>}
    </section>
  );
}
```

`apps/desktop/src/chat/RelayCard.tsx` :

```tsx
import type { ChatRelay, Session } from '@ledge/protocol';
import { botState } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { Avatar, TOOL_NAMES } from '../shell/Person';

export type Pill = 'yours' | 'working' | 'waiting' | 'stopped';
/** The target session's state as the card words it (the island's rule): your turn, working, waiting for you, or stopped. */
export function relayPill(s: Session | undefined): Pill {
  if (!s || s.state === 'exited' || s.state === 'error') return 'stopped';
  if (s.state === 'waiting_input' || s.state === 'waiting_permission') return 'waiting';
  return botState(s) === 'idle' ? 'yours' : 'working';
}

export interface RelayCardProps {
  relay: ChatRelay;
  /** The target session as the fleet lists it; absent once it left the list. */
  session?: Session;
  busy: boolean; disabled: boolean;
  onSend: () => void; onCancel: () => void;
}

/** The instruction Ledge proposes to send to a session (spec §9.3; the island's RelayCard): proposed, queued, sent, or failed with a
 *  retry. Sending is the person's click. */
export function RelayCard(p: RelayCardProps) {
  const { t, lang } = useI18n();
  const c = t.chat.relay;
  const r = p.relay;
  const s = p.session;
  const state = r.status === 'sent' ? 'sent' : r.status === 'queued' ? 'queued' : r.error !== undefined ? 'failed' : 'proposed';
  const pill = relayPill(s);
  const time = r.sentAt ? new Date(r.sentAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <section className="ledge-card" data-relay-card={state} aria-label={c.label}>
      {state === 'sent' ? (
        <p className="ledge-card-done">{s && <Avatar session={s} size={20} />}<span>{c.sentTo} <strong>{r.name}</strong> · {time}</span></p>
      ) : <>
        <dl>
          <dt>{c.session}</dt>
          <dd className="ledge-card-session">
            {s && <Avatar session={s} size={24} />}
            <span><strong>{r.name}</strong>{s && <small>{TOOL_NAMES[r.tool]} · {s.repo ?? s.project}{s.branch && <> <code>{s.branch}</code></>}</small>}</span>
            <span className="ledge-pill" data-pill={pill}>{c.pill[pill]}</span>
          </dd>
          <dt>{c.instruction}</dt>
          <dd><blockquote>{r.text}</blockquote></dd>
        </dl>
        {state === 'failed' && <p className="ledge-card-error" role="status">{c.failed(r.error!)}</p>}
        {state === 'queued' ? (
          <div className="ledge-card-foot">
            <span className="ledge-queued-dot" aria-hidden="true" />
            <span><strong>{r.name}</strong> {c.queued}</span>
            <button type="button" className="settings-button" disabled={p.busy || p.disabled} onClick={p.onCancel}>{c.cancel}</button>
          </div>
        ) : (
          <div className="ledge-card-foot">
            <button type="button" className="primary" disabled={p.busy || p.disabled} onClick={p.onSend}>{p.busy ? c.sending : state === 'failed' ? c.retry : c.send}</button>
            <span>{c.orRephrase}</span>
          </div>
        )}
      </>}
    </section>
  );
}
```

Si `Session` n'a pas de champ `repo` dans `@ledge/protocol`, écrire `s.project` seul (l'île lit `s.repo ?? s.project`). Si `botState` attend un autre argument que la session, suivre sa signature dans `packages/ui/src/bots/poseFor.ts`.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm --filter desktop test chat-cards && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/i18n/messages.ts apps/desktop/src/chat/LaunchCard.tsx apps/desktop/src/chat/RelayCard.tsx apps/desktop/test/chat-cards.test.tsx
git commit -m "feat(desktop): chat texts, launch and relay cards"
```

---

### Task 5: Le panneau du chat (`ChatTurn`, `ChatPane`, styles)

Le panneau suit la maquette `ledge-chat.js` : `aside#conversation-pane.detail.conversation.ledge-chat[data-ledge-chat]` (même place, même largeur, même « Agrandir » que la conversation d'un agent), en-tête `.conversation-header` avec `.conversation-top`, identité (portrait `ResidentMascot`, « Ledge. », « N sessions · P projets », « Nouvelle conversation »), phrase d'usage ; puis les notices (`role="status"`), le fil `section.thread-scroll` (position de lecture sous la clé `ledge` via `useReadingPosition`), l'accueil quand il n'y a aucun tour, les trois suggestions, et le compositeur (`ComposerForm` avec les ids du chat). Un tour réutilise les classes `.thread-message user` / `.thread-message agent` et `.thread-notice` du lot 4 ; ce qui diffère d'une conversation d'agent : les blocs sont des tours de Ledge (pas des `ThreadItem`), la réponse est découpée par `answerBlocks` (une conversation d'agent est en texte brut), l'envoi dépend de `chat.canAsk` (pas de `replyBlock`), le compositeur n'est figé que si le daemon local est injoignable, et l'indice est celui de la maquette (« Ctrl / ⌘ + Entrée pour envoyer »).

**Files:**
- Create: `apps/desktop/src/chat/ChatTurn.tsx`
- Create: `apps/desktop/src/chat/ChatPane.tsx`
- Modify: `apps/desktop/src/styles/app.css`
- Test: `apps/desktop/test/chat-pane.test.tsx`

**Interfaces:**
- Consumes: `ComposerForm`, `useReadingPosition` (tâche 1) ; `CHAT_ID`, `isRunning`, `turnLinks`, `mentionable`, `answerBlocks`, `cardKind`, `Inline` (tâche 2) ; `ChatApi`, `useChat` (tâche 3) ; `LaunchCard`, `RelayCard`, `t.chat` (tâche 4) ; `Conversations` et `useConversations` (lot 4) ; `groupSessions`, `MachineState` de `@ledge/fleet` ; `hideProposal`, `ChatStep`, `ChatTurn`, `Session` de `@ledge/protocol` ; `ResidentMascot` de `@ledge/ui` ; `useTheme` (`src/shell/theme.ts`).
- Produces :
  - `ChatTurnView(p: { turn: ChatTurn; last: boolean; chat: ChatApi; sessions: readonly Session[]; machines: readonly MachineState[]; onOpenSession: (id: string) => void })` ;
  - `interface ChatPaneProps { chat: ChatApi; api: Pick<Conversations, 'draft' | 'setDraft' | 'pref' | 'setPref'>; sessions: readonly Session[]; machines: readonly MachineState[]; localDown: boolean; expanded: boolean; onExpand: (on: boolean) => void; onOpenSession: (id: string) => void }` ; `ChatPane(p: ChatPaneProps)` ;
  - DOM : `#ledge-chat-reply`, `#ledge-chat-form`, `#ledge-reply-hint`, `[data-ledge-chat]`, `[data-ledge-session]` (liens), `[data-ledge-mention]` (noms dans la réponse), `.ledge-chat-reset`, `.ledge-starters`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/chat-pane.test.tsx` :

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { daemonStore, type MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ChatTurn, Session } from '@ledge/protocol';
import { useChat } from '../src/chat/useChat';
import { ChatPane } from '../src/chat/ChatPane';
import { Composer } from '../src/conversation/Composer';
import { useConversations } from '../src/conversation/useConversations';
import { LangProvider } from '../src/i18n/lang';
import { THREAD_KEY } from '../src/state/threadPrefs';
import { DRAFTS_KEY } from '../src/state/drafts';
import { fakeChatClient, fakeChatFleet, history, machinesUp, T, turn } from './chat-helpers';

beforeEach(() => { localStorage.clear(); daemonStore.reset(); });

const otto = fakeSession('local:otto', { name: 'Otto', machineId: 'local', project: 'ledge' });
const bix = fakeSession('local:bix', { name: 'Bix', machineId: 'local', project: 'ledge', state: 'idle' });
const answered = (qid: string, extra: Partial<ChatTurn> = {}) => turn(qid, { answeredAt: T, answer: 'Done.', ...extra });
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };

function setup(o: { sessions?: Session[]; machines?: MachineState[]; localDown?: boolean; refuse?: boolean; withBix?: boolean } = {}) {
  const c = fakeChatClient({ refuse: o.refuse });
  const f = fakeChatFleet();
  const onOpen = vi.fn();
  const props = { sessions: o.sessions ?? [otto, bix], machines: o.machines ?? machinesUp(), localDown: o.localDown ?? false };
  f.setMachines(props.machines);
  function Harness(h: typeof props) {
    const chat = useChat(c.client, f.fleet, h.machines, h.localDown);
    const api = useConversations(c.client, h.sessions, h.machines, true);
    const b = h.sessions.find(s => s.id === 'local:bix');
    return <>
      {o.withBix && b && <Composer session={b} api={api} />}
      <ChatPane chat={chat} api={api} sessions={h.sessions} machines={h.machines} localDown={h.localDown} expanded={false} onExpand={() => {}} onOpenSession={onOpen} />
    </>;
  }
  const r = render(<Harness {...props} />);
  const rerender = (next: Partial<typeof props>) => { Object.assign(props, next); if (next.machines) f.setMachines(next.machines); r.rerender(<Harness {...props} />); };
  return { ...c, ...f, onOpen, rerender };
}
const pane = () => document.querySelector('#conversation-pane[data-ledge-chat]') as HTMLElement;
const box = () => document.getElementById('ledge-chat-reply') as HTMLTextAreaElement;
const hint = () => document.getElementById('ledge-reply-hint')!;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const ctrlEnter = () => fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
const asks = (sent: { type: string }[]) => sent.filter(m => m.type === 'chat.ask');

describe('ChatPane: welcome', () => {
  it('is the conversation pane without a session: identity, welcome, three suggestions', () => {
    setup();
    expect(screen.getByRole('complementary', { name: 'Talk to Ledge' })).toBe(pane());
    expect(pane()).not.toHaveAttribute('data-session');
    expect(pane()).not.toHaveAttribute('data-conversation');
    expect(pane()).toHaveTextContent('TALK TO LEDGE');
    expect(pane()).toHaveTextContent('2 sessions · 1 project');
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'History with Ledge' })).toHaveClass('thread-scroll');
    const starters = within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button');
    expect(starters.map(b => b.textContent)).toEqual(['Who needs me?', 'Give me a status of the projects', 'Prepare a new session']);
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
  });
  it('speaks French with vouvoiement', () => {
    render(<LangHarness />);
    expect(screen.getByRole('complementary', { name: 'Parler à Ledge' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'De quoi avez-vous besoin ?' })).toBeVisible();
    expect(screen.getByPlaceholderText('Posez votre question à Ledge…')).toBeVisible();
  });
});

function LangHarness() {
  const [c] = useState(() => fakeChatClient());
  const [f] = useState(() => fakeChatFleet());
  return <LangProvider lang="fr"><Inner c={c.client} f={f.fleet} /></LangProvider>;
}
function Inner({ c, f }: { c: ReturnType<typeof fakeChatClient>['client']; f: ReturnType<typeof fakeChatFleet>['fleet'] }) {
  const machines = machinesUp();
  const chat = useChat(c, f, machines, false);
  const api = useConversations(c, [], machines, true);
  return <ChatPane chat={chat} api={api} sessions={[]} machines={machines} localDown={false} expanded={false} onExpand={() => {}} onOpenSession={() => {}} />;
}

describe('ChatPane: asking', () => {
  it('Ctrl+Enter asks once, clears the draft, shows the running turn with Cancel', () => {
    const s = setup();
    type('Who needs me?');
    ctrlEnter();
    ctrlEnter();
    expect(asks(s.sent)).toEqual([expect.objectContaining({ type: 'chat.ask', text: 'Who needs me?', tool: 'claude' })]);
    expect(box()).toHaveValue('');
    expect(pane()).toHaveTextContent('Who needs me?');
    expect(pane()).toHaveTextContent('Ledge is looking…');
    expect(hint()).toHaveTextContent('Ledge is answering… You can prepare what comes next.');
    // Typing stays possible; sending does not.
    type('Next one');
    ctrlEnter();
    expect(asks(s.sent)).toHaveLength(1);
    expect(box()).toHaveValue('Next one');
    for (const b of within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button')) expect(b).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the current question' }));
    const qid = (asks(s.sent)[0] as { qid: string }).qid;
    expect(s.sent.at(-1)).toEqual({ type: 'chat.cancel', qid });
  });
  it('a suggestion is sent as it is, once, without touching the draft', () => {
    const s = setup();
    type('My own draft');
    const starter = screen.getByRole('button', { name: 'Give me a status of the projects' });
    fireEvent.click(starter);
    fireEvent.click(starter);
    expect(asks(s.sent)).toEqual([expect.objectContaining({ text: 'Give me a status of the projects' })]);
    expect(box()).toHaveValue('My own draft');
  });
  it('a question the fleet did not take keeps the draft and says so', () => {
    setup({ refuse: true });
    type('Who needs me?');
    ctrlEnter();
    expect(box()).toHaveValue('Who needs me?');
    expect(hint()).toHaveTextContent('Ledge did not take this question. Try again in a moment.');
    type('Who needs me now?');
    expect(hint()).toHaveTextContent('Ctrl / ⌘ + Enter to send');
  });
});

describe('ChatPane: a turn', () => {
  it('steps while reading, the live answer, then the answer with links and sources', () => {
    const s = setup();
    act(() => history([turn('q1', { machineId: undefined, machineName: undefined, steps: [{ kind: 'pane', id: 'local:otto', name: 'Otto' }] })]));
    expect(within(pane()).getByRole('list')).toHaveTextContent("Reads Otto's terminal");
    act(() => daemonStore.apply({ type: 'chat.delta', qid: 'q1', text: 'Otto is waiting' }));
    expect(pane()).toHaveTextContent('Otto is waiting');
    act(() => history([answered('q1', { steps: [{ kind: 'pane', id: 'local:otto', name: 'Otto' }], answer: '**Otto** waits for `npm test`.\n\n- one\n- two' })]));
    expect(screen.queryByRole('button', { name: 'Cancel the current question' })).toBeNull();
    const mention = pane().querySelector('[data-ledge-mention="local:otto"]')!;
    expect(mention).toHaveTextContent('Otto');
    fireEvent.click(mention);
    expect(s.onOpen).toHaveBeenLastCalledWith('local:otto');
    expect(pane().querySelector('.ledge-answer code')).toHaveTextContent('npm test');
    expect(pane().querySelectorAll('.ledge-answer li')).toHaveLength(2);
    const links = screen.getByRole('group', { name: 'Sessions mentioned' });
    fireEvent.click(within(links).getByRole('button', { name: 'Open Otto' }));
    expect(s.onOpen).toHaveBeenCalledTimes(2);
    const time = new Date(T).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    expect(pane().querySelector('.ledge-source')).toHaveTextContent(`Sources: Otto's terminal · ${time}`);
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(s.sent.at(-1)).toEqual({ type: 'chat.reset' });
    expect(screen.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  });
  it('a session that left, or a name only found on another machine, is never a live link', () => {
    setup({ sessions: [fakeSession('devbox:otto', { name: 'Otto', machineId: 'devbox' })] });
    act(() => history([answered('q1', { steps: [{ kind: 'reply', id: 'local:gone', name: 'Gone' }], answer: '**Gone** and **Otto**.' })]));
    expect(screen.getByRole('button', { name: 'Open Gone' })).toBeDisabled();
    expect(pane().querySelector('[data-ledge-mention]')).toBeNull();
    expect(pane().querySelectorAll('.ledge-answer strong')).toHaveLength(2);
  });
  it('a clarification offers the machines on the last turn only, and a click answers', () => {
    const s = setup();
    const ask = turn('q1', { machineId: undefined, machineName: undefined, answeredAt: T, answer: 'Which machine?', choices: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox' }] });
    act(() => history([ask]));
    const group = screen.getByRole('group', { name: 'Suggested machines' });
    expect(pane()).toHaveTextContent('You can also answer in writing.');
    fireEvent.click(within(group).getByRole('button', { name: 'Devbox' }));
    expect(asks(s.sent)).toEqual([expect.objectContaining({ text: 'On Devbox.' })]);
    act(() => history([ask, answered('q2')]));
    expect(screen.queryByRole('group', { name: 'Suggested machines' })).toBeNull();
  });
  it('a card goes to its machine once; losing that machine disables it and says so', () => {
    const s = setup();
    act(() => history([answered('q1', { machineId: 'devbox', machineName: 'Devbox', proposal })]));
    expect(pane()).toHaveTextContent('Destination: Devbox');
    const start = screen.getByRole('button', { name: 'Start the session' });
    fireEvent.click(start);
    fireEvent.click(start);
    expect(s.sent.filter(m => m.type === 'session.launch')).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/ledge', prompt: 'Fix the build', qid: 'q1' }]);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    s.rerender({ machines: machinesUp(['devbox']) });
    expect(pane()).toHaveTextContent('Destination: Devbox · disconnected');
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeDisabled();
  });
  it('an id-less error of the card machine shows under the card when it says something new', () => {
    const s = setup();
    act(() => history([answered('q1', { machineId: 'devbox', machineName: 'Devbox', proposal })]));
    fireEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    act(() => s.machineMessage('devbox', { type: 'error', message: 'folder vanished' }));
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeEnabled();
    expect(pane()).toHaveTextContent('folder vanished');
  });
  it('errors and cancellations are statuses, never alerts', () => {
    setup();
    act(() => history([turn('q1', { error: 'Devbox is offline' }), turn('q2', { error: 'cancelled' })]));
    const statuses = within(pane()).getAllByRole('status').map(n => n.textContent);
    expect(statuses).toContain('Ledge could not answer: Devbox is offline');
    expect(statuses).toContain('Question cancelled.');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ChatPane: read-only and frozen machines', () => {
  it('the local daemon down: history readable, composer frozen with its draft, nothing can be sent', () => {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ ledge: 'Kept draft' }));
    act(() => history([answered('q1', { machineId: 'local', proposal })]));
    setup({ localDown: true, machines: machinesUp(['local', 'devbox']) });
    expect(pane()).toHaveTextContent('Done.');
    expect(box()).toBeDisabled();
    expect(box()).toHaveValue('Kept draft');
    expect(hint()).toHaveTextContent('Read-only: the local daemon does not answer.');
    expect(pane()).toHaveTextContent('Read-only: the local daemon does not answer. The history with Ledge stays readable.');
    for (const b of within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button')) expect(b).toBeDisabled();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start the session' })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('a remote machine lost is announced in the chat', () => {
    setup({ machines: machinesUp(['devbox']) });
    expect(pane()).toHaveTextContent('Devbox: connection lost. Ledge relies on the last known state of these machines.');
  });
});

describe('ChatPane: drafts and threads stay apart (spec §12)', () => {
  it('the chat and an agent keep their own draft and reading position', async () => {
    setup({ withBix: true });
    fireEvent.change(document.getElementById('conversation-reply')!, { target: { value: 'For Bix' } });
    type('For Ledge');
    await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual({ 'local:bix': 'For Bix', ledge: 'For Ledge' }));
    ctrlEnter();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(DRAFTS_KEY)!)).toEqual({ 'local:bix': 'For Bix' }));
    expect(document.getElementById('conversation-reply')).toHaveValue('For Bix');
    const thread = within(pane()).getByRole('region', { name: 'History with Ledge' });
    Object.defineProperty(thread, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(thread, 'clientHeight', { configurable: true, value: 200 });
    thread.scrollTop = 100;
    fireEvent.scroll(thread);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(THREAD_KEY) ?? '{}')).toEqual({ ledge: expect.objectContaining({ scroll: 100 }) }), { timeout: 1000 });
  });
});
```

Le nom accessible d'un lien est « Open Otto » : la flèche `↗` est dans un `span aria-hidden` et n'entre pas dans le nom (Testing Library comme Playwright ignorent les nœuds `aria-hidden`).

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test chat-pane`
Expected: FAIL — `Cannot find module '../src/chat/ChatPane'`.

- [ ] **Step 3: Implement the turn**

`apps/desktop/src/chat/ChatTurn.tsx` :

```tsx
import { Fragment } from 'react';
import type { MachineState } from '@ledge/fleet';
import { hideProposal, type ChatStep, type ChatTurn, type Session } from '@ledge/protocol';
import { useI18n, type Messages } from '../i18n/lang';
import { LaunchCard } from './LaunchCard';
import { RelayCard } from './RelayCard';
import { answerBlocks, cardKind, isRunning, mentionable, turnLinks, type Inline } from './turns';
import type { ChatApi } from './useChat';

type ChatTexts = Messages['chat'];
const stepLabel = (s: ChatStep, c: ChatTexts): string =>
  s.kind === 'sessions' ? c.step.sessions : s.kind === 'repo' ? c.step.repo(s.path ?? '') : c.step[s.kind](s.name ?? s.id ?? '');
const sourceLabel = (s: ChatStep, c: ChatTexts): string =>
  s.kind === 'sessions' ? c.source.sessions : s.kind === 'repo' ? c.source.repo(s.path ?? '') : c.source[s.kind](s.name ?? s.id ?? '');

function Inlines({ parts, onOpen }: { parts: Inline[]; onOpen: (id: string) => void }) {
  return <>{parts.map((p, i) =>
    p.kind === 'text' ? <Fragment key={i}>{p.text}</Fragment>
    : p.kind === 'strong' ? <strong key={i}>{p.text}</strong>
    : p.kind === 'code' ? <code key={i}>{p.text}</code>
    : <button key={i} type="button" className="ledge-inline-session" data-ledge-mention={p.id} onClick={() => onOpen(p.id)}>{p.name}</button>)}</>;
}

function Answer({ text, names, onOpen }: { text: string; names: ReadonlyMap<string, string>; onOpen: (id: string) => void }) {
  return (
    <div className="ledge-answer">
      {answerBlocks(text, names).map((b, i) =>
        b.kind === 'h' ? <h4 key={i}><Inlines parts={b.text} onOpen={onOpen} /></h4>
        : b.kind === 'ul' ? <ul key={i}>{b.items.map((it, j) => <li key={j}><Inlines parts={it} onOpen={onOpen} /></li>)}</ul>
        : <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inlines parts={l} onOpen={onOpen} /></Fragment>)}</p>)}
    </div>
  );
}

export interface ChatTurnProps { turn: ChatTurn; last: boolean; chat: ChatApi; sessions: readonly Session[]; machines: readonly MachineState[]; onOpenSession: (id: string) => void }

/** One question to Ledge and what came of it (spec §9.3; the island's ChatView): the steps while it reads, the answer as it comes,
 *  the machines to choose on a clarification (last turn only), the destination, the card, the sessions it mentions, its sources,
 *  and Cancel while it runs. Errors and cancellations are statuses, never alerts. */
export function ChatTurnView({ turn: tr, last, chat, sessions, machines, onOpenSession }: ChatTurnProps) {
  const { t, lang } = useI18n();
  const c = t.chat;
  const running = isRunning(tr);
  const live = running && chat.live?.qid === tr.qid ? hideProposal(chat.live.text) : '';
  const answer = tr.answer || live;
  const kind = cardKind(tr);
  const available = chat.available(tr.qid);
  const busy = chat.card?.qid === tr.qid;
  const disabled = !available || (chat.card !== null && !busy);
  const machineLabel = machines.find(m => m.id === tr.machineId)?.label ?? tr.machineName;
  const cardError = kind === 'launch' ? tr.proposal?.error : kind === 'relay' ? tr.relay?.error : undefined;
  const note = chat.note?.qid === tr.qid && chat.note.message !== cardError ? chat.note.message : null;
  const links = turnLinks(tr, sessions);
  const names = mentionable(tr, sessions);
  const find = (id: string | undefined) => (id ? sessions.find(s => s.id === id) : undefined);
  const sources = [...new Set(tr.steps.map(s => sourceLabel(s, c)))];
  const time = tr.answeredAt ? new Date(tr.answeredAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="ledge-turn" data-turn={tr.qid}>
      <article className="thread-message user"><div className="message-author">{t.conversation.thread.you}</div><p>{tr.question}</p></article>
      {tr.error === 'cancelled' ? <p className="thread-notice" role="status">{c.stopped}</p>
      : tr.error !== undefined ? <p className="thread-notice ledge-error" role="status">{c.error(tr.error)}</p>
      : (
        <article className="thread-message agent">
          <div className="message-author">{c.author}</div>
          {running && !answer && (
            <ul className="ledge-steps" aria-live="polite">
              {tr.steps.length === 0 ? <li>{c.thinking}</li>
                : tr.steps.map((s, i) => <li key={i} data-step={s.kind}>{i < tr.steps.length - 1 && <span aria-hidden="true">✓ </span>}{stepLabel(s, c)}</li>)}
            </ul>
          )}
          {answer && <Answer text={answer} names={names} onOpen={onOpenSession} />}
          {last && tr.choices && tr.choices.length > 0 && <>
            <div className="ledge-choices" role="group" aria-label={c.choices}>
              {tr.choices.map(ch => <button key={ch.id} type="button" className="settings-button" disabled={!chat.canAsk} onClick={() => chat.ask(c.choose(ch.label))}>{ch.label}</button>)}
            </div>
            <small className="ledge-clarification">{c.clarification}</small>
          </>}
          {kind && machineLabel && <p className="ledge-destination">{c.destination(machineLabel)}{!available && ` · ${c.unavailable}`}</p>}
          {kind === 'relay' && <RelayCard relay={tr.relay!} session={find(tr.relay!.id)} busy={busy} disabled={disabled} onSend={() => chat.relay(tr.qid)} onCancel={() => chat.relayCancel(tr.qid)} />}
          {kind === 'launch' && <LaunchCard proposal={tr.proposal!} session={find(tr.proposal!.launchedId)} busy={busy} disabled={disabled} onLaunch={() => chat.launch(tr.qid)} />}
          {note && <p className="ledge-card-error" role="status">{note}</p>}
          {links.length > 0 && (
            <div className="ledge-session-links" role="group" aria-label={c.links}>
              {links.map(l => <button key={l.id} type="button" data-ledge-session={l.id} disabled={!l.live} onClick={() => onOpenSession(l.id)}>{c.open(l.name)}<span aria-hidden="true"> ↗</span></button>)}
            </div>
          )}
          {tr.answeredAt && <small className="ledge-source">{c.sourcesLine(sources.length ? sources.join(', ') : c.sourcesNone, time)}</small>}
          {running && <button type="button" className="settings-button ledge-stop" aria-label={c.stopLabel} onClick={chat.cancel}>{c.stop}</button>}
        </article>
      )}
    </div>
  );
}
```

`Messages` est exporté par `src/i18n/lang.tsx` (ré-export de `messages.ts`) ; `c.step[s.kind]` et `c.source[s.kind]` pour `pane` / `reply` / `git` ont la même signature `(name: string) => string`.

- [ ] **Step 4: Implement the pane**

`apps/desktop/src/chat/ChatPane.tsx` :

```tsx
import { useState } from 'react';
import { groupSessions, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';
import { ComposerForm } from '../conversation/ComposerForm';
import { useReadingPosition } from '../conversation/useReadingPosition';
import type { Conversations } from '../conversation/useConversations';
import { ChatTurnView } from './ChatTurn';
import { CHAT_ID } from './turns';
import type { ChatApi } from './useChat';

const IDS = { form: 'ledge-chat-form', field: 'ledge-chat-reply', hint: 'ledge-reply-hint' };

export interface ChatPaneProps {
  chat: ChatApi;
  api: Pick<Conversations, 'draft' | 'setDraft' | 'pref' | 'setPref'>;
  sessions: readonly Session[];
  machines: readonly MachineState[];
  localDown: boolean;
  expanded: boolean;
  onExpand: (on: boolean) => void;
  onOpenSession: (id: string) => void;
}

/** « Parler à Ledge » (spec §9.3; mockup ledge-chat.js): the conversation pane without a session. Never `data-session` (views count
 *  those) nor `data-conversation` (the agents' pane). Draft and reading position under `ledge`, through the conversations' only writer. */
export function ChatPane(p: ChatPaneProps) {
  const { t } = useI18n();
  const c = t.chat;
  const theme = useTheme();
  const { chat } = p;
  const [refused, setRefused] = useState(false);
  const draft = p.api.draft(CHAT_ID);
  const lastTurn = chat.turns.at(-1);
  const tail = `${chat.turns.length}|${lastTurn?.qid ?? ''}|${lastTurn?.steps.length ?? 0}|${lastTurn?.answeredAt ?? lastTurn?.error ?? ''}|${chat.live?.text.length ?? 0}`;
  const { ref, onScroll } = useReadingPosition(CHAT_ID, p.api, true, tail);
  const lost = p.machines.filter(m => m.id !== 'local' && m.status === 'unreachable').map(m => m.label);
  const projects = groupSessions([...p.sessions]).length;
  const hint = p.localDown ? c.composer.readonly : refused ? c.composer.refused : chat.running ? c.composer.busy : c.composer.hint;
  const send = () => {
    if (chat.ask(draft)) { p.api.setDraft(CHAT_ID, ''); setRefused(false); } else setRefused(true);
  };

  return (
    <aside id="conversation-pane" className="detail conversation ledge-chat" data-ledge-chat aria-label={c.label}>
      <header className="conversation-header">
        <div className="conversation-top">
          <span>{c.eyebrow}</span>
          <button type="button" data-expand-conversation aria-expanded={p.expanded} onClick={() => p.onExpand(!p.expanded)}>{p.expanded ? t.conversation.collapse : t.conversation.expand}</button>
        </div>
        <div className="ledge-chat-identity">
          <span aria-hidden="true"><ResidentMascot size={40} theme={theme} frozen={p.localDown} gestureKey={chat.running?.steps.length} gestureKind="pulse" /></span>
          <div>
            <h3>Ledge<span>.</span></h3>
            <p>{c.identity(p.sessions.length, projects)}</p>
          </div>
          <button type="button" className="settings-button ledge-chat-reset" disabled={p.localDown || !!chat.running || !!chat.card || chat.turns.length === 0} onClick={chat.reset}>{c.reset}</button>
        </div>
        <p className="ledge-chat-purpose">{c.purpose}</p>
      </header>
      {p.localDown ? <div className="conversation-offline" role="status">{c.readonly}</div>
        : lost.length > 0 ? <div className="conversation-offline" role="status">{c.frozen(lost.join(', '))}</div> : null}
      <section ref={ref} className="thread-scroll" tabIndex={0} aria-label={c.thread} onScroll={onScroll}>
        <div className="thread-content">
          {chat.turns.length === 0 ? (
            <div className="ledge-chat-welcome">
              <span aria-hidden="true"><ResidentMascot size={64} theme={theme} frozen={p.localDown} /></span>
              <h3>{c.welcome.title}</h3>
              <p>{c.welcome.text}</p>
            </div>
          ) : chat.turns.map((tr, i) => (
            <ChatTurnView key={tr.qid} turn={tr} last={i === chat.turns.length - 1} chat={chat} sessions={p.sessions} machines={p.machines} onOpenSession={p.onOpenSession} />
          ))}
          <div className="ledge-starters" role="group" aria-label={c.starters.label}>
            {c.starters.items.map(s => <button key={s} type="button" disabled={!chat.canAsk} onClick={() => chat.ask(s)}>{s}</button>)}
          </div>
        </div>
      </section>
      <ComposerForm ids={IDS} label={c.composer.label} placeholder={c.composer.placeholder} send={c.composer.send} hint={hint}
        value={draft} frozen={p.localDown} canSend={chat.canAsk}
        onChange={text => { setRefused(false); p.api.setDraft(CHAT_ID, text); }} onSend={send} />
    </aside>
  );
}
```

Le `ref` de `useReadingPosition` est typé `RefObject<HTMLElement | null>` : si TypeScript le refuse sur `<section>`, appliquer la même correction qu'à la tâche 1 (`Thread`). `groupSessions` reçoit une copie (sa signature prend `Session[]`).

- [ ] **Step 5: Implement the styles**

Ajouter à la fin de `apps/desktop/src/styles/app.css` (valeurs de `ledge-chat.css` de la maquette ; les cartes reprennent les couleurs de l'île en jetons Desktop) :

```css
/* Talk to Ledge (spec §9.3; mockup ledge-chat.css) */
.ledge-chat-trigger { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--input); border-radius: 6px; background: var(--well); color: var(--sidebar-foreground); font-size: 11px; white-space: nowrap; }
.ledge-chat-trigger[aria-pressed="true"] { border-color: var(--sidebar-primary); background: var(--sidebar-accent); }
.ledge-chat-trigger:disabled { opacity: .5; cursor: not-allowed; }
.ledge-chat-identity { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
.ledge-chat-identity > div { flex: 1; min-width: 0; }
.ledge-chat-identity h3 { margin: 0 0 4px; }
.ledge-chat-identity h3 span { color: var(--sidebar-primary); }
.ledge-chat-identity p, .ledge-chat-purpose { margin: 0; font-size: 10px; line-height: 1.7; color: var(--muted-foreground); }
.ledge-chat-welcome { text-align: center; padding: 20px 0; }
.ledge-chat-welcome h3 { font-size: 17px; margin: 16px 0 8px; }
.ledge-chat-welcome p { font-size: 12px; margin: 0; color: var(--muted-foreground); }
.ledge-starters, .ledge-session-links { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.ledge-starters button, .ledge-session-links button { background: var(--well); border: 1px solid var(--sidebar-border); border-radius: 6px; text-align: left; padding: 10px 12px; font-size: 11px; color: var(--sidebar-foreground); }
.ledge-session-links button { color: var(--sidebar-primary); }
.ledge-starters button:disabled, .ledge-session-links button:disabled, .ledge-choices button:disabled { opacity: .5; cursor: not-allowed; }
.ledge-source { display: block; margin-top: 12px; font-size: 9px; line-height: 1.7; color: var(--muted-foreground); }
.ledge-answer p { white-space: normal; }
.ledge-answer ul { margin: 6px 0 0; padding-left: 18px; }
.ledge-answer h4 { margin: 10px 0 0; font-size: 12px; }
.ledge-answer code, .ledge-card code { font-size: 11px; background: var(--well); border-radius: 4px; padding: 0 4px; }
.ledge-inline-session { background: transparent; padding: 0; font: inherit; font-weight: 600; color: var(--sidebar-primary); text-decoration: underline; text-underline-offset: 2px; }
.ledge-steps { list-style: none; margin: 6px 0 0; padding: 0; font-size: 11px; line-height: 1.7; color: var(--muted-foreground); }
.ledge-choices { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.ledge-clarification { display: block; margin-top: 6px; font-size: 10px; color: var(--muted-foreground); }
.ledge-destination { margin: 12px 0 0; font-size: 10px; color: var(--muted-foreground); }
.ledge-stop { margin-top: 10px; }
.ledge-error { color: var(--warning); }
.ledge-card { margin-top: 10px; padding: 12px 14px; border: 1px solid var(--sidebar-border); border-radius: 9px; background: var(--well); font-size: 11px; }
.ledge-card dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; }
.ledge-card dt { color: var(--muted-foreground); }
.ledge-card dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.ledge-card blockquote { margin: 0; padding-left: 10px; border-left: 2px solid var(--sidebar-primary); }
.ledge-card-session { display: flex; align-items: center; gap: 8px; }
.ledge-card-session small { display: block; color: var(--muted-foreground); }
.ledge-card-muted { color: var(--muted-foreground); }
.ledge-card-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 12px; color: var(--muted-foreground); }
.ledge-card-done { display: flex; align-items: center; gap: 8px; margin: 0; }
.ledge-card-error { margin: 10px 0 0; font-size: 10px; color: var(--warning); }
.ledge-pill { margin-left: auto; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--sidebar-border); font-size: 9px; white-space: nowrap; }
.ledge-pill[data-pill="waiting"] { color: var(--warning); }
.ledge-pill[data-pill="stopped"] { color: var(--muted-foreground); }
.ledge-queued-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sidebar-primary); }
.workspace-empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 14px; }
.view-body > .central.ledge-chat-empty { display: flex; min-height: 0; }
```

Si `--warning` ou `--well` n'existent pas dans les jetons de `app.css`, prendre ceux qu'utilise `.conversation-offline` et `.thread-message.user` (lot 4).

- [ ] **Step 6: Run, expect PASS**

Run: `pnpm --filter desktop test chat-pane chat-cards use-chat && pnpm --filter desktop test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/chat/ChatTurn.tsx apps/desktop/src/chat/ChatPane.tsx apps/desktop/src/styles/app.css apps/desktop/test/chat-pane.test.tsx
git commit -m "feat(desktop): the chat pane with Ledge"
```

---

### Task 6: Shell : « Parler à Ledge » depuis la tête et l'espace vide

Le bouton « Parler à Ledge » (portrait 22 px immobile + texte, `aria-pressed` quand le chat est ouvert) se place dans la tête entre « À votre attention » et « Nouvelle session », et dans l'espace vide avant « Démarrer une session » (maquette `ledge-chat.js`, `app.js`). L'ouvrir sélectionne la pseudo-machine `ledge` (`desktop.selected = 'ledge'`, gardé par le réducteur et par `prune.ts`), met le panneau du chat à la place de la conversation et place le curseur dans `#ledge-chat-reply` (dans le fil quand le compositeur est figé). Sans aucune session, l'espace vide reste dans la colonne de gauche et le chat s'ouvre à côté. Un lien vers une session (ou une carte de la liste) quitte le chat pour la conversation de cette session, curseur dans sa réponse. « Nouvelle session » (tête, espace vide, tray) est désactivé tant qu'une action de carte attend sa réponse. Le mock daemon du fleet gagne `push` (additif, sans effet sur les tests existants du fleet ni de l'overlay).

**Files:**
- Create: `apps/desktop/src/chat/ChatTrigger.tsx`
- Modify: `apps/desktop/src/shell/Heading.tsx`, `apps/desktop/src/shell/EmptyWorkspace.tsx`, `apps/desktop/src/App.tsx` (Shell), `apps/desktop/src/state/drafts.ts` (commentaire l. 3)
- Modify: `packages/fleet/test/mockDaemon.ts` (`push`)
- Modify: `apps/desktop/test/team-view.test.tsx` (un test ajouté)
- Test: `apps/desktop/test/app-chat.test.tsx`

**Interfaces:**
- Consumes: `ChatPane` (tâche 5) ; `useChat`, `ChatApi` (tâche 3) ; `CHAT_ID` (tâche 2) ; `t.chat.trigger` (tâche 4) ; lot 5 dans `Shell` : `pick(id)`, `replyFor`, `canLaunch`, `openLaunch`, `launching`, `notices`, `trayNew` ; lot 4 : `SplitView({ panel, onPanel, list, pane, selectedId })`, `ConversationPane`, `useConversations` ; `createMockDaemon`, `fakeSession` (`@ledge/fleet/test/mockDaemon`).
- Produces :
  - `ChatTrigger({ open, onOpen, place }: { open: boolean; onOpen: () => void; place: 'heading' | 'empty' })` → `button.ledge-chat-trigger[data-open-ledge=place][aria-pressed=open]` ;
  - `Heading` prend `chat?: { open: boolean; onOpen: () => void }` (pas de bouton sans `chat`) ; `EmptyWorkspace` prend `chat?: { open: boolean; onOpen: () => void }` ;
  - mock daemon : `push(m: ServerMessage): void` (diffusé à tous les clients) ;
  - dans `Shell` : `chat: ChatApi`, `chatOpen: boolean`, `openChat(): void`, `openSession(id: string): void` (utilisés par la tâche 7 à travers le DOM seulement).

- [ ] **Step 1: Write the failing tests**

Dans `apps/desktop/test/team-view.test.tsx`, dans le `describe('Heading')`, ajouter :

```tsx
  it('Talk to Ledge sits before New session and says when the chat is open', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} chat={{ open: false, onOpen }} />);
    const trigger = screen.getByRole('button', { name: 'Talk to Ledge' });
    expect(trigger).toHaveAttribute('data-open-ledge', 'heading');
    expect(trigger).toHaveAttribute('aria-pressed', 'false');
    expect(trigger.nextElementSibling).toHaveTextContent('New session');
    await userEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledOnce();
    rerender(<Heading state={{ ...DEFAULT_VIEW, view: 'team' }} dispatch={vi.fn()} attentionCount={0} chat={{ open: true, onOpen }} />);
    expect(screen.getByRole('button', { name: 'Talk to Ledge' })).toHaveAttribute('aria-pressed', 'true');
  });
```

Dans `packages/fleet/test/mockDaemon.ts`, rien à tester seul : `push` est couvert par `app-chat.test.tsx` et la passe complète `pnpm --filter @ledge/fleet test` vérifie que l'ajout ne change rien.

`apps/desktop/test/app-chat.test.tsx` :

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { ClientMessage, Session } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { createDesktopFleet } from '../src/fleet/useFleet';
import { App } from '../src/App';

type Daemon = Awaited<ReturnType<typeof createMockDaemon>>;
const daemons: Daemon[] = [];
afterEach(async () => { cleanup(); for (const d of daemons.splice(0)) await d.close(); });

/** The real Desktop fleet against the mock daemon, one machine (local): `chat.ask` goes straight to it (no routing). */
async function boot(seed: { sessions?: Session[] } = {}) {
  localStorage.clear();
  localStorage.setItem('desktop.view', JSON.stringify({ view: 'team' }));
  const d = await createMockDaemon(); daemons.push(d);
  for (const s of seed.sessions ?? []) d.upsert(s);
  d.machines([{ id: 'local', label: 'Local' }]);
  render(<App client={createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket })} />);
  return d;
}
const sentOf = <K extends ClientMessage['type']>(d: Daemon, type: K) => d.received.filter((m): m is Extract<ClientMessage, { type: K }> => m.type === type);
const heading = () => document.querySelector<HTMLButtonElement>('[data-open-ledge="heading"]')!;
const reply = () => document.getElementById('ledge-chat-reply') as HTMLTextAreaElement;
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude' as const, prompt: 'Fix the build' };

describe('talking to Ledge from the Shell', () => {
  it('opens the chat, asks, follows the answer, starts the proposed session, then opens a mentioned session', async () => {
    const user = userEvent.setup();
    const d = await boot({ sessions: [fakeSession('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge' })] });
    await waitFor(() => expect(document.querySelector('[data-session="local:otto"]')).not.toBeNull());
    await user.click(heading());
    await waitFor(() => expect(reply()).toHaveFocus());
    expect(heading()).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-ledge-chat');
    await waitFor(() => expect(localStorage.getItem('desktop.selected')).toBe('ledge'));

    await user.type(reply(), 'Who needs me?');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(sentOf(d, 'chat.ask')).toHaveLength(1));
    const { qid } = sentOf(d, 'chat.ask')[0]!;
    expect(sentOf(d, 'chat.ask')[0]).toEqual({ type: 'chat.ask', qid, text: 'Who needs me?', tool: 'claude' });
    expect(reply()).toHaveValue('');

    d.push({ type: 'chat.step', qid, step: { kind: 'pane', id: 'otto', name: 'Otto' } });
    expect(await screen.findByText("Reads Otto's terminal")).toBeVisible();
    const at = new Date().toISOString();
    d.push({ type: 'chat.done', qid, text: '**Otto** waits for you.', at, proposal });
    const start = await screen.findByRole('button', { name: 'Start the session' });
    expect(screen.getByText('Destination: Local')).toBeVisible();

    await user.click(start);
    await waitFor(() => expect(sentOf(d, 'session.launch')).toEqual([{ type: 'session.launch', ...proposal, qid }]));
    expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    d.launched(fakeSession('ari', { name: 'Ari', project: 'ledge', cwd: '/w/ledge', state: 'working' }));
    d.push({ type: 'chat.history', turns: [{ qid, question: 'Who needs me?', askedAt: at, steps: [{ kind: 'pane', id: 'otto', name: 'Otto' }], answer: '**Otto** waits for you.', answeredAt: at, proposal: { ...proposal, launchedId: 'ari' } }] });
    expect(await screen.findByText('Ari has started')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'New session' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Open Ari' })).toBeEnabled();
    expect(localStorage.getItem('desktop.selected')).toBe('ledge');   // the card does not navigate

    await user.click(within(screen.getByRole('group', { name: 'Sessions mentioned' })).getByRole('button', { name: 'Open Otto' }));
    await waitFor(() => expect(document.querySelector('#conversation-pane')).toHaveAttribute('data-conversation', 'local:otto'));
    await waitFor(() => expect(document.getElementById('conversation-reply')).toHaveFocus());
    expect(heading()).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
  });

  it('the empty workspace offers Ledge too; the chat opens beside it', async () => {
    const user = userEvent.setup();
    const d = await boot();
    const empty = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('[data-open-ledge="empty"]'); expect(b).not.toBeNull(); return b!; });
    expect(empty.nextElementSibling).toHaveTextContent('Start a session');
    await user.click(empty);
    await waitFor(() => expect(reply()).toHaveFocus());
    expect(document.querySelector('.workspace-empty')).not.toBeNull();
    expect(document.querySelector('[data-open-ledge="empty"]')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Who needs me?' }));
    await waitFor(() => expect(sentOf(d, 'chat.ask').map(m => m.text)).toEqual(['Who needs me?']));
  });
});

// The local daemon never answers: everything is read-only (spec §6), the history with Ledge stays readable.
class DeadSocket { onopen = null; onmessage: unknown = null; onclose: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; readyState = 3; constructor(public url: string) { setTimeout(() => { this.onerror?.({}); this.onclose?.({ code: 1006 }); }, 0); } send() {} close() {} }
describe('the chat while the local daemon is down', () => {
  it('keeps the selection, the history and the draft, frozen, with one alert', async () => {
    localStorage.clear();
    const now = new Date().toISOString();
    localStorage.setItem('desktop.selected', 'ledge');
    localStorage.setItem('desktop.drafts', JSON.stringify({ ledge: 'Kept draft' }));
    localStorage.setItem('desktop.fleet.history', JSON.stringify({ day: now.slice(0, 10), turns: [{ qid: 'q1', machineId: 'local', machineName: 'Local', question: 'Who needs me?', askedAt: now, steps: [], answer: 'Nobody waits.', answeredAt: now }], bindings: [], resetAt: '' }));
    render(<App client={createDesktopFleet({ WebSocketImpl: DeadSocket })} />);
    await screen.findByText('Local daemon unreachable');
    expect(await screen.findByText('Nobody waits.')).toBeVisible();
    expect(reply()).toBeDisabled();
    expect(reply()).toHaveValue('Kept draft');
    for (const b of within(screen.getByRole('group', { name: 'Suggestions for Ledge' })).getAllByRole('button')) expect(b).toBeDisabled();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(heading()).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('desktop.selected')).toBe('ledge');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter desktop test app-chat team-view`
Expected: FAIL — `d.push is not a function`, pas de bouton « Talk to Ledge ».

- [ ] **Step 3: Implement**

**3a.** `packages/fleet/test/mockDaemon.ts`, dans l'objet retourné, après `refuse` :

```ts
    /** Any daemon message, to every client (the chat's steps, answers and history in Desktop's tests). */
    push(m: ServerMessage) { bc(m); },
```

**3b.** `apps/desktop/src/chat/ChatTrigger.tsx` :

```tsx
import { ResidentMascot } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';

/** « Parler à Ledge » (mockup ledge-chat.js, app.js): opens the chat, never closes it (choosing a session does). */
export function ChatTrigger({ open, onOpen, place }: { open: boolean; onOpen: () => void; place: 'heading' | 'empty' }) {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <button type="button" className="ledge-chat-trigger" data-open-ledge={place} aria-pressed={open} onClick={onOpen}>
      <span aria-hidden="true"><ResidentMascot size={22} theme={theme} paused /></span>{t.chat.trigger}
    </button>
  );
}
```

**3c.** `apps/desktop/src/shell/Heading.tsx` : la signature prend `chat?: { open: boolean; onOpen: () => void }` en plus de `onNewSession` (lot 5), le commentaire devient « … the toggle, the filter, Talk to Ledge and New session (disabled while read-only or while a chat card waits). », et entre le bouton `#attention` et le bouton « Nouvelle session » :

```tsx
      {chat && <ChatTrigger open={chat.open} onOpen={chat.onOpen} place="heading" />}
```

avec `import { ChatTrigger } from '../chat/ChatTrigger';`.

**3d.** `apps/desktop/src/shell/EmptyWorkspace.tsx` (état du lot 5 + le chat) :

```tsx
import { Bot, poseFor } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { ChatTrigger } from '../chat/ChatTrigger';
import { useTheme } from './theme';

/** No session on any machine, whatever the view (spec §9.1): talking to Ledge (spec §9.3) or a first launch (spec §9.2). */
export function EmptyWorkspace({ onNewSession, chat }: { onNewSession?: () => void; chat?: { open: boolean; onOpen: () => void } }) {
  const { t } = useI18n(); const theme = useTheme();
  return (
    <section className="workspace-empty">
      <Bot tool="claude" state="idle" pose={poseFor('empty', 'idle')} size={64} theme={theme} seed="empty" />
      <h3>{t.empty.title}</h3>
      <p>{t.empty.text}</p>
      <div className="workspace-empty-actions">
        {chat && <ChatTrigger open={chat.open} onOpen={chat.onOpen} place="empty" />}
        <button type="button" className="primary" data-open-launch="empty" disabled={!onNewSession} onClick={onNewSession}><span className="plus" aria-hidden="true">+</span>{t.empty.start}</button>
      </div>
    </section>
  );
}
```

**3e.** `apps/desktop/src/App.tsx` — lire le fichier réel (état du lot 5) avant de le modifier. Imports :

```ts
import { useChat } from './chat/useChat';
import { ChatPane } from './chat/ChatPane';
import { CHAT_ID } from './chat/turns';
```

Le commentaire de `selected` devient : `// The chat with Ledge (\`ledge\`) is not a session: its own pane (lot 6). A lost selection is replaced by the first visible session (lot 3 reducer).`

Dans `Shell`, juste après `const conversations = useConversations(…)`, ajouter :

```tsx
  const chat = useChat(fleetClient, fleet, machines, localDown);
  const chatOpen = state.selected === CHAT_ID;
```

Remplacer la ligne `const canLaunch = !localDown;` (lot 5) par :

```tsx
  // Read-only while the local daemon is down (spec §6); one action at a time: not while a chat card waits for its machine (decision 10).
  const canLaunch = !localDown && chat.card === null;
```

Après le bloc `wasLaunching` (lot 5), ajouter :

```tsx
  // Opening the chat puts the cursor in its composer once the pane is on screen, in its thread when the composer is frozen.
  const chatFocus = useRef(false);
  useEffect(() => {
    if (!chatFocus.current) return;
    const pane = document.querySelector<HTMLElement>('#conversation-pane[data-ledge-chat]');
    if (!pane) return;
    chatFocus.current = false;
    const field = document.getElementById('ledge-chat-reply') as HTMLTextAreaElement | null;
    (field && !field.disabled ? field : pane.querySelector<HTMLElement>('.thread-scroll'))?.focus({ preventScroll: true });
  });
  const openChat = () => { replyFor.current = null; chatFocus.current = true; dispatch({ type: 'select', id: CHAT_ID }); };
  // A session named by Ledge: its conversation, cursor in its reply (lot 5 focus effect); the attention filter goes off so it shows.
  const openSession = (id: string) => { dispatch({ type: 'attention', on: false }); pick(id); replyFor.current = id; };
  const chatEntry = { open: chatOpen, onOpen: openChat };
  const empty = (ready || localDown) && sessions.length === 0;
```

Le rendu (branche « pas d'écran de lancement ») devient :

```tsx
          <Heading state={state} dispatch={dispatch} attentionCount={sessions.filter(needsAttention).length} chat={chatEntry} onNewSession={canLaunch ? () => openLaunch('heading') : undefined} />
          {notices}
          {empty && !chatOpen && <EmptyWorkspace chat={chatEntry} onNewSession={canLaunch ? () => openLaunch('empty') : undefined} />}
          {(sessions.length > 0 || (empty && chatOpen)) && <SplitView panel={panel} onPanel={setPanel} selectedId={chatOpen ? CHAT_ID : selected?.id ?? null}
            list={sessions.length === 0
              ? <div className="central ledge-chat-empty"><EmptyWorkspace chat={chatEntry} onNewSession={canLaunch ? () => openLaunch('empty') : undefined} /></div>
              : <>
                {state.view === 'room' && <RoomView sessions={visible} grouping={state.grouping} selected={state.selected} onSelect={pick} onGrouping={grouping => dispatch({ type: 'grouping', grouping })} />}
                {state.view === 'team' && <TeamView sessions={visible} selected={state.selected} onSelect={pick} attentionOnly={state.attentionOnly} />}
              </>}
            pane={chatOpen
              ? <ChatPane chat={chat} api={conversations} sessions={sessions} machines={machines} localDown={localDown} expanded={panel.expanded} onExpand={on => setPanel(p => ({ ...p, expanded: on }))} onOpenSession={openSession} />
              : selected ? <ConversationPane session={selected} client={fleetClient} api={conversations} expanded={panel.expanded} onExpand={on => setPanel(p => ({ ...p, expanded: on }))} /> : null} />}
```

Si le `SplitView` du dépôt n'a plus `selectedId` (le lot 5 l'a peut-être retiré de l'appel), le remettre dans l'appel : la prop existe toujours dans `SplitView` (défilement vers le panneau en largeur étroite). Si `.view-body > .central` du lot 3 impose déjà `display:flex`, la règle `.ledge-chat-empty` de la tâche 5 ne change rien et reste sans effet.

**3f.** `apps/desktop/src/state/drafts.ts`, l. 3 : `/** One draft per qualified session id (spec §9.1), plus \`ledge\` for the chat with Ledge (spec §9.3). */`

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter desktop test && pnpm --filter @ledge/fleet test && pnpm --filter overlay test && pnpm -r typecheck`
Expected: PASS (dont `app-launch.test.tsx` du lot 5, `app.test.tsx` et les tests de la tête sans `chat`).

- [ ] **Step 5: Commit**

Deux commits, le mock d'abord :

```bash
git add packages/fleet/test/mockDaemon.ts
git commit -m "test(fleet): mock daemon pushes any server message"
git add apps/desktop/src/chat/ChatTrigger.tsx apps/desktop/src/shell/Heading.tsx apps/desktop/src/shell/EmptyWorkspace.tsx apps/desktop/src/App.tsx apps/desktop/src/state/drafts.ts apps/desktop/test/team-view.test.tsx apps/desktop/test/app-chat.test.tsx
git commit -m "feat(desktop): talk to Ledge from the heading and the empty workspace"
```

---

### Task 7: Parcours Playwright : un message au chat avec clarification

Les parcours de la spec §12/§13 dans le vrai Chromium, daemons simulés dans la page (`e2e/daemon.ts`, état du lot 5). Le daemon local annonce le routage (`snapshot.daemon.routing`), ce qui fait passer le fleet en coordination dès qu'il y a deux machines : `chat.route` avec le `RoutingContext`, `chat.routed` de clarification (boutons), puis `chat.routed` vers Devbox et `chat.ask` sur Devbox seulement. Trois parcours : (a) la clarification jusqu'à la carte, au lancement et au lien vers la nouvelle session ; (b) aucune session et Devbox hors ligne ; (c) brouillons séparés et lecture seule après rechargement.

**Files:**
- Modify: `apps/desktop/e2e/daemon.ts`
- Test: `apps/desktop/e2e/chat.spec.ts`

**Interfaces:**
- Consumes: tout ce qui précède ; `fakeDaemon` / `fakeRemote` du lot 5 (`received`, `push`, `launched`, `close`) ; `test`, `expect` de `e2e/fixtures.ts` (toute erreur console fait échouer).
- Produces (e2e) : `fakeDaemon(page, initial, extras: { machines?; launcher?; recents?; daemon?: DaemonInfo })` ; `export const ROUTING: DaemonInfo`.

- [ ] **Step 1: Extend the simulated daemon**

Dans `apps/desktop/e2e/daemon.ts` (lire le fichier réel, état du lot 5), importer `DaemonInfo` :

```ts
import type { ClientMessage, DaemonInfo, Machines, Recent, Session } from '@ledge/protocol';
```

Ajouter sous `T0` :

```ts
/** A local daemon that can route the chat between machines (spec 2026-10-14 §5.3): the fleet coordinates through it. */
export const ROUTING: DaemonInfo = { version: '0.6.0', install: 'npm', systemd: true, routing: true };
```

`fakeDaemon` prend `extras: { machines?: Machines; launcher?: string[]; recents?: Recent[]; daemon?: DaemonInfo } = {}` et son snapshot porte le daemon :

```ts
    ws.send(JSON.stringify({ type: 'snapshot', sessions: [...sessions.values()], ...(extras.launcher ? { launcher: extras.launcher } : {}), ...(extras.recents ? { recents: extras.recents } : {}), ...(extras.daemon ? { daemon: extras.daemon } : {}) }));
```

- [ ] **Step 2: Write the journeys**

`apps/desktop/e2e/chat.spec.ts` :

```ts
import { test, expect } from './fixtures';
import { fakeDaemon, fakeRemote, ROUTING, session } from './daemon';

type Msg = { type: string; [key: string]: unknown };
/** The n-th message of a type a simulated daemon received, once it arrived. */
async function nth(list: unknown[], type: string, n = 0): Promise<Msg> {
  const of = () => (list as Msg[]).filter(m => m.type === type);
  await expect.poll(() => of().length).toBeGreaterThan(n);
  return of()[n]!;
}
const twoMachines = [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }];
const proposal = { cwd: '/w/ledge', project: 'ledge', tool: 'claude', prompt: 'Fix the build' };

test('un message au chat avec clarification', async ({ page }) => {
  const local = await fakeDaemon(page, [session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge' })], { machines: twoMachines, daemon: ROUTING });
  const devbox = await fakeRemote(page, 'devbox', [session('pim', { name: 'Pim', project: 'ledge', cwd: '/w/ledge' })]);
  await page.goto('/');
  await expect(page.locator('[data-session="devbox:pim"]')).toBeVisible();

  // Open the chat from the heading: the cursor is in its composer.
  const trigger = page.locator('[data-open-ledge="heading"]');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  const pane = page.locator('#conversation-pane[data-ledge-chat]');
  await expect(pane.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  const reply = page.locator('#ledge-chat-reply');
  await expect(reply).toBeFocused();

  // The question goes to the coordinator with the fleet's inventory; the draft is cleared.
  await reply.fill('Fix the build');
  await reply.press('Control+Enter');
  const first = await nth(local.received, 'chat.route');
  expect(first).toMatchObject({ text: 'Fix the build', tool: 'claude', context: { history: [] } });
  expect((first.context as { machines: { id: string; online: boolean }[] }).machines.map(m => [m.id, m.online])).toEqual([['local', true], ['devbox', true]]);
  await expect(reply).toHaveValue('');
  expect(devbox.received.filter(m => m.type === 'chat.ask')).toEqual([]);

  // Clarification: the machines as buttons, writing stays possible.
  local.push({ type: 'chat.routed', qid: first.qid, result: { machineId: null, text: 'Which machine?', choices: ['local', 'devbox'] } });
  const choices = pane.getByRole('group', { name: 'Suggested machines' });
  await expect(choices.getByRole('button')).toHaveText(['Local', 'Devbox']);
  await expect(pane.getByText('You can also answer in writing.')).toBeVisible();
  await choices.getByRole('button', { name: 'Devbox' }).click();

  // The choice is a new question; the coordinator sees the clarification in the history and sends it to Devbox.
  const second = await nth(local.received, 'chat.route', 1);
  expect(second).toMatchObject({ text: 'On Devbox.', context: { history: [{ question: 'Fix the build', answer: 'Which machine?' }] } });
  await expect(pane.getByRole('group', { name: 'Suggested machines' })).toHaveCount(0);
  local.push({ type: 'chat.routed', qid: second.qid, result: { machineId: 'devbox', text: 'On Devbox.' } });
  const ask = await nth(devbox.received, 'chat.ask');
  expect(ask).toEqual({ type: 'chat.ask', qid: second.qid, text: 'On Devbox.', tool: 'claude' });
  expect(local.received.filter(m => m.type === 'chat.ask')).toEqual([]);

  // Devbox reads, then answers with a proposal.
  devbox.push({ type: 'chat.step', qid: ask.qid, step: { kind: 'pane', id: 'pim', name: 'Pim' } });
  await expect(pane.getByText("Reads Pim's terminal")).toBeVisible();
  await expect(pane.getByRole('button', { name: 'Cancel the current question' })).toBeVisible();
  const at = new Date().toISOString();
  devbox.push({ type: 'chat.done', qid: ask.qid, text: '**Pim** broke the build. Start a session to fix it.', at, proposal });
  await expect(pane.getByRole('button', { name: 'Cancel the current question' })).toHaveCount(0);
  await expect(pane.getByRole('region', { name: 'Proposed session' })).toBeVisible();
  await expect(pane.getByText('Destination: Devbox')).toBeVisible();
  await expect(pane.locator('[data-ledge-mention="devbox:pim"]')).toHaveText('Pim');
  await expect(pane.getByRole('group', { name: 'Sessions mentioned' }).getByRole('button', { name: 'Open Pim' })).toBeEnabled();

  // The card starts the session on Devbox only; New session waits meanwhile.
  await pane.getByRole('button', { name: 'Start the session' }).click();
  expect(await nth(devbox.received, 'session.launch')).toEqual({ type: 'session.launch', ...proposal, qid: ask.qid });
  expect(local.received.filter(m => m.type === 'session.launch')).toEqual([]);
  await expect(page.getByRole('button', { name: 'New session' })).toBeDisabled();
  devbox.launched(session('ari', { name: 'Ari', project: 'ledge', cwd: '/w/ledge', state: 'working' }));
  devbox.push({ type: 'chat.history', turns: [{ qid: ask.qid, question: 'On Devbox.', askedAt: at, steps: [{ kind: 'pane', id: 'pim', name: 'Pim' }], answer: '**Pim** broke the build. Start a session to fix it.', answeredAt: at, proposal: { ...proposal, launchedId: 'ari' } }] });
  await expect(pane.getByText('Ari has started')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New session' })).toBeEnabled();
  await expect(trigger).toHaveAttribute('aria-pressed', 'true');   // the card does not navigate

  // A link opens the new session's conversation, cursor in its reply.
  await pane.getByRole('group', { name: 'Sessions mentioned' }).getByRole('button', { name: 'Open Ari' }).click();
  await expect(page.locator('#conversation-pane')).toHaveAttribute('data-conversation', 'devbox:ari');
  await expect(page.locator('#conversation-reply')).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-pressed', 'false');
});

test('no session and Devbox offline: Ledge still answers, a new conversation starts over', async ({ page }) => {
  const local = await fakeDaemon(page, [], { machines: twoMachines, daemon: ROUTING });
  const devbox = await fakeRemote(page, 'devbox', []);
  devbox.close();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();
  await page.locator('[data-open-ledge="empty"]').click();
  const pane = page.locator('#conversation-pane[data-ledge-chat]');
  await expect(pane).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your team starts here' })).toBeVisible();   // the empty workspace stays beside the chat
  await expect(pane.getByRole('status').filter({ hasText: 'Devbox: connection lost.' })).toBeVisible();

  await pane.getByRole('group', { name: 'Suggestions for Ledge' }).getByRole('button', { name: 'Who needs me?' }).click();
  const route = await nth(local.received, 'chat.route');
  expect(route.text).toBe('Who needs me?');
  expect((route.context as { machines: { id: string; online: boolean }[] }).machines.map(m => [m.id, m.online])).toEqual([['local', true], ['devbox', false]]);
  local.push({ type: 'chat.routed', qid: route.qid, result: { machineId: 'local', text: 'Who needs me?' } });
  const ask = await nth(local.received, 'chat.ask');
  local.push({ type: 'chat.done', qid: ask.qid, text: 'Nobody waits for you.', at: new Date().toISOString() });
  await expect(pane.getByText('Nobody waits for you.')).toBeVisible();
  await expect(pane.locator('.ledge-source')).toContainText('Sources: nothing read');

  // The window never scrolls as a page (spec §12).
  expect(await page.evaluate(() => [document.documentElement.scrollHeight <= window.innerHeight, document.documentElement.scrollWidth <= window.innerWidth])).toEqual([true, true]);

  await pane.getByRole('button', { name: 'New conversation' }).click();
  await nth(local.received, 'chat.reset');
  await expect(pane.getByRole('heading', { name: 'What do you need?' })).toBeVisible();
  await expect(pane.getByText('Nobody waits for you.')).toHaveCount(0);
});

test('the chat and an agent keep their own drafts; read-only after a reload without the daemon', async ({ page }) => {
  const local = await fakeDaemon(page, [session('bix', { name: 'Bix', project: 'ledge', cwd: '/w/ledge', state: 'idle' })]);
  await page.goto('/');
  await page.locator('[data-session="local:bix"]').click();
  await page.locator('#conversation-reply').fill('For Bix');

  await page.locator('[data-open-ledge="heading"]').click();
  const reply = page.locator('#ledge-chat-reply');
  await expect(reply).toBeFocused();
  await reply.fill('Who needs me?');
  await reply.press('Control+Enter');
  const ask = await nth(local.received, 'chat.ask');
  local.push({ type: 'chat.done', qid: ask.qid, text: 'Nobody waits.', at: new Date().toISOString() });
  await expect(page.getByText('Nobody waits.')).toBeVisible();
  await reply.fill('Kept for later');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('desktop.drafts') ?? '{}'))).toEqual({ 'local:bix': 'For Bix', ledge: 'Kept for later' });

  local.close();
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(1);
  const pane = page.locator('#conversation-pane[data-ledge-chat]');
  await expect(pane.getByText('Nobody waits.')).toBeVisible();
  await expect(reply).toBeDisabled();
  await expect(reply).toHaveValue('Kept for later');
  await expect(pane.getByRole('group', { name: 'Suggestions for Ledge' }).getByRole('button', { name: 'Who needs me?' })).toBeDisabled();
  await expect(pane.getByRole('status').filter({ hasText: 'The history with Ledge stays readable.' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('desktop.drafts') ?? '{}')['local:bix'])).toBe('For Bix');
});
```

- [ ] **Step 3: Run, expect PASS**

Run: `pnpm --filter desktop exec playwright test chat.spec.ts && pnpm --filter desktop exec playwright test`
Expected: PASS (les parcours des lots 3 à 5 compris). Si un parcours échoue, corriger le code de l'application, jamais le parcours, sauf faute de frappe dans un sélecteur.

- [ ] **Step 4: Final gates**

Run: `pnpm -r typecheck && pnpm --filter desktop test && pnpm --filter @ledge/fleet test && pnpm --filter overlay test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/e2e/daemon.ts apps/desktop/e2e/chat.spec.ts
git commit -m "test(desktop): talk to Ledge journeys"
```
