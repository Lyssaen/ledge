# Tester l'île — guide de recette manuelle

Version visée : Ledge 0.2.1 (tag `v0.2.1`, installeur `Ledge_0.1.0_x64-setup.exe`). Référence : la [spec de l'île](superpowers/specs/2026-10-12-island-design.md) et le [tour](tour.md).

Ce guide est une suite de scénarios à dérouler sur la version installée sous Windows, avec de vraies sessions lancées depuis WSL. Chaque scénario dit comment provoquer la situation, ce qui doit se passer et ce qu'il faut noter si ça ne se passe pas. Les cases `[ ]` se cochent au fur et à mesure ; une grille de résultats attend à la fin.

Comptez une heure et demie pour tout dérouler. Les parties 1 à 5 sont le cœur de l'île ; les suivantes vérifient que le reste n'a pas bougé.

---

## 0. Avant de commencer

### Ce qu'il faut

- Windows 10 ou 11 avec Windows Terminal, Ledge 0.2.1 installé (le tooltip de l'icône dans la zone de notification dit « Ledge 0.1.0 » : c'est attendu, la version de `tauri.conf.json` n'a pas été montée).
- WSL2 avec le CLI et le daemon à jour :

```sh
cd ~/Workspace/ledge && git pull && pnpm install && pnpm --filter ledge build
systemctl --user restart ledge-daemon.service
ledge status
```

- Claude Code installé dans WSL, connecté. Codex ou Cursor Agent sont un plus pour la partie 9.
- Deux dépôts Git différents dans WSL, n'importe lesquels, pour voir la liste groupée par dépôt.

### Ce qu'il faut noter pour chaque anomalie

- L'échelle d'affichage Windows (Paramètres > Système > Affichage > Mise à l'échelle : 100, 125, 150 ou 200 %).
- Le nombre d'écrans et lequel porte l'île (Réglages > Affichage > Écran).
- Le réglage « Taille de l'île » et « Taille des fenêtres » (Auto ou un pourcentage).
- La fenêtre au premier plan à ce moment-là (Terminal, navigateur maximisé, rien).
- Une capture d'écran, idéalement de tout l'écran pour voir où l'île se pose.
- Côté WSL, les dernières lignes de `~/.ledge/daemon.log` et de `journalctl --user -u ledge-daemon.service -n 50`.

### Partir d'un état propre

1. Quitter Ledge depuis le menu de l'icône (clic droit > Quitter Ledge), puis le relancer depuis le menu Démarrer.
2. Dans WSL, vérifier qu'aucune session ne traîne : `ledge status`. Pour repartir de zéro, fermer les onglets Windows Terminal des sessions précédentes.
3. Réglages > Affichage : Position de l'île sur Centre, Mode discret activé, tailles sur Auto, thème sombre. Réglages > Notifications : Ne pas déranger désactivé.

### Provoquer chaque situation avec Claude Code

Les scénarios s'appuient sur quatre situations, toutes obtenues avec une session `ledge claude` ouverte dans un onglet Windows Terminal :

| Situation | Comment l'obtenir | Ce que fait l'île |
| --- | --- | --- |
| Au travail (bleu) | Un prompt un peu long : « Résume ce dépôt fichier par fichier, sans rien modifier. » | Le compagnon saute de 2 px toutes les 4 s environ. |
| Demande d'accord (rouge) | « Lance `pnpm test` » ou « crée un fichier `test.txt` » dans un dossier où Claude Code n'a pas encore la permission. | La bulle rouge, Refuser et Autoriser. |
| Question (ambre) | « Pose-moi une question à choix multiples avec l'outil AskUserQuestion : quel thème je préfère, trois options. » | La bulle ambre, les options dans la session. |
| Tour terminé (vert) | N'importe quel prompt court : « Dis bonjour. » | Le compagnon grossit, l'île s'étire en vert 6 s. |

Pour une session qui ne demande rien pendant longtemps, le résumé d'un gros dépôt suffit. Pour en avoir sept et plus (partie 2), ouvrir plusieurs onglets et lancer `ledge claude` dans chacun, ou `Ctrl+Alt+N` depuis l'île.

---

## 1. L'île au repos

Objectif : l'île lit comme une découpe dans le bord supérieur, pas comme une fenêtre posée dessus.

### 1.1 Sans session

- [ ] Au lancement de Ledge, sans aucune session : une pastille sombre au centre du bord supérieur de l'écran principal, 38 px de haut, la mascotte de Ledge seule, sans trait vertical.
- [ ] De chaque côté, à la jonction avec le bord, un congé concave de la couleur de l'île. Pas de liseré clair ni de pixel qui dépasse.
- [ ] Les coins du bas sont arrondis, les coins du haut sont droits : l'île sort du bord, elle ne flotte pas dessous.
- [ ] La mascotte suit le curseur des yeux quand il passe à proximité.
- [ ] Un clic sur la mascotte de Ledge ouvre la liste vide : « personne au travail » et un bouton pour démarrer un compagnon.

### 1.2 Avec des sessions

Lancer `ledge claude` dans deux onglets, dans deux dépôts différents.

- [ ] Une mascotte par session rejoint l'île, de gauche à droite, séparée de la mascotte de Ledge par un trait vertical de 1 px.
- [ ] Le titre de l'onglet Windows Terminal est `<nom du bot> · <projet>`.
- [ ] Chaque mascotte porte le halo de son état : bleu au travail, vert quand elle attend votre prochaine instruction.
- [ ] Une mascotte qui attend respire ; une mascotte au travail saute de 2 px vers le haut, jamais vers le bas.
- [ ] Le survol d'une mascotte montre son nom et son état ; un clic ouvre sa session.
- [ ] Fermer un onglet : sa mascotte disparaît de l'île et l'île se rétrécit, toujours centrée.

### 1.3 Aux quatre échelles

À faire au moins à votre échelle habituelle, et à 150 % si vous pouvez changer.

- [ ] 100 % : congés nets, sans liseré.
- [ ] 125 % : idem.
- [ ] 150 % : idem, c'est l'échelle fractionnaire la plus sensible (un pixel de recouvrement est prévu pour elle).
- [ ] 200 % : idem.
- [ ] Après un changement d'échelle Windows sans redémarrer Ledge, l'île se replace correctement (au pire après un repli et une ouverture).

---

## 2. Journée chargée

Objectif : l'île ne dépasse jamais 300 px de large ni six compagnons.

Ouvrir sept sessions ou plus (`ledge claude` dans sept onglets ; `Ctrl+Alt+N` sept fois marche aussi, voir la partie 7).

- [ ] Six mascottes au plus dans l'île, puis une pastille « +1 » (ou « +n ») en police mono.
- [ ] L'île reste à 300 px de large au maximum, toujours centrée.
- [ ] Provoquer une demande d'accord dans la septième session (celle qui n'est pas dans l'île) : sa mascotte passe devant, dans l'île, et une autre bascule dans le « +n ».
- [ ] Un clic sur la pastille « +n » ouvre la liste.
- [ ] Dans la liste, douze sessions défilent à l'intérieur du panneau ; le sous-titre compte les demandes en attente.
- [ ] Fermer des onglets jusqu'à six sessions : la pastille disparaît.

---

## 3. La bulle : une demande, un tour terminé

Objectif : la bulle n'est plus une fenêtre à côté de l'île, c'est l'île qui s'étire.

### 3.1 Une demande d'accord

Provoquer une demande d'accord (voir la partie 0) pendant que vous regardez l'île, sans la survoler.

- [ ] Le compagnon grossit d'abord dans l'île (environ 280 ms), puis l'île s'élargit des deux côtés et descend.
- [ ] L'île fait 440 px de large : la mascotte à gauche, « Otto attend votre accord », la commande et le dossier en mono, Refuser et Autoriser dessous.
- [ ] Un trait rouge de 2 px au bas de l'île compte 4 secondes.
- [ ] Rien ne vous vole le focus : vous continuez à taper dans le terminal pendant que la bulle est affichée.
- [ ] Sans rien faire, la bulle se replie après 4 s ; la mascotte garde son halo rouge dans l'île.
- [ ] Survoler la bulle suspend le compte à rebours (le trait s'arrête) ; en sortir le reprend.
- [ ] Cliquer Autoriser : la bulle se replie, le terminal montre que Claude Code a reçu la réponse, le halo repasse au bleu.
- [ ] Refaire avec Refuser : même chose, la commande n'est pas exécutée.
- [ ] Cliquer sur le texte de la bulle (ni Refuser ni Autoriser) ouvre la session complète.

### 3.2 Deux demandes en même temps

Provoquer une demande dans deux sessions à quelques secondes d'intervalle.

- [ ] La bulle montre la première avec « +1 autre » à droite.
- [ ] Après la décision (ou le délai), la seconde demande prend la place.
- [ ] Une demande qui arrive pendant une bulle verte de tour terminé remplace la bulle verte.

### 3.3 Un tour terminé

Envoyer « Dis bonjour. » à une session.

- [ ] Même geste en vert : « Otto a terminé », la durée du tour et le dépôt, OK et Ouvrir, pendant 6 s.
- [ ] Ouvrir mène à la session, avec la dernière réponse lue comme un plan.
- [ ] Réglages > Notifications > « Quand un bot ou Ledge a terminé » sur « Île seule » : plus de bulle verte, le compagnon grossit seulement dans l'île. Remettre « Bulle et son » après.

### 3.4 Ne pas déranger

Activer Ne pas déranger (Réglages > Notifications, ou `D` dans la liste, ou le menu de l'icône).

- [ ] Une lune apparaît à droite des mascottes dans l'île.
- [ ] Les halos s'éteignent.
- [ ] Une nouvelle demande ne sort aucune bulle et aucun son ; la mascotte le signale dans l'île et la demande attend dans la liste.
- [ ] Désactiver : la lune disparaît, les halos reviennent. La demande déjà en attente ne ressort pas en bulle (c'est voulu).

---

## 4. Le mode discret

Objectif : sous une fenêtre maximisée, l'île se réduit à un trait et ne gêne ni les titres ni les onglets.

Garder deux sessions ouvertes. Maximiser un navigateur sur l'écran de l'île.

- [ ] Une demi-seconde après la maximisation, l'île devient un trait de 10 px de haut, un point par session dans la couleur de son état, congés plus petits.
- [ ] Les onglets du navigateur restent lisibles et cliquables autour du trait.
- [ ] Poser le curseur sur le trait : l'île compacte revient, puis la liste descend après 180 ms.
- [ ] Sortir du panneau : il se replie, l'île redevient trait 500 ms plus tard.
- [ ] Poser le curseur sur le bord supérieur juste à côté du trait (dans les 40 px de chaque côté) : même redéploiement.
- [ ] `Ctrl+Alt+L` redéploie l'île et ouvre la liste.
- [ ] Une demande d'accord redéploie l'île en bulle, puis elle redevient trait après le repli.
- [ ] Un tour terminé fait de même en vert.
- [ ] Restaurer le navigateur (plus maximisé) : l'île compacte revient d'elle-même.
- [ ] Une fenêtre en plein écran (F11 dans le navigateur) donne aussi le trait.
- [ ] Réglages > Affichage > « Mode discret sous une fenêtre » désactivé : sous une fenêtre maximisée, l'île reste compacte. Réactiver après.
- [ ] Cas limite : une réponse non lue de Ledge (partie 8) pendue sous sa mascotte garde l'île compacte au lieu du trait.

---

## 5. Position et écran

### 5.1 Position de l'île

Réglages > Affichage > Position de l'île.

- [ ] « À gauche » : l'île se déplace au quart gauche de l'écran, sans redémarrage, avec une transition fluide.
- [ ] « À droite » : au quart droit.
- [ ] Dans chaque position, la liste, la bulle et une session s'ouvrent centrées sur le même axe que l'île.
- [ ] À droite, ouvrir le lecteur Markdown élargi (800 px, partie 8) : le panneau est repoussé pour rester dans l'écran, il ne sort pas à droite.
- [ ] Le réglage survit à un redémarrage de Ledge.
- [ ] Revenir sur « Centre ».

### 5.2 Plusieurs écrans

Si vous avez un second écran.

- [ ] Réglages > Affichage > Écran : chaque écran est listé avec sa résolution ; « Principal » est le défaut.
- [ ] Choisir l'autre écran : l'île s'y pose en haut, centrée, immédiatement.
- [ ] Le mode discret suit cet écran : maximiser une fenêtre sur l'autre écran ne réduit pas l'île.
- [ ] Débrancher l'écran choisi : l'île revient sur le principal ; le réglage affiche « Débranché » et reprend l'écran quand il revient.
- [ ] Une échelle différente sur chaque écran : l'île garde 38 px logiques sur chacun.

### 5.3 Barre des tâches en haut

Point ouvert de la spec : à valider en vrai.

- [ ] Placer la barre des tâches Windows en haut (Paramètres > Personnalisation > Barre des tâches, ou un outil tiers sur Windows 11) : l'île se pose sous la barre, pas dessus.
- [ ] Noter si elle semble flotter et si les congés restent lisibles contre la barre.
- [ ] Remettre la barre en bas.

---

## 6. Survol, clic en dehors, repli

### 6.1 Le survol

- [ ] Poser le curseur sur l'île : la liste descend après 180 ms, sans clic.
- [ ] Poser le curseur sur le bord supérieur à 20 px à côté de l'île : même ouverture (la bande chaude dépasse l'île de 40 px de chaque côté).
- [ ] À 100 px de l'île sur le bord : rien ne s'ouvre.
- [ ] Noter si la bande de 10 px est confortable à viser avec une barre d'onglets juste dessous (point ouvert de la spec ; l'épaissir à 14 px est l'option envisagée).
- [ ] Sortir du panneau : il remonte 500 ms après.
- [ ] Cliquer dans le champ « Demander à Ledge » puis sortir du panneau avec le curseur : il reste ouvert tant que le champ a le focus.
- [ ] Ouvrir une session (clic sur une ligne) puis sortir avec le curseur : elle ne se replie jamais au survol.

### 6.2 Clic en dehors

- [ ] Liste ouverte, cliquer sur le bureau ou une autre fenêtre : l'île se replie.
- [ ] Session ouverte, cliquer ailleurs : elle se replie aussi.
- [ ] Après un clic en dehors, la fenêtre cliquée garde le focus (Ledge ne le reprend pas).

### 6.3 Le repli

- [ ] Au repli, le panneau remonte dans l'île, l'île garde sa largeur compacte à la fin, centrée.
- [ ] Aucun fragment de panneau ne reste visible sous l'île après la transition.
- [ ] Échap dans une session : retour à la liste ; Échap encore : repli.

---

## 7. Le clavier, et les trois correctifs de 0.2.1

Objectif : tout ce qui s'ouvre au clavier a la bonne taille et descend depuis le bord.

### 7.1 La liste au raccourci (correctif 0.2.1)

Depuis n'importe quelle fenêtre au premier plan, l'île repliée.

- [ ] `Ctrl+Alt+L` : la liste descend depuis l'île, son bord supérieur collé au bord de l'écran. Elle ne doit pas apparaître décalée vers le haut, ni sortir de l'écran par le haut.
- [ ] L'en-tête de la liste (« Demander à Ledge », les boutons) est entièrement visible dès la fin de l'animation.
- [ ] La première ligne a le focus (la demande la plus ancienne s'il y en a une).
- [ ] Refaire depuis le trait du mode discret : même résultat.
- [ ] Refaire avec dix sessions ou plus : la ligne qui a le focus est visible, la liste a défilé à l'intérieur du panneau si besoin, jamais le panneau lui-même.
- [ ] `Ctrl+Alt+L` à nouveau : repli, et le focus revient à la fenêtre d'avant (vous pouvez taper dans le terminal sans cliquer).

### 7.2 Nouvelle session au raccourci (correctif 0.2.1)

- [ ] Depuis l'île repliée, `Ctrl+Alt+N` : le formulaire s'ouvre à la hauteur de son contenu, pas sur toute la hauteur de l'écran.
- [ ] Comparer avec le formulaire ouvert par le `+` de la liste : même hauteur, à quelques pixels près pendant l'animation.
- [ ] Refaire avec zéro dossier récent, puis avec cinq : la hauteur suit le contenu dans les deux cas.
- [ ] Le champ Dossier a le focus dès l'ouverture, les touches y arrivent sans clic.
- [ ] `Ctrl+Alt+N` à nouveau : repli.

### 7.3 Le dernier interrupteur (correctif 0.2.1)

- [ ] Dans le formulaire, entre « Ouvrir l'onglet du terminal » et la rangée Annuler / Démarrer : un seul trait de séparation, pas deux.
- [ ] Les autres rangées gardent leur trait.

### 7.4 Navigation

Avec trois sessions dont une demande d'accord.

- [ ] `Ctrl+Alt+L` ouvre sur la demande la plus ancienne ; `J` et `K` montent et descendent.
- [ ] `Y` autorise, `N` refuse directement depuis la liste.
- [ ] `Entrée` ouvre la session sélectionnée ; `Alt ←` et `Alt →` passent à la session précédente ou suivante, depuis la liste comme depuis une session.
- [ ] `R` dans la liste ouvre la session et place le curseur dans le champ de réponse.
- [ ] `O` ouvre l'onglet du terminal de la session.
- [ ] `D` bascule Ne pas déranger.
- [ ] `/` donne le focus au champ « Demander à Ledge ».
- [ ] `?` ouvre les raccourcis ; `Ctrl+Alt+T` bascule le thème.
- [ ] Les trois premières ouvertures au clavier montrent le coachmark sous le panneau, centré sur l'axe de l'île ; « Compris » le ferme pour de bon.
- [ ] Tab passe d'un contrôle à l'autre sans rien casser.

---

## 8. Les vues, ancrées sous l'île

Objectif : chaque vue existante s'ouvre sous l'île à sa largeur habituelle et replie à l'île.

| Vue | Comment l'ouvrir | Largeur attendue |
| --- | --- | --- |
| Liste | Survol, `Ctrl+Alt+L`, clic sur Ledge | 380 px |
| Session | Clic sur une ligne ou une mascotte | 480 px |
| Réponse complète | Interrupteur « Réponse complète, telle quelle » dans une session | 560 px |
| Lecteur Markdown | Lien vers un fichier `.md` dans une réponse | 560 px, 800 px élargi |
| Chat Ledge | `Entrée` sur le champ vide, ou clic sur sa mascotte | 380 px |
| Nouvelle session | `+` ou `Ctrl+Alt+N` | 380 px |
| Réglages, Aide | Boutons de l'en-tête, `?` | 380 px |

- [ ] Chaque vue garde son bord supérieur sur le bord de l'écran et s'étend vers le bas, centrée sur l'axe de l'île.
- [ ] Le passage liste → session élargit le panneau de 380 à 480 px symétriquement.
- [ ] Une session avec une longue réponse : le panneau s'arrête à 40 px du bas de l'écran et le contenu défile dedans.
- [ ] Le lecteur Markdown élargi (800 px) reste dans l'écran.
- [ ] Le chat Ledge : poser « Où en sont les autres ? », regarder les étapes puis la réponse s'écrire ; les noms des bots sont des liens vers leur session.
- [ ] Une réponse de Ledge non lue : sa mascotte le signale dans l'île, un clic sur elle ouvre le chat au lieu de la liste.
- [ ] Nouvelle session > bouton dossier : le navigateur de dossiers WSL, le fil d'Ariane, « Nouveau dossier », « Choisir ce dossier » ; ce qui était tapé dans le reste du formulaire est conservé.
- [ ] Démarrer une session depuis le formulaire : la ligne apparaît avec le badge Démarrage, une notice dans la liste pendant quelques secondes, le bouton « Ouvrir le terminal » ouvre l'onglet.
- [ ] Réglages > Affichage > « Taille de l'île » à 150 % : l'île et ses mascottes grossissent, les panneaux non. « Taille des fenêtres » à 125 % : les panneaux grossissent, l'île non. Remettre Auto.
- [ ] Thème clair (Galet) : l'île et ses congés en blanc, sans liseré, toujours découpée dans le bord.

---

## 9. Les autres harnais

Si Codex ou Cursor Agent sont installés.

- [ ] `ledge codex` : une mascotte rejoint l'île, les états suivent (au travail, terminé).
- [ ] `ledge cursor` : idem ; une demande d'accord du shell de Cursor apparaît en bulle rouge.
- [ ] Réglages > Affichage > « Harnais par défaut » : `Ctrl+Alt+N` propose ce harnais en premier.

---

## 10. Robustesse

- [ ] Arrêter le daemon (`systemctl --user stop ledge-daemon.service`) : l'île passe en « connexion perdue », estompée, les mascottes figées ; les boutons sont désactivés avec la raison.
- [ ] Le redémarrer : tout revient sans relancer Ledge, les sessions retrouvent leur état.
- [ ] Redémarrer Ledge pendant que des sessions tournent : elles sont dans l'île au relancement.
- [ ] Verrouiller la session Windows puis la déverrouiller : l'île est toujours à sa place.
- [ ] Mettre le PC en veille, le réveiller : idem.
- [ ] Laisser Ledge tourner une demi-journée : pas de dérive de position, pas de bulle fantôme, pas de panneau resté ouvert.
- [ ] Quitter Ledge depuis le menu de l'icône : la fenêtre disparaît, aucun processus Ledge ne reste dans le Gestionnaire des tâches.

---

## Grille de résultats

À remplir et à coller dans l'issue ou dans le fichier de notes de la version.

| Partie | OK | KO | Remarques |
| --- | --- | --- | --- |
| 1. L'île au repos | | | |
| 2. Journée chargée | | | |
| 3. La bulle | | | |
| 4. Le mode discret | | | |
| 5. Position et écran | | | |
| 6. Survol, clic, repli | | | |
| 7. Clavier et correctifs 0.2.1 | | | |
| 8. Les vues | | | |
| 9. Les autres harnais | | | |
| 10. Robustesse | | | |

Environnement : Windows ___ · échelle ___ % · écrans ___ · Ledge 0.2.1 · daemon au commit ___

### Points ouverts de la spec à trancher pendant cette recette

1. La bande chaude de 10 px au bord supérieur est-elle assez confortable à viser avec une barre d'onglets juste dessous ? Sinon, 14 px.
2. Barre des tâches en haut : l'île sous la barre semble-t-elle flotter ?
3. La liste à 380 px est-elle assez lisible, ou faut-il les 440 px de la maquette ?
4. Plusieurs écrans : une île secondaire ou une bulle sur l'autre écran manque-t-elle ?

### Ce qui est déjà couvert par les tests automatiques

Pour ne pas refaire à la main ce que la machine vérifie : 501 tests unitaires et 48 spécifications Playwright tournent sur chaque commit (`pnpm test`, `pnpm exec playwright test` dans `apps/overlay`). Ils couvrent la géométrie de l'île et des congés, la machine à états des ouvertures, les trois correctifs de 0.2.1 (hauteur du formulaire au raccourci, dernier interrupteur, aucun défilement de la page à l'ouverture clavier), les raccourcis, le formulaire et le navigateur de dossiers. Ce qu'ils ne voient pas, et que seule cette recette voit : la fenêtre native (position, échelle, écrans, barre des tâches), le mode discret sous une vraie fenêtre maximisée, le focus Windows, les sons et les vrais agents.
