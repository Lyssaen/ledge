Le dépôt ne contient pour l'instant que le `README.md` : `svc-commandes`, un service Node/TypeScript qui reçoit des commandes clients via une API REST. Il n'y a pas encore de code. Voici donc les options, sans supposer de stack existante.

## Options d'authentification

**1. Clé d'API statique** (header `X-API-Key`)
- Chaque client appelant reçoit une clé. Le service garde un hash de chaque clé (fichier de config ou table).
- ✅ C'est la plus simple et elle convient bien entre machines, par exemple un ERP ou un autre service qui pousse des commandes.
- ❌ Pas d'identité utilisateur ni d'expiration. La rotation et la révocation se font à la main.

**2. JWT validé par un fournisseur d'identité existant** (Keycloak, Cognito, Entra ID…)
- Le service ne fait que vérifier la signature du token (JWKS), l'émetteur, l'audience et les scopes. Il ne gère aucun mot de passe.
- ✅ Standard, sans état côté service. Les rôles et les scopes permettent une autorisation fine, et c'est cohérent si un IdP existe déjà.
- ❌ Dépend de l'IdP : il faut un client à configurer et un réseau qui y accède.

**3. OAuth2 Client Credentials** (cas particulier du 2, pour des appels entre machines)
- Chaque client appelant obtient un token auprès de l'IdP avec son `client_id`/`client_secret`, et l'API valide le JWT comme en 2.
- ✅ Tokens à durée courte, révocation centralisée. Remplace proprement les clés d'API.
- ❌ Un peu plus lourd à mettre en place pour les clients.

**4. Authentification gérée par le service lui-même** (login/mot de passe, puis JWT ou session)
- Le service stocke les utilisateurs et les hash de mots de passe, et émet ses propres tokens.
- ✅ Aucune dépendance externe.
- ❌ C'est à vous de gérer les mots de passe, la réinitialisation, la rotation des secrets et la sécurité. Je ne le recommande que s'il n'existe aucun IdP.

**5. mTLS ou authentification déléguée à la passerelle** (API Gateway, Traefik, ingress)
- L'authentification est faite en amont et le service fait confiance aux headers ou au certificat transmis.
- ✅ Le code applicatif ne change pas.
- ❌ Dépend fortement de l'infra. Il faut garantir que le service ne soit jamais joignable sans passer par la passerelle.

## Ma recommandation

- Si les appelants sont **d'autres systèmes**, je recommande le **3 (Client Credentials)** si un IdP est disponible, sinon le **1 (clé d'API)** pour démarrer.
- Si les appelants sont **des utilisateurs** (front, app), je recommande le **2 (JWT via l'IdP existant)**.

**Laquelle voulez-vous ?** Dites-moi aussi qui appelle l'API (systèmes ou utilisateurs) et si vous avez un IdP disponible, ça m'aidera à affiner la suite.

Deux questions de suivi pour le ticket :
- **Ticket** : quelle est la référence (ex. `ABC-123`), ou s'agit-il d'un travail « hors ticket » ?
- **Objectif de la session** : analyse, plan, implémentation, tests, revue ou correction ?
