# Cerveau et escalades distantes : validation

L'intégration des lots 6 à 8 avait révélé qu'une escalade distante restait en attente alors qu'un cerveau était actif. Le test de régression dans `packages/ledge/test/openrig-router.test.ts` couvre désormais la grâce accordée à une escalade distante.

Le daemon d'origine arbitre la concession, sa durée et l'application de la réponse. Le cerveau distant ne consigne une décision comme appliquée qu'après une preuve positive conservée par l'origine. Les opérations incertaines sont journalisées et réconciliées après reconnexion ou sur la connexion existante, sans renvoyer la réponse. Un résultat dont la preuve manque reste inconnu et empêche une nouvelle délégation de la même escalade. Les anciens pairs ne reçoivent pas les commandes de délégation.

Les tests couvrent notamment la priorité de la réponse humaine, les identifiants homonymes entre machines, la perte d'accusé, la reprise après redémarrage et les erreurs de persistance. Les tests d'intégration utilisent deux daemons réels et un OpenRig simulé. Un parcours isolé sur plusieurs machines avec un véritable OpenRig reste à effectuer avant de considérer ce scénario validé en conditions réelles.
