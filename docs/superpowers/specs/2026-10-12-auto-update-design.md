# Mise à jour automatique — design

Date : 2026-10-12 · Projet personnel, hors story Jira · Auteur : Joffrey Desantoine avec Claude Code

Maquette validée : https://claude.ai/artifact/7fTAguyjmNDdnZy5QXuG7A, copie locale [docs/mockups/ledge-update.html](../../mockups/ledge-update.html). Cinq états de la carte (Disponible, En cours, Redémarrage, Échec du daemon, Installé depuis git) et l'onglet « À propos » des réglages.

Statut : implémenté le 2026-10-12 (plan : 2026-10-12-auto-update.md)

## 1. Objectif

Aujourd'hui, mettre Ledge à jour demande deux gestes manuels : `git pull && pnpm install && pnpm --filter ledge build && systemctl --user restart ledge-daemon` dans WSL, puis télécharger et lancer l'installeur sur Windows. Ledge doit savoir qu'une version plus récente existe, le dire, et tout faire d'un clic.

Succès :

- Un tag `vX.Y.Z` publie le daemon sur npm (`@paradow/ledge`) et l'application sur GitHub, avec un fichier `latest.json` signé que l'application installée sait lire.
- Ledge prévient sans interrompre : une pastille sur sa mascotte dans l'île, une carte en haut de la liste, une pastille sur la roue dentée.
- Un clic sur « Mettre à jour » met à jour le daemon, vérifie qu'il est revenu avec toutes les sessions, puis installe l'application et la relance.
- **Aucune session n'est perdue.** Les agents ne sont jamais tués, et le daemon retrouve chaque session après son redémarrage. Si Ledge ne peut pas le garantir, il refuse de redémarrer le daemon et dit pourquoi.
- Rien ne se fait sans clic.

Hors périmètre : une mise à jour silencieuse, des canaux (bêta / stable), le retour à une version précédente depuis l'interface, la signature de code Authenticode (SmartScreen continue d'avertir au premier lancement de l'installeur manuel), macOS et Linux pour l'application.

## 2. Décisions

| Décision | Choix | Pourquoi |
| --- | --- | --- |
| Une version ou deux | Une seule : le tag `vX.Y.Z` est la version du daemon **et** de l'application. | Le protocole évolue des deux côtés à la fois ; deux versions indépendantes créeraient des combinaisons jamais testées. |
| Qui pilote | L'application (overlay). Le daemon exécute. | La release GitHub est la seule source de vérité. Elle est créée *après* la publication npm, donc quand l'application voit une version, le paquet npm existe déjà. |
| Nom npm | `@paradow/ledge`, organisation `paradow`. La commande installée reste `ledge`. | `ledge` est déjà pris sur npm. |
| Visibilité du dépôt | Public, avant le premier tag qui embarque l'updater. | L'application installée lit `releases/latest/download/latest.json` sans jeton. Le paquet npm public expose de toute façon le JS du daemon. |
| Signature des mises à jour | Clé minisign de l'updater Tauri. | L'updater refuse une mise à jour non signée. Ce n'est pas une signature de code Windows. |
| Fréquence | Au démarrage de l'application, puis toutes les 6 heures. | Assez pour voir une version le jour même, sans bruit réseau. |
| Ordre | Daemon d'abord, application ensuite. | Si le daemon échoue, l'application n'a pas bougé et tout fonctionne comme avant. |

Déjà en place (2026-10-12) : l'organisation npm `paradow`, les secrets GitHub `NPM_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. La paire de clés de l'updater est gardée hors du dépôt dans `~/secrets/ledge-updater.key` (`.password`, `.pub`). La perdre empêcherait toute application installée de se mettre à jour.

## 3. Étape 0 — les sessions survivent à un redémarrage du daemon

### Le problème, présent avant cette fonctionnalité

Le serveur tmux `-L ledge` porte toutes les sessions Ledge. tmux le crée au premier `new-session`, comme enfant du processus qui l'a demandé. Quand c'est le daemon qui lance la première session (bouton `+` de l'overlay, `session.launch`), le serveur naît dans le cgroup de `ledge-daemon.service`. Constaté le 2026-10-12 avec `systemctl --user status ledge-daemon` : le serveur tmux (PID 406005) est listé sous le service.

Le service est en `KillMode=control-group` (défaut). `systemctl --user restart ledge-daemon` tue donc tout le cgroup, serveur tmux compris, et avec lui tous les agents. Au démarrage suivant, `startDaemon` (`daemon/index.ts`) retire du journal les sessions dont la session tmux n'existe plus. Résultat : un redémarrage efface tout. C'est vrai aujourd'hui avec la commande du README, et ce serait vrai avec le bouton.

### Le correctif

- `realTmux().newSession` regarde d'abord si un serveur `-L ledge` tourne (`listSessions` non vide, ou `has-session` réussi). S'il n'y en a pas, et que systemd est là (`systemctl --user` répond), il lance la commande `new-session` à travers `systemd-run --user --scope --quiet --collect --unit=ledge-tmux-<horodatage> -- tmux …`. Le serveur naît alors dans son propre scope, hors du service. Sans systemd, rien ne change : il n'y a pas de service à redémarrer.
- Les créations suivantes s'adressent au serveur existant et n'ont pas besoin du scope.
- `ledge uninstall` ne change pas : il signale les sessions encore vivantes sans les tuer.

### Le garde-fou pour les serveurs déjà lancés

Un serveur né avant le correctif reste dans le cgroup du service jusqu'à ce qu'il s'arrête. Avant tout redémarrage qu'il commande, le daemon lit le PID du serveur (`tmux -L ledge display-message -p '#{pid}'`), puis `/proc/<pid>/cgroup`. Si ce chemin contient `ledge-daemon.service`, le daemon **refuse** de redémarrer et répond `update.failed { reason: 'sessions-at-risk' }`. La carte dit alors : « Vos sessions tournent dans le service du daemon : un redémarrage les fermerait. Fermez-les, ou redémarrez WSL, puis réessayez. »

### Ce qui reste vrai pendant le redémarrage

- Les agents tournent dans tmux et ne voient rien.
- Le daemon sauve le journal à l'arrêt (`SIGTERM`) et le relit au démarrage.
- Pendant les deux secondes environ où le daemon est absent, un hook qui tente de le joindre abandonne après 100 ms (comportement voulu). Une demande d'accord manquée est retrouvée par le poller, qui lit le terminal. Un changement d'état comme « terminé » peut arriver avec quelques secondes de retard.

## 4. Publication

Tout part du tag, comme aujourd'hui : `git tag -a vX.Y.Z -F notes.md && git push origin main vX.Y.Z`.

### Le paquet npm

- `packages/ledge/package.json` : `name` devient `@paradow/ledge`, `bin: { "ledge": "./dist/cli/index.js" }`, `files: ["dist"]`, `publishConfig: { access: "public" }`, `engines: { node: ">=22" }`, `repository`, `license`. `@ledge/protocol` passe en `devDependencies`.
- tsup intègre `@ledge/protocol` dans le bundle (`noExternal: ['@ledge/protocol']`) : le protocole n'est pas publié à part. `ws` et `zod` restent des dépendances npm.
- tsup injecte la version : `define: { __LEDGE_VERSION__: JSON.stringify(pkg.version) }`.
- `apps/overlay/scripts/set-version.mjs` écrit aussi la version dans `packages/ledge/package.json`, et `test/version.test.ts` vérifie les cinq fichiers.

### Le workflow `release.yml`

Deux jobs, dans cet ordre :

1. **`npm`** (ubuntu-latest, `permissions: id-token: write, contents: read`) : installation, `set-version.mjs <tag>`, tests et build de `packages/ledge`, puis `npm publish --provenance --access public` depuis `packages/ledge`. Le jeton vient de `NPM_TOKEN` s'il existe. Sinon, npm passe par Trusted Publishing (OIDC), une fois le dépôt déclaré comme éditeur de confiance sur npmjs.com. Si la version existe déjà sur npm (job relancé), l'étape est sautée et ne fait pas échouer le job.
2. **`windows-installer`** (`needs: npm`), le job actuel, avec en plus :
   - `bundle.createUpdaterArtifacts: true` dans `tauri.conf.json`, et les secrets `TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` en variables d'environnement de `pnpm tauri build`. Le build produit `Ledge_X.Y.Z_x64-setup.exe.sig`.
   - L'étape Publish écrit `latest.json` et le joint à la release avec l'installeur :

```json
{
  "version": "0.3.0",
  "notes": "<corps du tag annoté, sans le bloc d'installation>",
  "pub_date": "2026-10-20T09:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenu de Ledge_0.3.0_x64-setup.exe.sig>",
      "url": "https://github.com/Paradow-dev/ledge/releases/download/v0.3.0/Ledge_0.3.0_x64-setup.exe"
    }
  }
}
```

Le bloc d'installation ajouté aux notes de la release indique désormais `npm i -g @paradow/ledge@X.Y.Z` pour le côté WSL.

### Configuration de l'application

`tauri.conf.json` :

```json
"plugins": {
  "updater": {
    "pubkey": "<contenu de ~/secrets/ledge-updater.key.pub>",
    "endpoints": ["https://github.com/Paradow-dev/ledge/releases/latest/download/latest.json"],
    "windows": { "installMode": "passive" }
  }
}
```

Crates `tauri-plugin-updater` et `tauri-plugin-process`, paquets `@tauri-apps/plugin-updater` et `@tauri-apps/plugin-process`, permissions `updater:default` et `process:allow-restart` dans `capabilities`. La CSP ne change pas : l'updater passe par Rust, pas par le WebView.

## 5. Protocole

Tous les ajouts sont optionnels : une application ancienne face à un daemon récent, et l'inverse, continuent de fonctionner. Ils perdent seulement la mise à jour.

Serveur → client :

- `snapshot` gagne `daemon?: { version: string; install: 'npm' | 'git' | 'unknown'; systemd: boolean; manual?: string }`.
- `update.progress { version, step: 'installing' | 'restarting' }`.
- `update.failed { version, reason: 'git-install' | 'no-systemd' | 'sessions-at-risk' | 'npm-failed' | 'busy', detail?: string, command?: string }`. `detail` contient les dernières lignes utiles de npm. `command` est la commande exacte que l'utilisateur peut lancer lui-même.

Client → serveur :

- `update.daemon { version }`.

## 6. Daemon

### Ce qu'il sait de lui-même

- `version` : `__LEDGE_VERSION__`, injectée au build.
- `install` : `npm` si le chemin réel de `process.argv[1]` passe par `/node_modules/@paradow/ledge/`, `git` s'il existe un `.git` dans un parent du script, `unknown` sinon.
- `manual` (optionnel) : la commande à lancer à la main quand Ledge ne peut pas se mettre à jour seul (installation `git`). La carte l'affiche dès l'état « disponible », sans attendre un clic.
- `systemd` : vrai si le processus tourne sous `ledge-daemon.service` (`INVOCATION_ID` présent et `/proc/self/cgroup` contient le nom du service).

### `update.daemon { version }`

Dans l'ordre, chaque refus répondant `update.failed` sans rien toucher :

1. `version` doit être un semver valide, sinon le message est ignoré.
2. Une mise à jour est déjà en cours : `busy`.
3. `install !== 'npm'` : `git-install`, avec `command` = `cd <racine du clone> && git pull && pnpm install && pnpm --filter ledge build && systemctl --user restart ledge-daemon`.
4. `systemd` faux : `no-systemd`, avec la commande npm et « puis relancez `ledge` ».
5. Garde-fou de l'étape 0 : `sessions-at-risk`.
6. Envoie `update.progress { step: 'installing' }`, puis lance `<dirname(process.execPath)>/npm i -g @paradow/ledge@<version>`. C'est le npm du Node qui fait tourner le daemon : sur la machine de référence, c'est celui de nvm, alors que `/usr/bin/npm` (Node 18, préfixe `/usr/local`) demanderait sudo. L'environnement est celui du service, donc le proxy de `proxy.conf` s'applique. Délai maximal : 3 minutes.
7. Échec de npm : `npm-failed`, avec `detail` (par exemple `EACCES /usr/local/lib/node_modules`) et `command`.
8. Succès : envoie `update.progress { step: 'restarting' }`, sauve le journal, puis lance `systemctl --user restart --no-block ledge-daemon.service`. `--no-block` est nécessaire parce que le client `systemctl` vit dans le cgroup qui va être arrêté.

## 7. Application

### La vérification

Un module `update/` contient une machine d'état pure (testable sans Tauri) et un petit adaptateur pour `@tauri-apps/plugin-updater`.

- `check()` au démarrage, puis toutes les 6 heures, et sur « Vérifier » dans À propos.
- Un échec réseau est silencieux. À propos affiche l'heure du dernier succès. Le proxy d'entreprise est à vérifier sur la machine de référence pendant l'implémentation : l'updater passe par `reqwest`, côté Rust.
- La version cible est toujours une release : celle de `latest.json`, quand le daemon ou l'application est en retard sur elle. Si le daemon est déjà à jour ou en avance, l'application seule est proposée. Sans release connue (vérification coupée ou en échec), rien n'est proposé.
- La réponse à « Plus tard » est enregistrée dans `localStorage` (`ledge.update.dismissed = "0.3.0"`). Elle masque la carte et la pastille de l'île jusqu'à une version plus récente. La pastille de la roue dentée reste.
- Le réglage « Rechercher les mises à jour » (actif par défaut) coupe la vérification périodique.

### Le parcours du bouton

```
available
  └─ Mettre à jour ─► daemon.updating      (update.daemon envoyé, sautée si le daemon a déjà la version)
                        ├─ update.failed ─► failed(reason)
                        └─ socket fermé ─► daemon.waiting   (reconnexion, 45 s au plus)
                                             ├─ snapshot avec daemon.version == cible
                                             │   et sessions retrouvées ≥ sessions avant ─► app.downloading
                                             ├─ moins de sessions qu'avant ─► failed('sessions-lost'), l'application n'est pas touchée
                                             └─ délai dépassé ─► failed('daemon-timeout')
app.downloading (progression en octets) ─► app.installing ─► relaunch()
```

- « Sessions retrouvées » compare les identifiants du `snapshot` d'avant le clic avec ceux d'après. Une session qui s'est terminée normalement pendant ce temps ne compte pas comme perdue : le daemon l'aurait retirée avec un `session.removed` reçu avant la coupure.
- Une fois le téléchargement de l'application commencé, aucune annulation : le bouton disparaît.
- Au relancement, l'application compare sa version à celle enregistrée avant la mise à jour. Si elle a changé, la pastille de l'île passe au vert pendant six secondes. La liste affiche une carte « Ledge 0.3.0 est installé », avec « Notes complètes » et « OK », jusqu'à ce qu'on la ferme. La bulle de l'île reste réservée aux sessions : elle n'est pas utilisée ici.

### Les échecs, à l'écran

| Raison | Message de la carte | Action |
| --- | --- | --- |
| `git-install` | Votre daemon tourne depuis un clone git : mettez-le à jour vous-même. | Commande à copier. Le bouton « Mettre à jour l'application » s'active dès que le daemon annonce la cible. |
| `no-systemd` | Le daemon ne tourne pas comme service : il ne peut pas se relancer seul. | Commande à copier. |
| `sessions-at-risk` | Vos sessions tournent dans le service du daemon : un redémarrage les fermerait. | Fermez-les ou redémarrez WSL, puis Réessayer. |
| `npm-failed` | Le daemon n'a pas pu se mettre à jour. Rien n'a changé. | `detail`, commande à copier, Réessayer, Journal du daemon. |
| `daemon-timeout` | Le daemon ne répond plus. | `systemctl --user status ledge-daemon` à copier. |
| `sessions-lost` | Toutes vos sessions ne sont pas revenues. L'application n'a pas été mise à jour. | Liste des noms manquants, lien vers le journal. |
| téléchargement ou signature | L'application n'a pas pu être téléchargée. Elle n'a pas changé. | Réessayer. |

### L'interface

Conforme à la maquette :

- **Île** : pastille corail de 9 px sur la mascotte de Ledge. Elle est bleue et pulse pendant la mise à jour, rouge après un échec, verte au redémarrage. La bulle au survol porte le même texte que le titre de la carte.
- **Liste** : la carte est placée sous « Demander à Ledge », au-dessus des groupes de sessions. Elle contient le titre, la version actuelle, les trois premières puces des notes, « Mettre à jour », « Plus tard », « Notes complètes » et l'indication « Vos N sessions continuent. Ledge se ferme environ 20 s pour se mettre à jour. »
- **Réglages** : un quatrième onglet, « À propos », avec les versions de l'application, du daemon (et son mode d'installation) et la dernière version disponible. On y trouve aussi le réglage « Rechercher les mises à jour », l'heure de la dernière vérification et le bouton « Vérifier ». Si les versions de l'application et du daemon diffèrent, la ligne passe en orange.
- **Roue dentée** : une pastille corail tant qu'une version attend.
- Tous les textes passent par `i18n/messages.ts`, en français et en anglais.

## 8. Installation et migration

- `ledge setup`, lancé depuis la version npm, réécrit déjà l'unité systemd vers le script npm : `installService` prend le chemin réel de `process.argv[1]`. Il gagne une étape : si `~/.local/bin/ledge` est un lien symbolique vers un autre CLI Ledge, il le fait pointer vers le binaire courant et le signale. Les hooks de Claude Code, Codex et Cursor appellent `ledge` par le PATH et suivent donc automatiquement.
- Passer de git à npm sur la machine de référence : `~/.local/share/nvm/v26.7.0/bin/npm i -g @paradow/ledge && ledge setup`. Le clone peut rester pour le développement.
- Rester sur git reste possible : la carte passe en mode manuel.
- Le README remplace la section « Install the CLI and the daemon in WSL » par `npm i -g @paradow/ledge && ledge setup`, garde l'installation depuis le clone sous « Development », et réécrit « Update » autour du bouton.

## 9. Tests

- **Daemon (vitest)**
  - `newSession` passe par `systemd-run --user --scope` quand aucun serveur ne tourne et que systemd est là, et pas sinon.
  - Le garde-fou `sessions-at-risk` est testé à partir d'un faux `/proc/<pid>/cgroup`.
  - La détection `npm` / `git` / `unknown` est testée.
  - Chaque refus de `update.daemon` est testé.
  - La commande npm doit utiliser le npm voisin de `process.execPath`.
  - `systemctl` doit être lancé avec `--no-block`, et uniquement après un npm réussi.
- **Protocole** : les nouveaux messages sont analysés, et un `snapshot` sans `daemon` reste valide.
- **Application (vitest)** : la machine d'état de mise à jour couvre toutes les transitions du tableau du §7, avec des sessions identiques, une session perdue, le délai dépassé, un daemon déjà à jour, un daemon en avance et « Plus tard ».
- **Application (Playwright)** : les cinq états de la carte, la pastille de l'île et l'onglet À propos, avec captures recapturées dans `docs/screens/`.
- **Version** : `test/version.test.ts` couvre `packages/ledge/package.json`.
- **Bout en bout, à la main** : il n'y a pas de canal de pré-version. La première release qui embarque l'updater s'installe à la main. Le parcours complet est vérifié à la release suivante, en cliquant depuis celle-là.

## 10. Ordre de réalisation

1. Étape 0 : tmux hors du cgroup, garde-fou. Ce lot est utile seul, même sans le reste.
2. Paquet `@paradow/ledge` et job `npm` du workflow. Une première publication rend Trusted Publishing configurable.
3. Protocole et daemon : `snapshot.daemon`, `update.daemon`.
4. Updater dans l'application : configuration, `latest.json` dans le workflow.
5. Interface : île, carte, À propos, i18n.
6. README et migration de la machine de référence.
7. Rendre le dépôt public, puis taguer la première version qui embarque l'updater. Les versions installées avant n'ont pas d'updater : celle-là s'installe encore à la main.
