Le dépôt ne contient qu'un README : « price-api », service HTTP Node qui interroge un fournisseur externe à 1 à 3 s par appel. Aucun code, aucun commit. Il n'y a donc pas de flux existant à modifier : je classe ça comme architectural, mais comme tu demandes seulement les options et les questions, je m'arrête à cette étape.

**Les choix possibles**

1. **Cache en mémoire dans le processus Node** (Map avec TTL, ou `lru-cache`). Zéro infra, latence nulle, mais perdu au redémarrage et non partagé entre instances. Suffisant si une seule réplique et un catalogue qui tient en RAM.
2. **Cache partagé externe** (Redis ou Valkey). Partagé entre répliques, survit aux redémarrages, TTL natif. Coût : une dépendance d'infra à déployer et à surveiller.
3. **Proxy HTTP cache devant le fournisseur** (nginx ou Varnish). Aucune ligne de code applicatif, mais seulement viable si l'API fournisseur est en GET avec des réponses cachables et des clés d'URL propres.
4. **Rafraîchissement en arrière-plan** (pré-chauffe du catalogue, puis mise à jour périodique). Les clients ne voient jamais la lenteur, mais ça suppose un ensemble de produits borné et connu.

Deux mécanismes se combinent avec n'importe laquelle de ces options :

- **Coalescence des appels concurrents** : dix requêtes simultanées pour le même produit ne déclenchent qu'un appel fournisseur.
- **Stale-while-revalidate** : on sert la valeur périmée tout de suite et on rafraîchit derrière, ou on la sert en secours quand le fournisseur est en panne.

**Mes questions**

1. **Ticket** : référence (ex. ABC-123) ou « hors ticket » ?
2. **Objectif de la session** : analyse, plan, implémentation, tests, revue ou correction ?
3. **Déploiement** : une seule instance, ou plusieurs répliques (Kubernetes) ? C'est ce qui tranche entre mémoire locale et cache partagé.
4. **Fraîcheur acceptable** : combien de temps un prix peut-il être périmé ? Secondes, minutes, heures ? Est-ce le même délai pour tous les produits ?
5. **Clé de cache** : un prix dépend-il seulement de l'identifiant produit, ou aussi de la devise, du client, de la quantité, de la date ?
6. **Volumétrie** : combien de produits distincts, et le trafic se concentre-t-il sur un petit sous-ensemble chaud ?
7. **API fournisseur** : GET simple avec en-têtes de cache ? Existe-t-il un endpoint batch ou un webhook de changement de prix ?
8. **Panne du fournisseur** : servir une valeur périmée, ou renvoyer une erreur ?
9. **Infra déjà en place** : y a-t-il déjà un Redis disponible dans la stack cible, ou faudrait-il l'ajouter ?

Selon tes réponses aux questions 3, 4 et 9, je te proposerai une recommandation unique avant toute écriture de spec.