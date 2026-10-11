# Listes dans le rendu de session — design

Date : 2026-10-11. Complète la spec principale `2026-10-09-ledge-design.md` (§ session, rapport reçu) : le dernier message se lit comme un plan, avec titres, paragraphes et listes.

Approche retenue : **B — vraie liste, le markdown décide.**

## 1. Objectif

Aujourd'hui `ReplyCard` ignore le drapeau `ordered` déjà posé par `parseReply`. Chaque item d'une liste ordinaire devient une carte avec une pastille numérotée (1, 2, 3, 4). Une liste à puces se lit comme une procédure.

Succès : une liste `-` / `*` s'affiche en puces ; une liste `1.` s'affiche en `1.` `2.` `3.` ; plus de cartes ni de pastilles sur ces items.

## 2. Rendu

Dans `apps/overlay/src/surface/ReplyCard.tsx`, pour un bloc `list` hors section `next` et hors item déjà traité comme question, fait ou vérifié :

- liste non ordonnée (`ordered: false`) : `<ul>`, marqueur `·`
- liste ordonnée (`ordered: true`) : `<ol>`, marqueur `1.` `2.` `3.` (index dans la liste, pas une pastille)

Même langage que le cadre « suite » déjà en place : marqueur en Geist Mono, `list-style: none`, pas de fond, pas de bord, pas de rayon. Texte à 14 / 21 comme un paragraphe. Sous-points sous l'item, en `muted-foreground`.

Une liste dans une citation suit la même règle. Le mode « réponse complète, telle quelle » ne change pas.

Le parseur (`apps/overlay/src/reply/parse.ts`) ne change pas : `ordered` est déjà correct.

## 3. Inchangé

- Section **faits** (`done`) : cartes + check vert.
- Section **vérifié** (`verified`) : cartes + check, texte en mono.
- **Questions** : cartes ambre, chips, numérotation des questions quand il y en a plusieurs.
- Cadre **suite** (`next`) : pointillés, `·` ou `1.` selon `ordered` (déjà le cas).
- Badges clavier `1–9` de la liste des sessions (ouverture au clavier).
- Brouillon des réponses à plusieurs questions (`1. …` / `2. …` dans le champ).

## 4. Tests

Dans `apps/overlay/test/reply-view.test.tsx` :

- une liste `-` n'a pas de pastille `1` / `2` et n'utilise pas le style carte ; chaque item porte `data-item="item"` et le texte `·`
- une liste `1.` affiche `1.` `2.` en texte, pas en pastille ; le conteneur est un `<ol data-list="ordered">` (une liste à puces : `<ul data-list="bullet">`)
- les assertions actuelles sur checks, questions, cadre « suite » et mode brut restent

Pas de nouveau test e2e : `your-turn.spec.ts` ne compte que les `[data-item="done"]`.

## 5. Hors périmètre

- Changer le parseur ou la classification des sections.
- Aplatir les cartes faits / vérifié / questions.
- Toucher au chat Ledge (`ChatView` rend déjà les puces en `<ul>`).
