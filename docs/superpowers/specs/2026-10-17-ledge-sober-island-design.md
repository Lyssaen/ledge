# L'île sobre — sans l'intégration Desktop

Date : 2026-10-17 · Projet personnel, hors story Jira · Statut : **à construire sur `apps/overlay` seulement**.

La maquette figée fait foi : `docs/mockups/island-sober/` (page `docs/mockups/ledge-island-sober.html`). Le résumé d'écran est le § 8 de `docs/superpowers/specs/2026-10-16-ledge-desktop-atelier-design.md`. Ce document ne le répète pas. Il tranche ce que le § 8 laissait ouvert, et il dit ce qui **n'est pas** construit ici.

L'île et Ledge Desktop ne sont pas utilisés tant que les deux ne sont pas finis. On peut donc retirer de l'île ce qui part dans Desktop, sans attendre que Desktop l'affiche.

## 1. Décisions

- **Les cartes du chat restent.** « Lancer la session » et « Envoyer l'instruction » font partie du chat de l'île. Elles parlent encore au daemon. Rien n'est lancé sans un clic.
- **Ctrl Alt L** ouvre la première demande en attente. S'il n'y en a pas, ou si cette demande est déjà affichée, il ouvre le chat. Depuis le chat, il replie l'île. Il n'ouvre pas Desktop : ça, c'est l'intégration.
- **Ctrl Alt N** ne montre plus de formulaire. Il enregistre une demande d'ouverture « Nouvelle session » (le raccord, § 3).
- **Un clic sur un bot** qui a une demande montre cette demande, même mise de côté. Sinon, un aperçu d'une ligne (état, tâche) et « Ouvrir dans Ledge ».
- **Plus tard** (Échap) met la demande de côté. Elle reste en attente. La suivante non mise de côté s'affiche. Un clic sur le bot la ramène.
- **Ne pas déranger** replie la bulle et coupe le son. Les demandes **restent** dans l'île. Rien ne surgit tout seul. Les éteindre ne les fait pas réapparaître.
- **Une demande ne se replie plus toute seule.** Seuls les avis (terminé, erreur, machine hors ligne) ont une barre de 6 s, suspendue au survol et au focus.
- **Le survol du bord** ne déroule plus la liste. Le mode discret, lui, se redéploie toujours au survol.
- **Plus de liste, de session, de sous-agent, de terminal, de lecteur, de formulaire, de réglages, d'aide** dans l'île. Ces modes ne s'ouvrent plus.
- **L'engrenage** quitte l'île compacte. Dans l'en-tête du chat : « Réglages dans Ledge Desktop », « Ne pas déranger », « Quitter Ledge ». Le bouton « Retour aux sessions » disparaît. × replie.
- **La pastille de mise à jour** reste sur la mascotte. L'installation n'est pas lancée depuis l'île.
- **Les réglages déjà enregistrés** (thème, échelle, écran, position, mode discret, accent, sons, machines) continuent de s'appliquer. On ne les change plus depuis l'île, sauf Ne pas déranger.

## 2. Ce que l'île fait encore, toute seule

- Île compacte, file, accords (Autoriser / Refuser), questions (choix 1–9 ou réponse courte), avis, aperçu, chat, sons, Ne pas déranger, pastille.
- Décisions et réponses envoyées au daemon, comme aujourd'hui. Un diff ou un plan ne se décide pas dans l'île : la carte dit « Relire dans Ledge ».
- Quitter ferme le processus de l'île (la barre des tâches le faisait déjà). Fermer Desktop en même temps attend l'intégration.

## 3. Le raccord, et rien d'autre

Un seul module, `apps/overlay/src/desktop/openInLedge.ts`. L'île l'appelle. Elle n'ouvre pas de fenêtre, elle ne parle pas à `apps/desktop`, elle ne change ni le protocole, ni le daemon, ni le fleet.

```ts
export type LedgeTarget =
  | { kind: 'session'; id: string }
  | { kind: 'terminal'; id: string }
  | { kind: 'document'; path: string }
  | { kind: 'settings' }
  | { kind: 'launch' }
  | { kind: 'update' }
  | { kind: 'machines' };

export function openInLedge(target: LedgeTarget): void;
```

Aujourd'hui la fonction retient la cible et prévient les abonnés. L'île le dit dans une région aria-live : l'ouverture est notée, Desktop la fera à l'intégration. Remplacer le corps de `openInLedge` suffit le jour venu. Aucun écran de l'île n'est à réécrire pour ça.

Appels : « Ouvrir dans Ledge », « Relire dans Ledge », le menu Réglages, Ctrl Alt N, le menu de la barre « Nouvelle session », un document ou un terminal cité dans le chat, la pastille de mise à jour.

## 4. Hors de ce chantier

`apps/desktop`, `packages/protocol`, `packages/ledge`, `packages/fleet`, `packages/ui`. Le pied de page « Île active », les réglages de l'île dans Desktop, et le fait que Ctrl Alt L ouvre Desktop : le travail d'intégration, une fois Desktop fini.
