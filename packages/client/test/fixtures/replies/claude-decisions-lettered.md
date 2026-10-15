Le dépôt est quasi vide : un `README.md` (« petit service Node/TypeScript qui reçoit des commandes clients via une API REST »), pas de code ni de `package.json`. Toutes les décisions sont donc encore ouvertes. Répondez par numéro et lettre (ex. `3b`) ; si un point ne vous importe pas, je prends l'option marquée ★.

**Contexte de session**

0. **Ticket** : quelle est la référence (ex. ABC-123) ? Ou est-ce « hors ticket » ? Et l'objectif de la session : a) analyse, b) plan, c) implémentation, d) tests, e) revue, f) correction ?

**Socle technique**

1. **Framework HTTP** : a) Express ★ (même socle que vos autres services), b) Fastify, c) NestJS.
2. **Conventions** : faut-il suivre les conventions maison (route → controller → service → modèle Objection, config via `config.ts` + zod) ?
   a) oui, via le scaffolder officiel ★, b) oui, mais écrites à la main, c) non, structure libre.
3. **Version de Node / gestionnaire de paquets** : a) Node 22 + npm ★, b) autre (précisez).

**Données**

4. **Persistance** : a) PostgreSQL + knex/Objection ★, b) en mémoire pour commencer, c) autre (DynamoDB…).
5. **Base locale pour le dev et les tests** : a) Postgres via `docker compose`, b) une base existante (dev partagée ?), c) pas de base (repository mocké).
   Si c'est a), je fixerai un subnet explicite pour le réseau Docker.
6. **Modèle d'une commande** : quels champs ? Par exemple : client, lignes (produit, quantité, prix unitaire), total, devise, statut, dates. Un client est-il une entité à part ou un simple identifiant externe ?

**Contrat de l'API**

7. **Périmètre des endpoints pour cette première itération** :
   a) créer + lire une commande (`POST /orders`, `GET /orders/:id`) ★,
   b) a) + liste paginée et filtrée,
   c) CRUD complet, avec changement de statut et annulation.
8. **Cycle de vie / statuts** : a) aucun pour l'instant ★, b) machine d'états simple (`pending → confirmed → shipped`, `cancelled`), c) autre (précisez).
9. **Validation des entrées** : a) zod ★, b) JSON Schema / OpenAPI d'abord (contrat généré ou validé depuis une spec), c) autre.
10. **Spécification OpenAPI** : a) aucune pour l'instant, b) générée depuis le code, c) écrite d'abord, puis implémentée (contract-first).
11. **Idempotence de la création** (éviter les doublons si un client renvoie sa requête) : a) pas maintenant ★, b) en-tête `Idempotency-Key`.
12. **Format des erreurs** : a) RFC 7807 `application/problem+json` ★, b) `{ error: { code, message } }` maison.

**Transverse**

13. **Authentification** : a) aucune (réseau interne) ★, b) clé d'API, c) JWT / Keycloak.
14. **Tests** : a) mocha + nyc ★ (convention maison), b) vitest, c) jest. Avec des tests d'intégration sur une vraie base ? Oui / non.
15. **Branche et livraison** : on est sur `master`, le README n'est pas commité et la branche principale annoncée est `main`. Je crée `main` (ou une branche de feature) ? Et le dépôt distant est-il sur GitLab ?

Les points vraiment bloquants sont 0, 2, 4, 6 et 7. Pour le reste, je peux appliquer les ★ et vous le signaler.
