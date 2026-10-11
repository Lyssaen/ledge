# Pistes pour Ledge — sessions Claude Code du 11 octobre 2026

Ce document conserve les propositions des deux dernières sessions Claude Code du dépôt : une discussion sur les fonctionnalités futures (`fc8993de`) et une sur les animations des bots (`b004b7fe`). Ce sont des **pistes**, pas des décisions de design ni un plan d'implémentation. Les priorités indiquées ci-dessous reprennent les recommandations de ces échanges.

## Fonctionnalités et fiabilité

| Priorité proposée | Piste | Travail à cadrer |
| --- | --- | --- |
| Haute | Contexte et quota par bot | Examiner les données réellement disponibles dans la status line de chaque outil, puis définir une remontée vers le daemon et un signal discret dans l'overlay. Vérifier la fraîcheur et l'absence de données avant de dessiner une jauge. |
| Haute | Relayer une instruction depuis le chat Ledge | Prévoir la sélection explicite de la session cible, l'affichage de l'instruction exacte et une confirmation avant l'envoi. Déjà envisagé en V2 dans la [spec des sessions et du chat](../superpowers/specs/2026-10-11-sessions-identity-and-chat-design.md). |
| Haute | Montrer les changements d'une session | Afficher un résumé Git lié au point de départ de la session (fichiers, ajouts, suppressions). Le chat produit déjà un `git diff --stat` de l'état courant ; il faut définir une référence de départ par session et le comportement avec des modifications préexistantes ou un dépôt absent. |
| À étudier | Historique des demandes et décisions | Conserver qui a demandé quoi, la réponse et l'heure, avec une politique de conservation et de confidentialité. L'historique a été écarté de la V1. |
| À étudier | Actions rapides sur une ligne | Ouvrir le dossier, copier l'identifiant, couper le son d'une session. Définir les actions réellement utiles et leur comportement Windows/WSL. |
| À étudier | Récapitulatif du matin ou du soir | Résumer les tours terminés et les demandes en attente. Déjà envisagé en V2 du chat. |
| À étudier | Ne pas déranger automatique | Examiner les signaux Windows disponibles pour le plein écran, le partage d'écran et Focus Assist, puis préciser quand masquer les notifications. |
| À étudier | Sessions inactives et profils de lancement | Proposer la fermeture d'une session longtemps inactive ; enregistrer des combinaisons dossier, outil, mode et tâche. Ces idées avaient été écartées du premier périmètre. |

### Dette relevée dans la discussion

- **Authentifier le WebSocket local** : le daemon accepte les connexions sur le loopback sans authentification. Étudier un jeton local partagé entre daemon et overlay, ainsi que les effets sur les hooks et les clients CLI. Voir [README, sécurité](../../README.md#security-and-failure-model).
- **Réponse libre « Other »** : non prise en charge pour les questions à choix, notamment Claude Code et Cursor. Voir les [limites connues](../../README.md#status-and-known-limits).
- **Vérification Windows réelle** : terminer les contrôles au runtime de `open_terminal`, de `wt.exe` et de la checklist du premier build.
- **Approbations des sous-agents Codex** : trois commits existent sur `worktree-codex` (`a14c56f`, `f040078`, `13a3b56`). Les revoir et les intégrer séparément ; leur existence dans une branche ne prouve pas leur compatibilité avec `main`.

### Correction apportée à la proposition initiale

La reprise après redémarrage du daemon a été proposée comme nouveauté, mais elle est **déjà implémentée** : `Store.load()` recharge `~/.ledge/sessions.json`, et `startDaemon()` conserve les sessions dont le tmux est encore vivant tout en supprimant les autres. Une amélioration éventuelle doit partir d'un scénario de perte reproductible, avec un test de redémarrage, et non d'une réimplémentation de la reprise.

## Animations de Claude, Codex et Cursor

Les trois bots partagent actuellement les gestes dans `Bot.tsx`, `useBotMotion.ts` et `bots.css` : respiration, saut de travail, clignement, mouvement limité du regard pendant le travail, geste d'approbation et acquiescement. La mascotte résidente a davantage de réactions au curseur et de gestes. Les propositions suivantes visent à donner aux bots des transitions plus lisibles et une personnalité propre, sans modifier leur état métier.

1. **Transitions d'état** — Première piste à maquetter : préparation courte avant le saut en `working`, tête et yeux décalés dans le temps en `question`, petit rebond en `idle`, fermeture des yeux en deux temps en `done`, recul sans tremblement en `error`. Un attribut temporaire tel que `data-transition` pourrait piloter environ 500 ms de mouvement. Le geste doit rester annulable si l'état change encore.
2. **Finitions visuelles** — Ajouter une lueur douce à l'antenne et sa pulsation pendant le travail ; affiner le retour de posture avec la courbe de mouvement existante ; synchroniser l'ombre au sol avec le saut. Vérifier le rendu en clair et en sombre, ainsi qu'aux tailles de la poignée et de la liste.
3. **Survol et clic** — Faire suivre légèrement le curseur par le regard (amplitude proposée : ±2 unités) et jouer un court écrasement/étirement au clic. Garder le geste `hello` propre à Ledge.
4. **Gestes au repos** — En `idle`, un regard latéral occasionnel et, plus rarement, un étirement ; en `question`, une légère inclinaison alternée. Garder `approval` calme. Ces gestes doivent être déterministes à partir de la graine de session.
5. **Signature par outil** — Claude termine son saut avec une légère inclinaison ; Codex roule un peu ; Cursor pointe vers l'avant au sommet. Conserver une durée et un rythme communs pour que l'état reste identifiable.

**Contraintes à préserver :** sous 20 px, seul le saut de travail reste animé ; respecter mouvement réduit, pause, couche inactive et connexion figée ; ne jamais faire passer un geste ambiant pour un changement d'état. La [spec de design, sections 6 et 7](../superpowers/specs/2026-10-09-ledge-design.md) reste la référence. Avant implémentation, réaliser une maquette de mouvement près de `docs/mockups/mascots.html`, valider les choix, puis mettre à jour la spec et les tests utiles.
