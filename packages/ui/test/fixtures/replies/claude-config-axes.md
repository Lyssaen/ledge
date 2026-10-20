Le dépôt ne contient pour l'instant que le README et aucun fichier Go, ni aucun commit. Je raisonne donc uniquement à partir de la description « CLI Go qui déploie des sites statiques sur S3, tout en flags ». Si le code vit ailleurs, indiquez-moi où.

Vu l'absence de flux existant à lire, je classe ce travail comme **architectural** : je vous propose les options ici, et une fois votre choix fait j'écrirai une courte spec avant tout code.

**Avant tout, deux questions de suivi (en une fois) :**
- la référence du ticket (ex. ABC-123), ou « hors ticket » ;
- l'objectif de cette session : analyse, plan, implémentation, tests, revue ou correction.

**Les options, axe par axe**

1. **Format du fichier**
   - **YAML** : le plus courant pour un outil de déploiement, lisible, commentaires possibles. Dépendance `gopkg.in/yaml.v3`.
   - **TOML** : plus strict, bien adapté aux configs plates. Dépendance `BurntSushi/toml`.
   - **JSON** : stdlib seule, mais pas de commentaires, moins agréable à éditer.
   - Ma recommandation : YAML, sauf si vous tenez à zéro dépendance.

2. **Emplacement et découverte**
   - **Fichier de projet** : `deploy.yaml` dans le répertoire courant, versionné avec le site. Naturel pour un outil « un site = une config ».
   - **Fichier utilisateur** : `~/.config/deploy-tool/config.yaml`, pour des réglages personnels.
   - **Les deux**, fusionnés (utilisateur puis projet).
   - Dans tous les cas un flag `--config <chemin>` pour forcer un fichier.
   - Ma recommandation : fichier de projet seul, plus `--config`. On ajoutera la couche utilisateur si un besoin réel apparaît.

3. **Devenir des flags et ordre de priorité**
   - **A. Fichier seul** : les flags disparaissent, sauf `--config`. Le plus simple, mais casse les scripts existants.
   - **B. Fichier avec surcharge** : priorité flags > variables d'environnement > fichier > défauts. Standard « 12-factor », pratique en CI pour surcharger un bucket ou une région.
   - **C. Transition** : B, plus un avertissement de dépréciation quand un flag autre que `--config` est utilisé, suppression dans une version suivante.
   - Ma recommandation : B. C n'a de sens que si des utilisateurs externes dépendent des flags.

4. **Bibliothèque**
   - **Stdlib `flag` + parseur du format** : léger, code maison pour la fusion. Suffisant pour une dizaine de réglages.
   - **koanf** : petite bibliothèque dédiée à la fusion fichier/env/flags, moins magique que viper.
   - **cobra + viper** : le combo le plus répandu, mais lourd pour un petit CLI.
   - Ma recommandation : stdlib si vous choisissez l'option 3A, koanf si vous choisissez 3B ou 3C.

5. **Environnements multiples**
   - Un seul fichier plat.
   - Des profils nommés (`staging`, `prod`) dans le même fichier, sélectionnés par `--env`.
   - Un fichier par environnement (`deploy.staging.yaml`).
   - Ma recommandation : un fichier plat pour commencer, sauf si vous déployez déjà le même site sur plusieurs buckets.

6. **Secrets et identifiants AWS**
   Je propose de ne jamais mettre les clés AWS dans le fichier et de laisser la chaîne par défaut du SDK les trouver (env, `~/.aws`, rôle IAM). Le fichier ne porte que bucket, région, profil, répertoire source, options de cache et autres réglages non sensibles. Dites-moi si certains flags actuels portent des secrets.

7. **Aide à la migration**
   Optionnel : une commande `deploy-tool init` qui génère un `deploy.yaml` commenté à partir des défauts, ou qui traduit une ligne de flags existante en fichier.

Quelle combinaison préférez-vous ? Si vous voulez un choix par défaut : YAML, `deploy.yaml` au niveau du projet avec `--config`, priorité flags > env > fichier, koanf, fichier plat, secrets hors fichier, pas de commande `init` pour l'instant.