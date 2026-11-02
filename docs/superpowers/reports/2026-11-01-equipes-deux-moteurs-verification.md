# Équipes à deux moteurs : mesures de bout en bout

Mesures faites le 2 novembre 2026 sur le laptop (WSL). Le daemon de la branche `feat/teams-two-engines` (3aed7c4e, 0.33.0) est installé globalement. OpenRig est en 0.6.14 et legion reste en version stable.

## Scénario (spec §6.7)

Une équipe de deux sièges dans un petit dépôt de test (`calc.py`), avec le même objectif pour les deux moteurs : « Ajoute un README.md qui décrit calc.py, fais-le relire par le relecteur, puis commite-le ». Le critère de fin est « README.md commité et relu ».

- **Ledge** : `ledge team up --seat leader --seat review:codex --goal … --done …`. Les rôles du dépôt sont `leader` (claude) et `review` (codex), tous deux en autonomie `auto`.
- **OpenRig** : `rig up starter --cwd …`, avec `dev-build` (claude) et `dev-review` (codex). L'objectif est déposé dans la file de `dev-build@starter`. La spec n'a pas de politique de permissions, donc OpenRig tourne en posture « floor ».

## Résultats

| | Moteur Ledge | Moteur OpenRig |
|---|---|---|
| Objectif donné | au lancement, 08:10:02 | file, 08:16:49 |
| Première action du lead (prise de l'objectif) | 08:10:49, soit 47 s après le lancement dont 39 s d'attente de la confiance du dossier, et 8 s après la confiance | 08:16:54, soit 5 s après le dépôt |
| Relecture confiée au relecteur | 08:10:59 | 08:17:45 |
| Relecture rendue | 08:11:21 (« OK ») | 08:18:48 |
| Objectif terminé, README commité | 08:11:25, **84 s** après le lancement | 08:19:05, **2 min 16 s** après le dépôt |
| Interventions de l'utilisateur | 0, hors 2 confirmations de confiance du dossier au démarrage (Claude, Codex) | 3 : deux permissions au démarrage, puis le passage en mode auto |
| Échanges visibles dans Ledge | 4, dans l'ordre et groupés dans le fil de Ledge : objectif, tâche au relecteur, résultat, résultat final | 2 : les deux créations de tâche. Les clôtures n'apparaissent pas. |

Les deux moteurs atteignent l'objectif sans autre aide. Les écarts viennent surtout du démarrage :

- **Ledge** demande la confiance du dossier à Claude et à Codex. OpenRig l'écrit lui-même dans `~/.claude.json` et la config Codex avant de lancer les sièges.
- **OpenRig** sans politique de permissions s'arrête à la première commande. Le test Ledge tournait en autonomie `auto`, d'où le passage en mode auto côté OpenRig pour comparer.

## Vérifications regroupées (lots A à F)

- **Lot A**
  - Les liaisons SSH vers legion restent les mêmes processus pendant 20 s : pas de boucle de reconnexion.
- **Lot B**
  - `ledge team up --goal` affiche `objectif donné au lead (tâche td397bc)`.
  - Le lead a reçu l'objectif avec sa consigne, l'a pris, a délégué, puis a rendu le résultat.
  - Le rôle `leader` par défaut a été écrit au premier démarrage.
- **Lot C**
  - Couvert par les tests contre le vrai daemon.
  - Pas de broadcast dans ce scénario.
- **Lot D**
  - **Premier démarrage.** Sans `teams-engine.json`, le daemon a choisi `openrig` (log : « OpenRig was used on this machine »), parce que le snapshot avait lu le flux d'OpenRig. C'est le comportement prévu pour ne pas couper un utilisateur d'OpenRig.
  - **Commande `ledge teams engine`.**
    - Elle affiche le moteur.
    - Elle passe à `ledge`, puis à `openrig`.
    - Elle refuse le retour à Ledge tant que le rig `starter` tourne (« un rig OpenRig tourne : arrête-le avant de changer de moteur »), puis l'accepte après `rig down`.
  - **Coupure par moteur.**
    - En mode Ledge, seule l'équipe Ledge (`team-0abf`, `engine: ledge`) apparaît.
    - En mode OpenRig, seuls les rigs OpenRig apparaissent : le noyau et `starter`.
- **Lot E**
  - Pas de question du lead dans ce scénario.
  - Le chemin est couvert par les tests contre le vrai daemon (cerveau, garde, grâce, redémarrage).
- **Lot F**
  - Le Desktop installé sur le laptop est le snapshot de Joffrey, qui ne connaît pas les équipes Ledge.
  - Seuls la CLI et le daemon ont été vérifiés ici.
  - L'interface est couverte par les tests unitaires et le scénario e2e `apps/desktop/e2e/teams-engines.spec.ts`.

## État laissé sur le laptop

- **Daemon** : celui de la branche, au commit 3aed7c4e, en **moteur Ledge**. `~/.ledge/teams-engine.json` vaut `ledge`.
- **Retour à OpenRig** : `ledge teams engine openrig`.
- **Dossiers de test** : l'équipe et le rig de test sont arrêtés. Les dépôts de test sont dans le scratchpad de la session.

## Pistes ouvertes par les mesures

- **Confiance des dossiers.** Ledge pourrait écrire la confiance des dossiers avant de lancer les sièges d'une équipe, comme OpenRig, pour supprimer les deux confirmations du démarrage.
- **Miroir des échanges OpenRig.** Le miroir des échanges OpenRig de la branche (code de Joffrey) ne montre pas les clôtures de tâche. Le fil d'une équipe OpenRig est donc moins complet que celui d'une équipe Ledge.
- **Deuxième étape (spec §3).** La priorité des messages, les rôles enrichis et la file avancée restent à faire. La comparaison détaillée avec OpenRig est publiée à part, dans un artifact.
