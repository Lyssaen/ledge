---
title: Démonstration du lecteur Markdown
---

# Lire un README dans Ledge

Ce document sert à valider le **lecteur Markdown** dans l’overlay réel. Il est lu depuis le disque WSL par le daemon de démonstration, à partir du lien affiché dans la réponse d’Otto.

## Ce que tu peux essayer

1. Ouvre le **Sommaire** et choisis une section.
2. Passe de **Lecture** à **Markdown** pour voir ce texte exactement tel qu’il est enregistré.
3. Agrandis le panneau, puis reviens à la réponse avec **Échap**.
4. Ouvre le [tour de Ledge](../tour.md) : le lien doit rester dans le lecteur et la flèche doit revenir ici.

> La lecture de ce fichier ne répond pas à Otto et ne lance aucune commande.

### Éléments Markdown à contrôler

| Élément | Résultat attendu |
| --- | --- |
| **Gras** et *italique* | Mise en forme conservée |
| `code inline` | Police monospace |
| [Lien interne](../tour.md) | Ouverture dans le même panneau |

- [x] Un titre et un sommaire
- [ ] Une case à cocher désactivée
  - Une liste imbriquée

```ts
// Ce bloc est affiché comme du texte ; rien n’est exécuté.
const fichier = 'README.md';
```

## Retour à la conversation

Le bouton **Retour à la réponse** et la touche **Échap** ramènent à la session. Le brouillon saisi avant l’ouverture doit rester présent.
