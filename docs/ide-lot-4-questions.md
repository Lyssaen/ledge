# Lot 4 IDE — questions à design-ux

La modale « Nouvelle session » (`apps/desktop/src/launch/LaunchModal.tsx`) suit `launchPage()` de `docs/mockups/ledge-ide-interactive.html`. Les états ci-dessous n'y figurent pas. En attendant une réponse, la modale reprend le texte existant du formulaire actuel (`LaunchComposer`, clés `launch.*`), placé comme indiqué.

## 1. Champ manquant après un essai

`Ctrl+Entrée` ou « Lancer » alors qu'un champ manque : rien n'est envoyé.

- Texte utilisé : `launch.missing.*`, à droite des boutons, en rouge (`role="alert"`) : « Écrivez la consigne », « Aucune machine en ligne », « Choisissez au moins un dossier ou un dépôt ».
- Le `textarea` vide est bordé de rouge (`aria-invalid`).
- Question : quel texte, à quel endroit ? « Écrivez la consigne » doit-il devenir « Écrivez le premier message » ?

## 2. Lancement refusé

Le daemon refuse le lancement.

- Texte utilisé : `launch.refused` (« Démarrage refusé : … »), à droite des boutons, en rouge.
- Question : même place, même ton ?

## 3. Délai dépassé

Le daemon ne répond pas dans les 20 s.

- Texte utilisé : `launch.timeout` (« Le démarrage n’a pas répondu. Vérifiez la machine puis réessayez. »), à droite des boutons.

## 4. Lancement en cours

- Texte utilisé : le bouton primaire affiche `launch.launching` (« Lancement… ») au lieu de « Lancer ». Un nouvel envoi n'a aucun effet.
- Question : faut-il un indicateur de progression, ou désactiver les champs ?

## 5. Aucun projet

- Texte utilisé : sur la ligne « Projet », `launch.noProjects` (« Aucun projet pour l’instant. ») et le bouton « Nouveau projet ».
- Question : faut-il garder la phrase d'explication du formulaire actuel (« Créez un projet pour y lancer des agents. ») ?

## 6. Machine hors ligne

- Une ligne du menu « Projet » dont la machine est hors ligne est désactivée, avec « hors ligne » à droite.
- Si la machine choisie se déconnecte, la modale passe sur une ligne en ligne : d'abord une autre ligne du même projet, sinon la première ligne en ligne. Si aucune machine n'est en ligne, la ligne reste et l'essai d'envoi affiche « Aucune machine en ligne ».
- Question : faut-il prévenir l'utilisateur de ce changement de ligne ?

## Autres points absents de la maquette

- **Bouton « Lancer »** : la maquette affiche « Ctrl Entrée » dans le bouton. Le texte est traduit (`launch.modal.launchKeys`, « Ctrl Enter » en anglais).
- **Limite sans heure de réinitialisation** : quand le daemon ne fournit pas l'heure, la tuile affiche « Limite 5 h 84 % », sans « · réinit. ».
- **OMP indisponible** : `launch.ompUnavailable` ou `launch.ompOutdated` en rouge sous les tuiles. Les lignes Modèle et Permissions restent vides.
- **Daemon trop ancien** : sans liste des modèles, `launch.modelsOutdated` sur la ligne Modèle. Sans choix d'autorisations OMP, `launch.approvalOutdated` sur la ligne Permissions.
- **Dossier introuvable** : si la machine ne trouve pas le dossier choisi, la modale prend le premier dossier du projet trouvé sur cette machine, comme le formulaire actuel. Rien n'est signalé dans le menu.

## 7. Projet sans dossier sur la machine

Le déclencheur « Projet » d'un projet qui n'a aucun dossier sur la machine choisie.

- Texte utilisé : `launch.noRepo` (« aucun dossier ni dépôt ») à la place du dossier, dans le déclencheur : « Ledge · aucun dossier ni dépôt · machine ».
- Question : quel texte, et faut-il proposer « Ajouter un dossier » ici ?

## 8. Modèle hors ligne

La machine choisie est hors ligne : la ligne « Modèle » reste vide (aucune liste des modèles ne peut être lue).

- Texte utilisé : aucun.
- Question : faut-il un texte (« Machine hors ligne ») ou masquer la ligne ?

## 9. Fenêtre étroite (moins de 640 px)

- Rendu utilisé : une seule colonne (l'étiquette au-dessus de son champ), les quatre tuiles d'agent en 2 × 2 (`ide.css`, `@media (max-width: 640px)`).
- Question : est-ce la mise en page voulue ?

## 10. Ligne choisie dans le menu « Projet »

- Rendu utilisé : la ligne choisie est surlignée (`.on`, `aria-current`), comme la ligne survolée.
- Question : faut-il une coche, ou un autre surlignage que le survol ?

## 11. Couleur de la limite d'une tuile

- Rendu utilisé : le pourcentage en ambre au-delà du seuil d'alerte (Réglages › Général), en rouge à 100 %, comme le pied de page (`usageTone`).
- Question : la tuile entière doit-elle changer de ton, ou seulement le pourcentage ?

## 12. « Lancer » quand un champ manque

- Rendu utilisé : le bouton paraît désactivé (`aria-disabled`, opacité 0,55, curseur interdit) tant qu'un champ manque, par exemple le premier message vide à l'ouverture, pendant un lancement, ou quand OMP ne peut pas tourner. Il reste cliquable : un clic affiche ce qui manque (voir 1).
- Question : le bouton doit-il paraître désactivé dès l'ouverture, alors que rien n'a encore été saisi ?

## 13. Quatrième tuile (Cursor)

La maquette dessine trois tuiles ; la modale en a quatre (R4).

- Rendu utilisé : avec quatre tuiles, la ligne « Limite 5 h 84 % · réinit. 14:20 » passe sur deux lignes, coupée là où la largeur l'impose.
- Question : où couper (avant « · réinit. » ?), ou faut-il raccourcir le texte ?

## 14. Limite non lue pour la machine choisie

- Texte utilisé : `launch.modal.limitUnread` (« Limite non lue ») quand la machine choisie n'a aucune lecture du compte de cet agent, même si une autre machine en a une. Sans machine choisie, la tuile montre le premier compte lu de l'agent.
- Question : faut-il plutôt montrer la limite lue sur une autre machine, avec son nom ?
