# Rapport pour l'équipe OpenRig — brouillon, à montrer à l'utilisateur avant envoi

Source : étude dev-back (lecture seule) du 2026-11-02, branche `docs/human-channel-study` (ed3d97dc) du dépôt Ledge.
Version d'OpenRig : à relever avec `rig --version` au moment de l'envoi.

## 1. Un humain ne peut être relié que par Slack

- **Fait** : dans le registre humain (`rig gateway human`), la seule liaison de remise est Slack (`binding.<n>`,
  `slack-subscription`). Il n'existe pas de liaison « client local » (une application qui lit et répond aux demandes
  via l'API du daemon), ni d'accusé de remise côté client.
- **Effet** : une personne qui reçoit ses demandes ailleurs que dans Slack (ici Ledge, via `GET /api/attention` et
  `POST /api/mission-control/action`) garde une liaison Slack fictive. Chaque demande « due » à Slack finit
  `never-posted`, et le siège qui l'a posée reçoit un constat `undelivered-human-notice` alors que la demande a bien
  été vue et traitée.
- **Proposition** : une liaison de type client local (par exemple `binding.0 = client:ledge`) que le gateway considère
  comme livrée quand le client lit la demande (accusé de remise), sans tenter Slack ; et `slack-subscription none`.

## 2. Répondre à une demande n'a pas de commande `rig`

- **Fait** : la réponse d'un humain passe par `POST /api/mission-control/action` (verbe `answer`, `resolve`,
  `approve`), le chemin du TUI du kernel. Aucune commande `rig` ne l'expose.
- **Effet** : un outil ou un script qui veut répondre doit appeler l'API HTTP directement, sans la validation ni la
  documentation du CLI.
- **Proposition** : `rig queue answer <id> --question <qid> --option <oid>` (et `--decision`, `resolve`, `approve`),
  avec le même contrat que l'action de Mission Control.

## Contexte

Ledge (application de bureau qui suit les sessions d'agents) devient le point de contact humain de son utilisateur
pour OpenRig : les demandes des rigs y arrivent et il y répond. Les deux points ci-dessus ne bloquent pas, mais le
premier produit du bruit à chaque demande.
