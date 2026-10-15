# Suivi natif des sessions — fil, actions, fichiers, sous-agents

Date : 2026-10-13 · Projet personnel, hors story Jira · Auteur : Joffrey Desantoine

Maquette confirmée : `docs/mockups/ledge-native-sessions.html?reply=card` (variante **B · Carte** avec le champ de
réponse dans la carte). Captures : `docs/mockups/ledge-native-variant-b*.png`, `ledge-native-thread-*.png`.

## 1. Objectif

Aujourd'hui l'overlay montre d'une session son état, sa demande en attente, sa dernière réponse et un aperçu de
l'écran du terminal. Il ne montre pas ce que l'agent a fait : ni la consigne, ni les commandes, ni les fichiers
touchés, ni ce que font ses sous-agents. Le suivi natif remplace cette lecture d'écran par **un fil par session**,
construit à partir des faits que les harnais transmettent (hooks) et de leurs transcripts.

**Succès**
- En ouvrant une session, je lis le tour en cours : ma consigne, les messages de l'agent, chaque action en ligne
  dépliable avec son entrée et son résultat, et sous l'action les fichiers qu'elle a modifiés.
- Les tours précédents restent lisibles, repliés, dans l'ordre.
- Les sous-agents restent sous le titre, une ligne par agent avec `├`/`└`, et chaque ligne s'ouvre dans une vue
  dédiée : consigne, messages, actions, rapport final. La flèche de retour retrouve le fil principal là où je l'avais
  laissé.
- La dernière réponse reste la carte structurée d'aujourd'hui, avec le champ de réponse **dans** la carte
  (options, champ libre, « Envoyer la réponse → »). Le compositeur du bas reste.
- Une information absente est affichée comme telle (« Aucun résultat dans cette source », « Durée indisponible »),
  jamais devinée.
- Le fil survit au redémarrage du daemon et à la reconnexion de l'overlay.

**Décisions (prises avec la maquette)**
- Lignes simples empilées, sans compteurs nulle part (ni « 3 actions », ni « 2 questions », ni « · 4 » dans les
  kickers de la carte).
- La discussion d'un sous-agent s'ouvre dans une autre vue, pas dans le fil.
- Les fichiers se placent sous l'action qui les a modifiés, pas dans une section à part.
- Une session `hook_only` reste en lecture seule : le fil se lit, rien ne s'envoie.
- 14 octobre 2026 : les appels d'outils du tour courant ne sont plus des lignes dépliables mais une seule « ligne
  vivante » (spinner, outil, cible abrégée, durée ; ✓/✕ tenu 500 ms à la fin) ; requête et résultat d'un appel ne sont
  plus consultables dans le fil (voir `docs/ideas/2026-10-14-tools-display-mockups.md`).

**Hors périmètre**
- Le coût en tokens et l'usage (le harnais ne le transmet pas aux hooks).
- Les messages intermédiaires de Cursor (son transcript n'en contient pas) : le fil le dit.
- La relecture d'un transcript complet depuis le début d'une session ancienne : seul le tail est lu.
- L'édition d'un fichier depuis le fil.

## 2. Sources et limites par harnais

| Fait | Claude Code | Codex | Cursor |
|---|---|---|---|
| Consigne | hook `UserPromptSubmit.prompt` | idem | hook `beforeSubmitPrompt` |
| Appel d'outil (entrée) | `PreToolUse.tool_input` + `tool_use_id` | idem | `preToolUse` |
| Résultat, durée | `PostToolUse.tool_response`, `duration_ms` | `tool_response` (pas de durée) | `postToolUse` (pas de résultat ni de durée) |
| Échec | `PostToolUseFailure.error` | — | `postToolUseFailure` |
| Permission + décision | `PermissionRequest` puis `Decided` (daemon) | idem | — |
| Message de l'agent | transcript `assistant` → blocs `text` | rollout `item_completed` `AgentMessage` | indisponible |
| Fin de tour | `Stop.last_assistant_message` | idem | `afterAgentResponse` |
| Sous-agent | `SubagentStart/Stop` (`agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`) | idem | Task → `CURSOR_TRANSCRIPT_PATH` |

Règles : le hook reste sous son budget (100 ms) et **ne lit aucun transcript** ; il transmet les chemins
(`transcript_path`, `agent_transcript_path`) et le daemon lit les tails. Les textes sont plafonnés (24 000
caractères pour un résultat ou un rapport, 8 000 par chaîne d'entrée).

## 3. Modèle : le fil (`ThreadItem`)

Un fil est une liste ordonnée d'éléments, chacun avec `id`, `at`, `turn` (numéro du tour, `0` avant la première
consigne) et `helperId` optionnel (élément d'un sous-agent).

| `kind` | Champs | Origine |
|---|---|---|
| `prompt` | `text` | `UserPromptSubmit` |
| `message` | `text` | transcript (texte de l'agent entre deux actions) |
| `tool` | `tool`, `label`, `input?`, `output?`, `error?`, `status` (`running`/`success`/`failed`/`unknown`), `durationMs?`, `files[]` | `PreToolUse` → `PostToolUse`/`PostToolUseFailure` |
| `permission` | `tool`, `text`, `decision?` | `PermissionRequest` → `Decided` |
| `reply` | `text` | `Stop` (tour) ou `SubagentStop` (rapport, avec `helperId`) |
| `helper` | `task`, `agentType?`, `state` (`working`/`exited`) | `SubagentStart` → `SubagentStop` |

Un élément `tool` est mis à jour en place (même `id` = `tool_use_id`) quand son résultat arrive. Sans `tool_use_id`
(Cursor), le résultat rejoint la dernière action en cours du même outil. Un fichier sous une action vient de son
entrée (`Write`, `Edit`, `MultiEdit`, `NotebookEdit` de Claude, `apply_patch` de Codex) ; il est « confirmé » quand
l'action a réussi, « écriture non confirmée » sinon.

## 4. Daemon

- `History` (`packages/ledge/src/daemon/history.ts`) : un fil par session, en mémoire, journalisé en JSONL dans
  `~/.ledge/history/<sessionId>.jsonl` (une ligne par création ou mise à jour, dernière ligne gagnante au chargement,
  400 éléments gardés par session). `forget(id)` quand la session est retirée.
- `Store.onEvent` : le store notifie chaque événement appliqué ; c'est le seul point d'entrée de l'historique, qui
  reçoit donc aussi les `Decided` émis par le daemon.
- `transcript.ts` : lecture du tail (512 Ko) d'un transcript Claude ou d'un rollout Codex, qui rend les messages de
  l'agent avec leur identifiant source ; l'historique les insère sans doublon, au plus une lecture par seconde et par
  session, sur `PreToolUse`, `PermissionRequest`, `Stop` et `SubagentStop`.

## 5. Protocole (tout additif, champs optionnels)

| Message | Sens | Contenu |
|---|---|---|
| `session.event` | hook → daemon | événements enrichis : `toolUseId`, `toolInput`, `output`, `durationMs`, `error`, `transcriptPath` |
| `session.thread` | overlay → daemon | `{ id }` : demande le fil d'une session |
| `session.thread` | daemon → overlay | `{ id, items }` : le fil complet |
| `session.thread.item` | daemon → overlay | `{ id, item }` : un élément créé ou mis à jour, diffusé à tous |

Le `snapshot` ne porte pas les fils (ils peuvent être lourds) : l'overlay demande le fil quand il ouvre une session
et oublie les fils reçus à chaque nouveau snapshot.

## 6. Overlay

- **Fil** (`surface/Thread.tsx`) dans la vue session, sous l'arbre des sous-agents : tours précédents repliés
  (`<details>` « Tour précédent · heure »), puis le tour en cours : consigne (« Vous »), messages de l'agent (bot +
  nom), actions en `<details data-action>` (icône ✓ / ! / ◌, libellé, détail, chevron ; déplié : « Commande » ou
  « Paramètres » en `pre`, « Résultat » ou « Erreur » en `pre`, sinon « Aucun résultat dans cette source », bas de
  ligne « Résultat reçu » / « Échec » / « En attente du résultat » + durée ou « Durée indisponible »),
  fichiers sous leur action en `<details data-file>` (chemin mono, état, diff), permissions avec leur décision. Pour
  Cursor, une note : « Cette source ne transmet ni résultats ni messages intermédiaires. »
- **Sous-agents** : l'arbre existant devient cliquable (`<button data-helper>`), montre les sous-agents du tour en
  cours, terminés compris (« Terminé »), avec un `›` à droite. Un clic ouvre la **vue sous-agent** (mode `helper`) :
  ligne de retour « ← <parent> · Discussion principale », identité « Délégué par <parent> » et état, consigne en tête,
  puis messages, actions et la carte compacte « RAPPORT FINAL ». Retour par la flèche ou Échap ; la vue session reste
  montée, donc sa position de lecture est conservée.
- **Dernière réponse** : la carte garde ses sections ; quand elle contient des questions, un formulaire en bas de
  carte propose les options (puces existantes), un champ libre « Ou proposez autre chose… », l'indice « Une puce
  remplit le champ, Entrée envoie » et « Envoyer la réponse → ». L'envoi passe par `session.reply` comme le compositeur.
  Absent en lecture seule.
- **Suppressions** : « n terminés · n questions » sous le titre et « · n » dans les kickers de la carte.
- Textes FR/EN dans `messages.ts` (`thread.*`), capture d'écran `docs/screens/thread.png` et `helper.png`,
  README : nouvelles sections Protocol et Session model.
