# Vision — Ledge, le contact humain d'OpenRig

Statut : brouillon du lead (pilot-lead@ledge-dev), 2026-11-02, à valider par l'utilisateur.
Maquette de référence : `docs/mockups/ledge-human-operator.html`, direction **A+B**.

## La décision de l'utilisateur

> « Moi je vois A+B, Ledge comme contact humain et operateur reste pour le dispatch d'équipe. » — « Top pour moi. »

## À quoi sert Ledge

Ledge est **le seul endroit où l'utilisateur parle aux rigs et où les rigs lui parlent**. Tout ce qu'OpenRig adresse
à un humain (une décision, une question, une nouvelle) arrive dans Ledge ; tout ce que l'utilisateur veut dire à une
équipe part de Ledge.

Ledge est aussi un **assistant qui peut régler du simple à sa place**, sujet par sujet, seulement quand
l'utilisateur le lui a confié. Au départ, presque tout est sur « Toujours moi » : on a la direction A le premier jour,
et B s'ouvre par réglage, quand la confiance est là.

## Qui fait quoi

| | Rôle |
|---|---|
| **L'utilisateur** | Décide. Valide toujours lui-même les maquettes, et tout push, PR, merge, release. |
| **Ledge** | Contact humain d'OpenRig : reçoit et présente les demandes, transmet les réponses et les objectifs, et décide seul ce que le réglage lui permet, en citant sa source. |
| **Max** (`operator-agent@kernel`) | Reste. Dispatch d'équipe : choisit le rig ou les sièges pour un objectif et route le travail. |
| **Les rigs** | Font le travail ; s'adressent à l'humain via OpenRig, qui livre à Ledge. |
| **TUI du kernel** | Reste utilisable en parallèle (secours, usage terminal). |

## Ce que Ledge remplace ou complète côté OpenRig

- **Canal humain** : aujourd'hui l'humain enregistré « ledge » passe par Slack et n'est pas prêt (token bot ou channel
  manquant, `rig gateway human list`). Ledge doit devenir réellement ce canal : les lignes adressées à l'humain
  (`--human-intent decision|update`, questions à boutons) arrivent dans « À toi », et la réponse repart dans la ligne.
  Mécanisme (étude dev-back, `docs/vision/ledge-human-channel-study.md` sur la branche `docs/human-channel-study`,
  ed3d97dc) : Ledge lit `GET /api/attention` du daemon OpenRig, réveillé par le flux `GET /api/events` ; il répond
  par `POST /api/mission-control/action` (`answer`, `resolve`, `approve`), le chemin du TUI du kernel. OpenRig crée
  alors la ligne-réponse et réveille le siège demandeur. La personne `ledge` reste l'adresse humaine ; Slack reste
  désactivé (réglages pour réduire son bruit : sur accord de l'utilisateur seulement).
- **Relais par Max** : la consigne actuelle (« Max seul intermédiaire ») est une forme provisoire de ce modèle ; quand
  Ledge reçoit les demandes, les sièges écrivent à l'humain via OpenRig et Max n'a plus à relayer les validations.
- **File d'attente et décisions** : OpenRig reste la source de vérité. Ledge n'a pas sa propre file : il affiche et
  répond aux lignes.

## Parcours clés

1. **J'ouvre Ledge** : « À toi » — Décisions, Questions, Nouvelles — plus « Réglé par Ledge » (avec la source de
   chaque réglage) et le rappel de ce que Ledge décide seul.
2. **Un rig me demande une décision** : la carte de décision, la recommandation de Ledge et ses sources, « Pourquoi
   c'est à toi » ; le fil du rig (messages OpenRig interprétés, bruts repliables) au centre.
3. **Je donne un objectif** : je l'écris à Ledge ; Max propose l'équipe ; je confirme selon le réglage.
4. **Je règle ce que Ledge décide seul** : par sujet, Toujours moi / Ledge propose / Ledge décide. Maquettes et
   push/PR/merge/release verrouillés sur « Toujours moi ».

## Règles validées

- Ledge décide seul en s'appuyant sur le dépôt (CLAUDE.md, config, conventions) et les maquettes validées, toujours
  cités. Le modèle utilisé est au choix de l'utilisateur.
- Une décision prise seul par Ledge part après un court délai avec « Annuler ».
- Les messages OpenRig bruts restent au centre du fil, repliables.
- Même direction sur Desktop, mobile et TUI Ledge.

## Précisions (retour design-ux sur la maquette A+B)

- Max propose toujours l'équipe ; le sujet réglable est « Confirmer l'équipe proposée par Max », pas « choisir ».
- « À toi » réunit aussi les demandes des sessions hors rig (permissions, questions), pas seulement les lignes OpenRig.
- Le délai « Annuler » ne protège que si l'utilisateur regarde (relayé à l'île et au téléphone) : le vrai garde-fou
  reste le réglage par sujet.

## Décisions de l'utilisateur (2026-11-02, 19:36Z)

> « 1. Oui 2. Oui 3. Oui. 4. On doit pouvoir choisir le harness et le modèle. Par défaut, Sonnet 5.5. […] 6. J'utilise
> pas Slack. 7. Oui. 8. Oui. 9. Oui. J'aimerai que Slack soit remplacé directement par Ledge, qui devient mon point de
> contact. »

- Maquette A+B, note et ordre des lots validés.
- Réglage de départ : tout sur « Toujours moi », sauf « Questions techniques » sur « Ledge propose ».
- Délai avant envoi : 5 s par défaut, réglable 3/5/10/30 s ; il s'applique aussi quand Ledge confirme l'équipe de Max.
- Ledge : harness et modèle au choix, défaut Sonnet 5.5.
- Les réglages Toujours moi / Ledge propose / Ledge décide valent aussi pour les sessions hors rig (Otto, permissions
  des projets) : un seul endroit (« 5. Oui », 19:38Z).
- Complément de maquette validé (19:41Z, « Validé pour le reste ») : Slack retiré partout ; Réglages › Ledge propose
  harness + modèle (défaut Claude Code + Sonnet 5.5) ; le harness de Ledge tourne sur la machine locale ; s'il manque,
  Ledge ne recommande rien mais les demandes arrivent quand même dans À toi.
- Piste à évaluer (pas une décision) : le modèle de l'outil de démo po-web (messages humains = lignes de queue
  ordinaires, réponses en notes) pour les messages ordinaires et l'objectif donné à Max ; le canal humain d'OpenRig
  pour les décisions bloquantes.
- Rapport à l'équipe OpenRig (`openrig-report-human-channel.md`) : « Ok pour moi » ; l'opérateur l'envoie.
- **Plus de Slack** : Ledge remplace Slack comme point de contact (le binding `slack:ledge-decoy` est à remplacer).
  Tout changement de config OpenRig (gateway human, binding) passe par l'opérateur, avec l'accord de l'utilisateur.
- Test réel sur OpenRig autorisé pendant le lot 1 ; signaler à l'équipe OpenRig ce qui manque (rapport montré à
  l'utilisateur avant envoi).

## Lots proposés

1. **Lot 1 — « À toi » canal humain** (back B1 lire + B2 répondre, puis front) : les demandes OpenRig arrivent dans
   À toi, on y répond, tout sur « Toujours moi ». C'est la direction A, utilisable seule.
2. **Lot 2 — Objectif via Ledge et Max** : écrire l'objectif à Ledge, proposition d'équipe de Max, confirmer.
3. **Lot 3 — Flotte, relais, mobile, TUI** (back B3).
4. **Lot 4 — Ledge décide seul** (back B5) : Réglages › Ledge, « Réglé par Ledge », délai Annuler, modèle.
5. **B4** (réglages Slack, test réel) se place quand l'utilisateur l'autorise.

ledge-dev-2 (messages OpenRig en cartes) avance en parallèle dans la zone réservée du fil du rig.

## Hors périmètre

- Remplacer Max ou le kernel.
- Une file d'attente propre à Ledge, parallèle à celle d'OpenRig.
- Toute délégation des validations de maquette et des push/PR/merge/release.

## Briques et équipes

- **ledge-dev-2** : interprétation des messages OpenRig (rig send, handoffs) en bulles/cartes dans les chats Ledge —
  la zone jaune de la maquette.
- **ledge-dev** : « À toi » comme canal humain, le réglage par sujet, « Réglé par Ledge », l'objectif donné à Ledge.

## Questions encore ouvertes

- Le mécanisme exact pour que Ledge soit le canal humain (dev-back l'étudie).
- L'ordre des lots et ce qui arrive en premier (à proposer après l'étude dev-back).
