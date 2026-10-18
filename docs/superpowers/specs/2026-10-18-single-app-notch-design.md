# Une seule application : Ledge Desktop porte l'encoche

Date : 2026-10-18

## Intention

Aujourd'hui, Ledge, ce sont deux programmes Windows. Chacun a son installeur, son icône dans la zone de notification, son lancement au démarrage et ses mises à jour :

| Programme | Exécutable | Rôle |
|---|---|---|
| Ledge (l'« île ») | `%LOCALAPPDATA%\Ledge\ledge-overlay.exe` (`apps/overlay`) | la barre en haut de l'écran |
| Ledge Desktop | `%LOCALAPPDATA%\Ledge Desktop\ledge-desktop.exe` (`apps/desktop`) | la fenêtre : sidebar, atelier, Réglages |

Le 2026-10-18, l'utilisateur ne voyait plus le notch. Pourtant, Réglages › Île disait « visible » : `ledge-overlay.exe` ne tournait tout simplement pas, et rien ne le relançait. Il veut :

- **installer Ledge Desktop, et avoir les deux** ;
- **une seule icône** dans la zone de notification ;
- **quitter Ledge Desktop, c'est aussi fermer le notch** ;
- **renommer « île »** : « Encoche » en français, « Notch » en anglais, selon la langue de l'interface.

## Objectifs

1. Un seul processus Tauri, Ledge Desktop. Il ouvre deux fenêtres : `main` (la fenêtre actuelle de Desktop) et `notch` (l'ancienne overlay : transparente, toujours au premier plan, sans bouton dans la barre des tâches).
2. Une seule icône de notification, un seul lancement au démarrage (`--minimized`), un seul updater (`latest-desktop.json`), une seule instance.
3. Le notch se comporte exactement comme aujourd'hui : suivi du curseur, clics qui traversent hors du dessin, raccourcis globaux, choix de l'écran, masquage quand une fenêtre est en plein écran, focus clavier, Ne pas déranger, sons, bulles, mascotte, robots.
4. Fermer la fenêtre `main` la renvoie dans la zone de notification, comme aujourd'hui, et le notch reste. « Quitter », depuis la zone de notification ou depuis le menu du notch, ferme tout.
5. L'installeur de Ledge Desktop retire l'ancien programme « Ledge » s'il est présent. Il ne doit jamais rester deux notches.
6. Dans les deux langues, l'interface dit « Encoche » / « Notch » partout où elle disait « île » / « island ».

## Non-objectifs

- Aucun changement visuel ni de comportement du notch, hors son nom et ce qui découle de la fusion : menu de la zone de notification, mises à jour, démarrage.
- Pas de renommage interne. Les fichiers, types, clés i18n, l'événement `island` / `island.set` du daemon, `~/.ledge/island.json` et `apps/overlay` gardent leur nom. Seul le texte affiché change.
- Pas de changement du daemon.
- Pas de macOS ni de Linux : la cible reste Windows (le code non-Windows existant reste compilable, comme aujourd'hui).

## Anti-objectifs (échec même si « ça marche »)

- Deux icônes dans la zone de notification, ou deux notches à l'écran après l'installation.
- Quitter Desktop laisse un notch orphelin, ou quitter le notch laisse une fenêtre Desktop sans encoche, sans le dire.
- Une régression du notch : clics qui ne traversent plus, transparence qui devient blanche (jamais `SetWindowRgn`, cf. v0.3.2), saut ou clignotement à l'animation, mascotte qui ne suit plus le curseur.
- Le notch qui vole le focus de la fenêtre Desktop, ou l'inverse.
- Le notch qui apparaît dans la barre des tâches ou dans Alt+Tab.

## Contraintes et état actuel

- Les deux shells sont des apps Tauri 2 qui partagent `crates/ledge-native` : `apps/overlay/src-tauri/src/main.rs` (~640 lignes) et `apps/desktop/src-tauri/src/main.rs` (~180 lignes).
- **Collisions à résoudre :**
  - les deux fenêtres s'appellent `main` ;
  - l'overlay cherche `get_webview_window("main")` dans `own_hwnd` et dans le poller ;
  - les deux émettent `ledge://tray` à toute l'app (`app.emit`) ;
  - les deux exposent `set_tray_labels`, `get_autostart` / `set_autostart`, `open_url`, `focus_terminal`, `open_terminal` et `foreground_is_terminal` ;
  - les deux pages partageront la même origine (`http://tauri.localhost`), donc le même `localStorage`. Leurs préférences ont des préfixes distincts (`ledge.*` pour le notch, `desktop.*` pour Desktop : `dnd`, `theme`, `accent`, `lang`), donc rien ne se mélange ni ne se synchronise tout seul.
- **Le notch, côté Rust :**
  - plugins : `global-shortcut` en plus de ceux de Desktop ;
  - état géré : `OutsideWatch`, `PrevForeground`, `Screen` ;
  - le poller du curseur tourne dans un thread ;
  - commandes `set_frame`, `set_hot_zone`, `set_outside_watch`, `focus_overlay`, `release_focus`, `list_monitors`, `set_monitor` et `open_in_ledge` ;
  - `Cargo.toml` dépend de `windows 0.58`.
- **Côté Desktop :**
  - `single-instance` ;
  - `window-state`, qui ne doit pas toucher la fenêtre `notch` ;
  - `--open <cible>` et `take_open_target` (« Open in Ledge ») ;
  - autostart avec `--minimized` ;
  - fermer la fenêtre la cache.
- `open_in_ledge`, côté notch, lance aujourd'hui `ledge-desktop.exe --open`. Dans l'app unique, il doit montrer `main` et livrer la cible en interne, sans passer par un nouveau processus.
- Le frontend du notch (`apps/overlay/src`, port Vite 1420) a ses propres tests unitaires et e2e Playwright, lancés contre son serveur Vite. Ils doivent continuer à tourner.
- La page de Desktop tourne sur le port 1421, et le daemon autorise cette origine en dev.
- Installation : NSIS `currentUser`, hooks `windows/hooks.nsh`. Le hook de désinstallation de l'ancien Ledge retire sa clé `Run` et son marqueur d'autostart.
- Recette de build Windows : voir le mémo du projet (PowerShell depuis `C:\Users\Desan\Workspace\ledge`, `cargo clean -p` après un changement d'icône).

## Décisions

### De l'utilisateur

- Un seul installeur : celui de Ledge Desktop.
- Une seule icône de notification. Quitter ferme tout, notch compris.
- Le nom suit la langue : « Encoche » en FR, « Notch » en EN.

### Mes choix (à vérifier)

1. **Un seul processus, pas un programme lancé en arrière-plan.** C'est l'app Desktop (identifiant `be.paradow.ledge.desktop`, produit « Ledge Desktop ») qui ouvre la fenêtre `notch`. Le code Rust du notch quitte `apps/overlay/src-tauri` pour un module de l'app Desktop, ou pour `ledge-native` quand il est réutilisable. Ensuite, `apps/overlay/src-tauri` est supprimé. `apps/overlay` reste un paquet frontend (sources, tests, e2e, serveur Vite de dev).
2. **Pages :** le build de Desktop produit aussi la page du notch, chargée par la fenêtre `notch`. Le notch garde son propre point d'entrée et son propre CSS : aucun style de Desktop ne doit fuir dans le notch, ni l'inverse.
3. **Fenêtre `notch` :**
   - mêmes options que l'actuelle fenêtre de l'overlay : transparente, sans décoration, toujours au premier plan, `skipTaskbar`, sans focus au départ, sans ombre, mêmes `additionalBrowserArgs` ;
   - créée au démarrage, même avec `--minimized` ;
   - exclue de `window-state` ;
   - fermer `notch` ne quitte pas l'app (elle n'a de toute façon pas de bouton de fermeture).
4. **Événements et commandes du notch** : les événements propres au notch (`outside-click`, `cursor-near`, `foreground`) vont à la fenêtre `notch` seulement. Le poller cherche `notch`, et non plus `main`.
5. **Zone de notification** : on garde l'icône et le menu de Desktop. Ses éléments :
   - « Ouvrir Ledge Desktop » montre `main` ;
   - « Nouvelle session » ;
   - « Ne pas déranger » : un seul interrupteur, que les deux fenêtres reflètent ;
   - « Quitter Ledge Desktop » ferme tout.

   L'action de zone de notification va aux deux fenêtres. Chacune garde son comportement actuel pour `dnd`, et pour `new` seule `main` agit, sans ouvrir aussi le panneau du notch. Le notch n'appelle plus `set_tray_labels` : seule la langue de Desktop étiquette le menu. Le notch ne construit plus d'icône à lui.
6. **Ne pas déranger** : un seul état pour les deux fenêtres. Le notch lit et écrit la clé `desktop.dnd` de Desktop, et les deux suivent l'événement `storage`. Le thème et l'accent du notch restent les siens, comme aujourd'hui (non-objectif : aucun changement visuel).
7. **« Ouvrir dans Ledge »** (bouton du notch, « Réglages » de son menu) : montre et met au premier plan `main`, puis livre la cible par le chemin `deliver_open` / `ledge://open` existant. `ledge_native::desktop::open` n'est plus appelé par l'app.
8. **Quitter depuis le menu du notch** (`quitApp`) : ferme toute l'app. Le libellé devient « Quitter Ledge », pour que ce soit dit.
9. **Mises à jour et démarrage** (pastille : choix de l'utilisateur) : seul l'updater de Desktop reste. Le notch ne vérifie plus rien lui-même (`useUpdate` est retiré de la fenêtre `notch`). En revanche, **sa pastille de mise à jour reste** et suit l'updater de Desktop : Desktop publie la version disponible sous `desktop.update.available` (absente sinon), et le notch la lit et suit l'événement `storage`. Un clic ouvre Desktop sur `{ kind: 'update' }`, comme aujourd'hui. Seul l'autostart de Desktop reste, avec `--minimized`. Le notch n'expose plus d'interrupteur d'autostart.
9 bis. **Langue** (choix de l'utilisateur) : le notch suit la langue de Desktop (`desktop.lang`, et l'événement `storage` pour un changement en direct). Il n'a plus de réglage de langue à lui.
10. **Migration de l'ancien Ledge** : un hook `NSIS_HOOK_PREINSTALL` de Desktop vérifie si `$LOCALAPPDATA\Ledge\uninstall.exe` existe. Si oui, il arrête `ledge-overlay.exe` et lance cette désinstallation en silencieux, ce qui retire aussi sa clé `Run` grâce à son propre hook. L'installeur ne touche à rien d'autre. Les préférences locales de l'ancien notch (son `localStorage`) sont perdues : ses réglages vivent déjà dans le daemon (`island.json`).
11. **Publication** : la release suivante ne publie plus l'installeur « Ledge » ni `latest.json`. La recette de release est mise à jour en conséquence. Une fois migrée, la seule machine installée n'en a plus besoin.
12. **Renommage, texte seulement :**
    - dans les i18n de `apps/desktop` (dont `foot.island*`, `sections.island`, les descriptions qui parlent de « l'île » / « the island ») et de `apps/overlay` : FR « encoche » (féminin : « l'encoche », « Encoche active / masquée »), EN « notch » ;
    - les libellés ARIA aussi ;
    - les tests qui vérifient ces textes suivent.
13. **Version** : le changement sort comme une nouvelle version mineure (0.7.0) de Desktop.

## Ce qui reste au builder

- Comment le build de Desktop embarque la page du notch : Vite multi-pages, page copiée depuis `apps/overlay/dist`, ou autre. Contraintes : un seul `frontendDist`, `pnpm dev` de Desktop sert aussi le notch, et les e2e de l'overlay tournent toujours sur son propre serveur.
- Où vit le code Rust du notch : un module de l'app Desktop, `ledge-native`, ou un découpage entre les deux.
- La façon de cibler les événements (`emit_to`, filtrage par libellé de fenêtre) et de séparer les commandes qui portent le même nom.
- Les capabilities Tauri : les permissions de `global-shortcut`, etc. doivent couvrir la fenêtre `notch`.
- Les tests : les tests Rust existants des deux shells continuent de passer dans le nouveau shell. On ajoute des tests pour les nouveaux choix purs, par exemple quelle fenêtre reçoit quelle action de zone de notification. Il faut vérifier sur Windows, avec l'app installée, les points de la section « Anti-objectifs ».
