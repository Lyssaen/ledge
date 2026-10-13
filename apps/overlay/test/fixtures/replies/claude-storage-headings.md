Le dépôt ne contient pour l'instant que le README : `svc-commandes` est un petit service Node/TypeScript qui reçoit des commandes clients par une API REST. Voici les options de stockage qui me paraissent réalistes pour ce cas.

### 1. PostgreSQL (base relationnelle)
- **Pour :** transactions ACID, bon choix quand une commande a des lignes, un client, un statut et des montants. Les contraintes (clés étrangères, unicité) protègent l'intégrité.
- **Contre :** il faut gérer un schéma et des migrations, et faire tourner un serveur.
- **Idéal si :** les données sont structurées, avec des requêtes de reporting ou de recherche par statut, client ou date.

### 2. MongoDB (base documentaire)
- **Pour :** une commande et ses lignes tiennent dans un seul document JSON, ce qui colle à l'API REST. Le schéma est souple s'il change souvent.
- **Contre :** l'intégrité entre collections est plus faible, et les jointures et transactions multi-documents sont moins naturelles.
- **Idéal si :** la forme des commandes varie beaucoup ou n'est pas encore stabilisée.

### 3. DynamoDB (clé-valeur managé AWS)
- **Pour :** rien à administrer, montée en charge automatique, coût à l'usage.
- **Contre :** les clés doivent être pensées dès le départ selon la façon dont on lira les données. Les requêtes ad hoc et le reporting sont difficiles.
- **Idéal si :** les lectures sont simples (par id de commande, par client) avec un fort volume.

### 4. SQLite (fichier embarqué)
- **Pour :** aucun serveur, très simple, du vrai SQL.
- **Contre :** un seul processus écrit à la fois, donc pas adapté à plusieurs instances ni à la production conteneurisée sans volume persistant.
- **Idéal si :** c'est un prototype, un outil interne ou un service à faible trafic sur une seule instance.

### 5. En mémoire ou fichier JSON
- **Pour :** rien à mettre en place.
- **Contre :** les commandes sont perdues au redémarrage et il n'y a pas de gestion des accès concurrents.
- **Idéal si :** il s'agit seulement de démos ou de tests.

**Ma recommandation :** PostgreSQL, sauf contrainte particulière. Les commandes sont des données métier structurées et transactionnelles, et c'est cohérent avec vos autres services.

**Laquelle préférez-vous ?** Dites-moi aussi si vous connaissez déjà le volume attendu, l'hébergement prévu (AWS, on-prem) et les besoins de reporting, cela peut changer le choix.

Pour le suivi de session, j'ai aussi besoin de :
- **la référence du ticket** (ex. ABC-123), ou « hors ticket » ;
- **l'objectif de cette session** : analyse, plan, implémentation, tests, revue ou correction.
