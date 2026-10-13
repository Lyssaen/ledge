# Lancer une session depuis le chat Ledge — design

Date : 2026-10-12 · Projet personnel, hors story Jira · Auteur : Guillaume Charlier avec Claude Code

Maquette validée : https://claude.ai/artifact/8D2JZ2u5gXRxRNik8UdbDX, copie locale [docs/mockups/ledge-launch-from-chat.html](../../mockups/ledge-launch-from-chat.html). Quatre états du chat en sombre : proposition, dossier ambigu, session lancée, échec.

S'appuie sur la [spec du lancement](2026-10-10-launch-from-ledge-design.md) (`session.launch`, `spawnSession`, l'onglet du terminal) et sur celle [des sessions et du chat](2026-10-11-sessions-identity-and-chat-design.md) (section 5). Tout ce que cette spec ne mentionne pas reste tel que ces deux specs le décrivent.

## 1. Objectif

Aujourd'hui une session se lance depuis un terminal (`ledge claude`) ou depuis le formulaire `+` de la liste. L'utilisateur doit pouvoir la demander au chat, en langage naturel : « ouvre une session dans ledge pour corriger le build ». Ledge déduit le dossier, prend le harnais par défaut, et propose une carte que l'utilisateur confirme d'un clic.

Succès :

- Une demande de session dont le dossier est sûr produit, sous la réponse, une carte « Dossier · Harnais · Instruction · [Lancer la session] ».
- Une demande dont le dossier n'est pas sûr produit une question (« Dans quel dossier ? » avec les candidats), jamais une carte devinée.
- Le clic sur Lancer crée une session `launcher` ordinaire, identique à celle du formulaire. La carte devient « Otto a démarré · Terminal » et ne peut plus lancer une seconde fois, même après une reconnexion ou depuis un autre overlay.
- Le chat lui-même ne lance rien : il propose, le clic de l'utilisateur lance.

Décisions prises pendant le cadrage :

- Déclenchement en langage naturel uniquement : pas de commande `/session`.
- Pas de dossier par défaut ni de bac à sable : le dossier est toujours déduit de la phrase, sinon demandé.
- Harnais : le harnais par défaut des réglages, celui que `chat.ask` porte déjà.
- Confirmation par une carte ; aucun lancement direct.

Hors périmètre : relayer une instruction à une session existante (toujours V2 de la spec du chat), choisir le nom du compagnon, `--continue`, modifier la carte avant de lancer (on reformule la demande à la place), profils de lancement enregistrés.

## 2. Le principe de lecture seule

La spec du chat pose « Tu lis, tu ne touches à rien » et « Tu ne proposes jamais d'agir à la place de l'utilisateur ». Le harnais du chat reste lancé en lecture seule (`claude -p --restricted` avec `Read,Grep,Glob`, `codex exec --sandbox read-only`, `cursor-agent -p --mode ask`) : il n'obtient aucun outil nouveau. Le persona autorise les commandes en lecture seule (Codex ne lit que par son shell, sous `--sandbox read-only`) ; la lecture seule est garantie par les drapeaux de chaque harnais, pas par le persona (commit 9f7e447). Ce qui change est seulement son droit d'**écrire une proposition** dans sa réponse. Le lancement passe par le `session.launch` existant, envoyé par l'overlay au clic. La seconde phrase du persona est remplacée par la règle de la section 4.

## 3. Le bloc de proposition

Le harnais termine sa réponse par un bloc de code dont la langue est `ledge-session`, contenant un objet JSON :

````
```ledge-session
{"cwd": "/home/gch/development/github.com/Paradow-dev/ledge", "prompt": "Corrige le build de l'overlay"}
```
````

- `cwd` : obligatoire, chemin absolu WSL (`~` accepté).
- `prompt` : facultatif ; absent ou vide, la session démarre sans instruction.

Le texte fonctionne à l'identique pour les trois harnais ; aucun outil MCP, aucun second appel de classification.

## 4. Daemon

- **`chat/proposal.ts`** (nouveau, pur) : `extractProposal(answer)` trouve le dernier bloc ` ```ledge-session `, le retire du texte et renvoie `{ text, raw }` (`raw` : le JSON brut, ou `null`). Tous les blocs `ledge-session` sont retirés du texte affiché, seul le dernier compte. Un bloc dont le JSON ne passe pas le schéma est retiré et ignoré, avec une ligne dans `daemon.log`.
- **`PERSONA`** (`chat/claude.ts`, partagé par les trois harnais) : « Tu ne proposes jamais d'agir à la place de l'utilisateur ; tu peux lui dire quel bot ouvrir. » devient : « Tu n'agis jamais toi-même ; tu peux lui dire quel bot ouvrir. Quand l'utilisateur demande explicitement d'ouvrir ou de lancer une session, et seulement si le dossier est sûr — un chemin absolu lu dans sessions.md ou folders.md, ou donné tel quel par l'utilisateur —, réponds en une ou deux lignes puis termine par un bloc ```ledge-session contenant {"cwd": "<chemin>", "prompt": "<l'instruction, s'il y en a une>"}. Si plusieurs dossiers conviennent ou aucun, ne mets pas de bloc : cite les candidats et demande lequel. » et la liste des sources mentionne `folders.md`.
- **`chat/context.ts`** : `writeContext` écrit en plus `folders.md`, les dossiers récents du store (`store.recents()` : nom du projet, chemin, dernière utilisation), le plus récent en tête.
- **`chat/service.ts`**, en fin de tour réussi : `extractProposal` sur la réponse ; la réponse gardée et envoyée dans `chat.done` est le texte sans bloc. Si un bloc valide existe, `resolveFolder(cwd)` : si le dossier n'existe pas, pas de carte (ligne de log) ; sinon `turn.proposal = { cwd: <résolu>, project: basename, prompt?, tool: <le tool de la question> }`, joint à `chat.done`.
- **`chat/service.ts`**, nouvelles méthodes de `Chat` : `proposal(qid)` (la proposition du tour, si elle existe dans l'historique du jour), `markLaunched(qid, id)` (pose `launchedId`, efface `error`), `markFailed(qid, message)` (pose `error`). Chacune émet `chat.history` à tous les clients.
- **`daemon/server.ts`**, `session.launch` avec `qid` : le tour doit exister et porter une proposition sans `launchedId`, sinon `error` (« déjà lancée » ou « proposition introuvable »). `tool`, `cwd` et `prompt` sont ceux de la proposition (le daemon ne fait pas confiance aux champs du message pour ce cas). Succès : `session.launched` au demandeur comme aujourd'hui, puis `markLaunched`. Échec : `error` au demandeur comme aujourd'hui, puis `markFailed`.
- Une proposition vit avec son tour : un `chat.reset` ou un nouveau jour l'emporte avec l'historique.

## 5. Protocole

| Message | Changement |
| --- | --- |
| `ChatTurn` | `proposal?: { cwd, project, prompt?, tool, launchedId?, error? }` |
| `chat.done { qid, text, at }` | `proposal?` (le même objet, sans `launchedId` ni `error`) |
| `session.launch { tool, cwd, name?, prompt?, continue? }` | `qid?` : le lancement de la carte de ce tour |

Les champs sont tous facultatifs : un overlay ou un daemon plus ancien les ignore.

## 6. Overlay

- **`LaunchCard.tsx`** (nouveau), rendue sous la réponse dans `ChatView`, avant les sources. Trois états, comme la maquette :
  - **proposition** : Dossier (nom du projet en gras, chemin en mono), Harnais (« Claude Code · par défaut »), Instruction (ou « Aucune, session vide »), pied « [▶ Lancer la session] ou reformule ta demande » ;
  - **lancée** (`launchedId`) : le compagnon, « **Otto** a démarré », le nom étant le lien `ledge://session/<id>` existant, et un bouton Terminal ;
  - **échec** (`error`) : le message du daemon dans une bande `role="alert"`, pied « [Réessayer] ou donne-moi un autre dossier ».
- **`Surface.tsx`** : Lancer et Réessayer envoient `session.launch { tool, cwd, prompt, qid }` avec les champs de la proposition. On reste dans le chat (pas de retour à la liste ni de bandeau). Sur `session.launched`, l'onglet Windows Terminal s'ouvre si l'option mémorisée du formulaire est cochée (`ledge.launch.openTab`, lue par un helper partagé avec `LaunchView`). Le bouton est désactivé pendant le lancement et quand le daemon est injoignable.
- **Streaming** : pendant les `chat.delta`, un bloc ` ```ledge-session ` (fermé ou non) est masqué du texte affiché, pour ne jamais montrer de JSON brut ; fonction pure partagée avec le rendu de la réponse.
- Textes FR/EN dans `i18n/messages.ts`. L'aide mentionne qu'on peut demander une session au chat.

## 7. Erreurs

| Situation | Effet |
| --- | --- |
| Pas de bloc, ou bloc mal formé | La réponse texte s'affiche, sans carte. |
| Dossier proposé inexistant au moment de la réponse | Pas de carte ; ligne de log. |
| Dossier disparu ou tmux en échec au moment du clic | La carte passe en échec, avec Réessayer. |
| Double clic, deux overlays, carte déjà lancée | Le daemon refuse ; la carte affiche l'état lancé que diffuse `chat.history`. |
| Daemon injoignable | Lancer désactivé, comme le `+`. |

## 8. Tests

- Protocole : les nouveaux champs se valident ; les anciens messages aussi.
- `extractProposal` : pas de bloc, bloc valide, JSON invalide, champ manquant, plusieurs blocs, texte après le bloc, bloc non fermé.
- `service` : `folders.md` écrit ; proposition valide jointe à `chat.done` et au tour ; dossier inexistant rejeté ; texte sans bloc ; `markLaunched` / `markFailed` émettent `chat.history`.
- `server` : `session.launch` avec `qid` utilise les champs de la proposition, marque le tour, refuse un second lancement et une proposition inconnue, marque l'échec.
- Overlay : masquage pendant le streaming ; `LaunchCard` dans ses trois états ; la surface envoie le bon `session.launch`, reste dans le chat, ouvre l'onglet selon l'option.
- Playwright : un tour avec proposition, Lancer, état lancé ; un tour en échec puis Réessayer.
- Vérification manuelle avec chacun des trois harnais (Claude Code, Codex, Cursor Agent) : une demande au dossier sûr produit une carte, une demande ambiguë produit une question, une question ordinaire n'en produit jamais. C'est le risque principal : les tests couvrent le parsing, pas le respect du format par chaque modèle.
