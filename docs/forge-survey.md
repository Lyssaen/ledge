# Relevé réel gh / glab (lot 8a, Task 0) — document de travail, supprimé avant la PR

Relevé du 2026-11-08, en lecture seule. Fixtures expurgées dans `packages/ledge/test/fixtures/forge/` : pas d'e-mail,
pas de nom de personne ni d'avatar (le `login` / `username` reste), corps de plus de 600 caractères tronqués.

## Versions et hôtes

- `gh` 2.45.0 (Ubuntu), connecté à `github.com` (compte `charles331`).
- `glab` 1.36.0, connecté à `gitlab.com` (compte `charles.meunier.dev`), REST `https://gitlab.com/api/v4/`.
  L'hôte réellement visé est `gitlab.com` (`glab api version` : 19.6.0-pre). Aucun proxy dans l'environnement du shell.

## Sources

- GitHub, `Lyssaen/ledge` : aucune PR ouverte, aucun fil de revue sur les 100 dernières PR. Relevé : la liste (5 PR fusionnées,
  dont #228 avec ses checks), #151 (tickets fermés), le run échoué 42425772473 (job `production`) et son journal.
- GitHub, `cli/cli` (public, lecture seule) : la liste avec des PR ouvertes, en brouillon et en échec, et la PR #13506
  (`CHANGES_REQUESTED`, 7 fils dont 3 résolus) pour la vue, les fils et les fichiers.
- GitLab : le seul projet du compte (`charlesmeunier-group/charlesmeunier-project`) n'a **aucune MR**. Relevé sur le projet
  public `gitlab-org/cli` (lecture seule) : la liste, la MR !4340 (`requested_changes`, 2 approbations requises), ses
  approbations, discussions, diffs, commits, `closes_issues`, le projet (`merge_method: merge`), et le pipeline échoué
  3039572350 (17 jobs, 5 étapes) avec la trace du job `tests:coverage`.

## Constats qui touchent l'implémentation

1. `gh pr view --json closingIssuesReferences` **n'existe pas** en 2.45 : les tickets se lisent par GraphQL, dans la même requête
   que les fils (`closingIssuesReferences` + `reviewThreads`).
2. `gh run view --log-failed [--job]` sort **vide avec le code 0** en 2.45. `gh api repos/{o}/{r}/actions/jobs/{id}/logs` rend
   le journal (608 lignes, dont beaucoup de `##[debug]`) : c'est lui qui est utilisé. Les lignes `##[debug]` et l'horodatage de
   tête sont retirés avant de garder les 60 dernières.
3. `glab api` sort avec le **code 0 sur une erreur HTTP** : stdout `{"message":"404 Project Not Found"}`, stderr
   `glab: 404 Project Not Found (HTTP 404)`. `classify` lit donc `(HTTP 4xx/5xx)` dans stderr, quel que soit le code.
4. Une MR ouverte depuis un fork a son `head_pipeline` dans le projet **source** (`head_pipeline.project_id` ≠ `project_id`) :
   les jobs se lisent par `projects/<head_pipeline.project_id>/pipelines/<id>/jobs`.
5. `pipelines/:id/jobs` rend les jobs **par id décroissant**. L'ordre des colonnes (R7) se prend sur les jobs triés par id
   croissant (ordre de création, qui suit les étapes), puis par première apparition de l'étape.
6. Les discussions GitLab comptent des notes système (`system: true`) : écartées. Une note `DiffNote` porte `position`
   (`new_path`, `new_line`), une `DiscussionNote` résoluble n'a pas de position.
7. La trace GitLab porte un horodatage et un préfixe de flux (`2026-…Z 00O `), des marqueurs `section_start/end` et des `\r` :
   tout cela est retiré avec l'ANSI.
8. `merge_requests/:iid/diffs` existe sur gitlab.com 19.6 (pas besoin de `changes`) ; il ne donne pas de compte de lignes :
   `added`/`removed` se comptent dans le `diff`.
9. Les commits portent des e-mails (GitHub `authors[].email`, GitLab `author_email`) : jamais repris, seulement le login / nom
   d'auteur de commit côté GitLab (`author_name`, qui n'est pas un e-mail).
10. GitHub ne donne pas le nombre d'approbations requises par `gh` (il est dans la protection de branche) : `required` reste
    absent pour GitHub. GitLab le donne (`approvals_required`).
11. Les `reviewRequests` GitHub peuvent être des équipes (`__typename: Team`) : nommées par `name` / `slug`.

## Messages d'erreur exacts

| Cas | gh | glab |
|---|---|---|
| Non connecté | code 4, stderr `To get started with GitHub CLI, please run:  gh auth login` | code 0, stderr `glab: 401 Unauthorized (HTTP 401)` (lecture publique possible sans connexion) |
| Dépôt introuvable | code 1, `GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)` ; `gh api` : `gh: Not Found (HTTP 404)` | code 0, `glab: 404 Project Not Found (HTTP 404)` |
| Hôte injoignable | — | code 1, `x error connecting to <hôte>` |
| Limite de requêtes | non provoquée : d'après la doc, `API rate limit exceeded` (HTTP 403) / `was submitted too quickly` | non provoquée : HTTP 429 (`glab: 429 Too Many Requests (HTTP 429)` par analogie) |
| Binaire absent | `ENOENT` de `execFile` → `code: null` | idem |
