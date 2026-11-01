# La musique dans l'encoche

Date : 2026-10-30 · Session Otto · Maquette : https://claude.ai/artifact/DaFP6LCGbabjS6grB1yww9 (copie : `docs/mockups/ledge-notch-music.html`)

Repères : [U] décidé par l'utilisateur, [O] choix d'Otto que l'utilisateur a vu et accepté, [B] laissé au builder.

## 1. Intention

Pendant que ses agents travaillent, l'utilisateur écoute de la musique dans un onglet du navigateur (YouTube Music). Il veut voir le morceau en cours et le piloter depuis l'encoche de Ledge, sans aller chercher l'onglet. [U]

L'encoche fermée devient : `Ledge | message (s'il y en a) | pochette`. Au survol de la pochette : `Ledge | message | pochette ⏮ ⏯ ⏭`. [U]

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Afficher la pochette du morceau en cours à droite de l'encoche fermée. [U]
- Au survol de la pochette, faire apparaître précédent, lecture/pause et suivant, qui pilotent le lecteur. [U]
- Activer et régler la fonction dans Ledge Desktop › Réglages › Encoche. [U]

**Non-objectifs**
- Le « J'aime » : Windows ne l'expose pas, il faudrait une extension ou un compte Google. Retiré de cette version. [U]
- Tout code ou réglage propre à YouTube Music. On traite **tous les lecteurs** que Windows connaît (navigateurs, Spotify, VLC…), sans choix de lecteur. [U]
- La musique dans l'encoche ouverte (le fil de Ledge). [O]
- Les autres idées pour l'encoche (dépôt de fichier, silence en réunion, CI, quota, minuteur) : plus tard, une à la fois. [U]

**Anti-objectifs** (raté même si ça marche)
- Demander une connexion à un compte (Google, Spotify…).
- Gêner le chantier de Plume sur l'encoche (voir §6).
- Que la pochette chasse le message de Ledge de façon illisible, ou l'inverse : si la place manque, c'est le **message** qui se coupe avec « … », jamais la pochette. [O]

## 3. Source : les contrôles média de Windows

Windows publie la « session média » de chaque lecteur qui s'y déclare (Global System Media Transport Controls, `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`). Chrome et Edge le font pour un onglet YouTube Music, comme Spotify ou VLC. On y trouve titre, artiste, vignette, état de lecture, et on peut demander précédent / lecture-pause / suivant. Aucune connexion. [O]

- **Quelle session :** la session courante que Windows met en avant (`GetCurrentSession`, celle de son panneau média). Quand elle change, l'encoche suit. [O]
- **Où :** dans le processus Rust de Ledge Desktop (`apps/desktop/src-tauri`), qui porte aussi l'encoche depuis la fusion en une seule app. Le crate `windows` y est déjà (0.58, `cfg(windows)`) ; il faut ajouter les features WinRT nécessaires. [B pour les features exactes]
- **Hors Windows** (dev sous WSL/Linux, CI) : le lecteur est un no-op qui annonce « rien ne joue ». Les tests TS n'en dépendent pas.
- **Quand :** le lecteur n'écoute Windows que si le réglage est activé. Désactivé, aucune souscription.
- **Ce qui sort vers les webviews** (Desktop et encoche), par un événement Tauri : `null` (rien ne joue) ou `{ title, artist, playing, cover, canPrev, canNext, source }`.
  - `cover` est une image petite (≈ 96 px, data URL ou chemin servi), lue depuis la vignette de la session ; absente si le lecteur n'en fournit pas. Le format et le cache sont [B], en tenant compte de la CSP de Desktop (voir la note `desktop-csp` : un `data:` d'image a déjà dû être autorisé pour les avatars, cf. branche `fix/avatar-csp`).
  - `source` est le nom lisible de l'application (« Chrome », « Spotify ») pour la ligne « Détecté » des réglages.
  - Les changements (morceau, pause, vignette) sont poussés, pas sondés à l'aveugle ; le mécanisme (événements WinRT ou relecture courte) est [B].
- **Commandes** : une commande Tauri `media_control { action: 'prev' | 'toggle' | 'next' }` appelée par l'encoche. Un bouton dont l'action n'est pas permise (`canPrev` / `canNext` faux) est désactivé.

## 4. Réglage

Dans `IslandPrefs` (`packages/protocol/src/island.ts`), comme les autres réglages de l'encoche : sauvé par le daemon (`island.set`), diffusé à Desktop et à l'encoche. [O]

```ts
music: {
  enabled: boolean,                       // défaut false
  hover: 'controls' | 'controls-title',   // défaut 'controls' (variante A)
  paused: 'always' | '5min' | 'hide'      // défaut '5min'
}
```

- Désactivé par défaut. [O]
- Le champ doit rester compatible avec un daemon ou un front plus ancien qui ne le connaît pas (défaut à la lecture, pas de refus). Le moyen (`.default()` zod, migration) est [B].

**Carte « Musique » dans Réglages › Encoche** (`apps/desktop/src/settings/Island.tsx`), après la carte « Ce que fait l'encoche ». Libellés FR (l'EN suit dans `i18n`) : [O]

| Ligne | Contrôle | Aide |
|---|---|---|
| Afficher la musique en cours | interrupteur | Pochette, puis précédent, lecture/pause et suivant au survol. Aucune connexion à ton compte. |
| En pause | segmenté : Toujours · 5 min · Masquer | Combien de temps la pochette reste visible après une pause. |
| Au survol | segmenté : Commandes · Commandes et titre | Ce qui s'ajoute à la pochette. |
| (statut) | — | « Détecté : *titre · artiste*, lu par *Chrome* », ou « Rien ne joue en ce moment ». |

En-tête de carte : « Musique » / « Le morceau en cours sur ton PC, à droite de l'encoche. » Les lignes sous l'interrupteur sont grisées quand il est coupé, comme les autres cartes quand l'encoche est masquée. Hors Windows, la ligne de statut dit que la fonction n'est disponible que sous Windows. [B pour le texte exact]

## 5. L'encoche

Selon la maquette (états 1 à 5 et variantes A/B) :

- **Place :** à droite, après le message. Un trait vertical fin (`--sidebar-border`, comme le séparateur de machines actuel) sépare le message de la pochette ; sans message, il sépare Ledge de la pochette.
- **Pochette :** carré de 24 px, coins de 5 px. En lecture, trois petites barres animées (accent rouge) dans son coin ; arrêtées sous `prefers-reduced-motion`. Sans vignette : un carré neutre avec une note de musique. [B pour le dessin]
- **En pause :** pochette grisée avec le signe pause ; elle disparaît selon le réglage `paused` (5 min par défaut ; « Masquer » = tout de suite ; « Toujours » = tant que la session existe).
- **Rien ne joue / réglage coupé / hors Windows :** ni trait ni pochette ; l'encoche est celle d'aujourd'hui.
- **Survol de la pochette :** l'encoche s'élargit vers la droite ; apparaissent ⏮, un disque clair ⏯, ⏭ (variante A, ≈ +90 px). Variante B (`controls-title`) : titre et artiste sur deux lignes entre la pochette et les commandes, ≈ 150 px max, coupés avec « … ». Le titre complet est toujours dans l'info-bulle de la pochette. Quitter la zone referme après un court délai (~250 ms) ; l'élargissement s'anime avec les transitions de l'encoche (`motion.ts`).
- **Clavier :** la pochette est atteignable au clavier ; focus = même ouverture que le survol ; les trois boutons ont des libellés accessibles (« Précédent », « Pause » / « Lecture », « Suivant »).
- **Ne pas déranger :** la musique reste visible. [O]
- **Encoche ouverte :** pas de musique. [O]
- **Visible au repos, sans survoler l'encoche.** [U] C'est le but : voir le morceau sans aller le chercher. On s'aligne sur l'encoche fermée de Plume (tâche 13) :
  - si son « Ledge | message » s'affiche au repos, la pochette se range à côté ;
  - si son repos reste le filet de 10 px, l'encoche au repos grandit juste assez pour montrer Ledge et la pochette (pastille de la hauteur de l'encoche éveillée), et seulement quand de la musique est visible ; sans musique, le filet reste tel quel.
  Dans les deux cas, survoler la **pochette** ouvre les commandes ; survoler le reste de l'encoche garde son comportement actuel.
- **Encoche discrète** (la « strip » sous une fenêtre maximisée) : pas de pochette, la strip reste une ligne. [O, défaut raisonnable : une fenêtre maximisée prime]
- **Priorité de place :** la pochette et ses commandes ont une largeur fixe ; le message de Ledge se coupe en premier.
- La géométrie de l'encoche (`surface/geometry.ts`, épaules `Shoulders.tsx`, hot zone envoyée à Rust par `set_hot_zone`, cadre `set_frame`) doit inclure la zone de la musique, ouverte ou non, au repos comme éveillée, pour que le survol et les clics arrivent bien à la fenêtre. C'est la partie la plus délicate de la partie 2 ; prévoir des tests de géométrie.

## 6. Découpage et coordination avec Plume [U]

L'encoche « Ledge | message » n'existe pas encore : c'est la tâche 13 du lot 4 du chantier OpenRig de Plume (`docs/superpowers/plans/2026-10-30-ledge-openrig-4-fil-et-reponses.md`, branche `docs/ledge-openrig-orchestrator`), qui réécrit `apps/overlay/src/surface/Handle.tsx`. Pour ne pas se marcher dessus :

**Partie 1 — maintenant, sans toucher `Handle.tsx` :**
- le lecteur Windows et la commande `media_control` côté Rust ;
- le champ `music` d'`IslandPrefs` et sa compatibilité ;
- la carte « Musique » dans Réglages › Encoche, avec la ligne « Détecté » branchée sur le vrai lecteur ;
- côté encoche, la couche données seulement (l'abonnement à l'événement, l'état « visible ou non » qui applique `paused` et `enabled`), testable sans rendu.

**Partie 2 — après la tâche 13 de Plume, sur sa version de `Handle.tsx` :**
- le rendu de la pochette, du trait et des commandes dans l'encoche fermée, la géométrie et la hot zone.

Avant la partie 2, relire la tâche 13 telle qu'elle a été livrée, et prévenir Plume (`ledge` SendMessage) que la partie 2 va toucher `Handle.tsx`.

**Intégration** [U] : la partie 1 reste sur sa branche (`feat/notch-music`) et n'est pas fusionnée seule, pour ne pas livrer un interrupteur qui ne fait rien. Les deux parties arrivent sur main ensemble, après la partie 2. La partie 1 ne touche pas les fichiers de Plume ; on la rebase sur main au besoin.

**Déjà vérifié** (relecture du 2026-10-30) :
- la CSP de Desktop autorise déjà `img-src data: blob:` : une pochette en data URL passe ;
- un daemon plus ancien retire les clés inconnues d'`IslandPrefs` au lieu de refuser : le champ `music` ne le casse pas ;
- Rust ne lit pas les réglages de l'encoche aujourd'hui : c'est la webview qui dit à Rust si la musique est activée (commande Tauri, nom [B]), pour qu'il n'écoute Windows que dans ce cas.

## 7. Vérification

- Tests unitaires TS : schéma `IslandPrefs` (défauts, ancien fichier sans `music`), la logique de visibilité (pause + délai, désactivé, `null`), la carte de réglages (playwright Desktop avec le faux daemon `apps/desktop/e2e/daemon.ts`).
- Rust : tests et build uniquement sous Windows (recette « Windows build recipe » : `C:\Users\Desan\Workspace\ledge` via `powershell.exe`). Le lecteur sépare la traduction session WinRT → charge utile en fonction pure, testable sans Windows si possible. [B]
- Essai réel, avec l'accord de l'utilisateur, sur son PC : un onglet YouTube Music joue → la carte de réglages le détecte ; partie 2 : pochette, pause, suivant depuis l'encoche ; puis un autre lecteur (Spotify ou VLC) pour vérifier « tous les lecteurs ».

## 8. Laissé au builder

Les features WinRT du crate `windows` ; le format et la taille de la vignette, et le respect de la CSP ; pousser vs relire les changements de session ; le nom de l'événement Tauri ; le dessin de la pochette par défaut ; les libellés EN ; le texte « hors Windows ».
