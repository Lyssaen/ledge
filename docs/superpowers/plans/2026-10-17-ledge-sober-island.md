# Ledge — l'île sobre, sans l'intégration Desktop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'île de `apps/overlay` fait tout ce que montre la maquette `docs/mockups/island-sober/`, et le seul reste est le raccord `openInLedge`.

**Architecture:** La machine de surface (`machine.ts`) n'ouvre plus liste, session, formulaire, réglages, aide ni lecteur. Elle gagne l'aperçu (`peek`), la mise de côté (`defer`) et le silence de Ne pas déranger (`quiet`) qui garde la file. Les cartes vivent dans la bulle et un aperçu. `openInLedge` est le seul module tourné vers Desktop, et il ne l'appelle pas.

**Tech Stack:** TypeScript, React 19, Vite 6, vitest 3, Testing Library. Aucune nouvelle dépendance. Pas de changement dans `apps/desktop` ni dans `packages/*`.

**Spec:** `docs/superpowers/specs/2026-10-17-ledge-sober-island-design.md`.

## Global Constraints

- La maquette `docs/mockups/island-sober/` fait foi pour l'écran.
- Textes dans `apps/overlay/src/i18n/messages.ts`, le français est la source, l'anglais suit.
- Aucune nouvelle dépendance.
- Ne pas modifier `apps/desktop`, `packages/protocol`, `packages/ledge`, `packages/fleet`, `packages/ui`.
- Les cartes « Lancer la session » et « Envoyer l'instruction » du chat restent et parlent au daemon.
- `openInLedge` ne lance aucun processus et n'importe rien de Desktop.

---

### Task 1: Le raccord

**Files:**
- Create: `apps/overlay/src/desktop/openInLedge.ts`
- Test: `apps/overlay/test/open-in-ledge.test.ts`

**Interfaces:**
- Produces: `LedgeTarget`, `openInLedge(target)`, `subscribeOpenInLedge(fn): () => void`

- [x] Un test : deux appels successifs, l'abonné reçoit les deux cibles, se désabonner coupe le troisième.
- [x] `openInLedge` ne fait rien d'autre que notifier.

### Task 2: La machine

**Files:**
- Modify: `apps/overlay/src/surface/machine.ts`, `apps/overlay/src/surface/geometry.ts`
- Test: `apps/overlay/test/machine.test.ts`, `apps/overlay/test/geometry.test.ts`

**Interfaces:**
- `SurfaceState` gagne `deferred: string[]` et `quiet: boolean`.
- `Mode` gagne `'peek'`.
- `BubbleKind` gagne `'error' | 'offline'`.
- Événement `{ type: 'defer' }`.
- Événement `{ type: 'notice'; id: string; kind: 'error' | 'offline' }`.
- `layout` : `peek` fait 360 px de large.

Comportement, et les tests qui le disent :

- Le survol (`dwellElapsed`) ne change pas de mode.
- `homeClick` ouvre le chat.
- `botClick` sur un id de la file montre sa bulle et le retire de `deferred`. Sinon mode `peek`, `selectedId` = id.
- `defer` sur une bulle d'accord ajoute l'id à `deferred` et montre la prochaine demande non mise de côté, ou l'île.
- `shortcut` montre la première demande non mise de côté. Si elle est déjà affichée, ouvre le chat. Depuis le chat, replie.
- `newSession`, `settings`, `help`, `launch`, `rowClick`, `documentOpen`, `openHelper` ne changent rien.
- `dnd` vrai pose `quiet`, replie la bulle, **garde** `queue`. Les `ask` et les avis pendant `quiet` remplissent la file sans se déplier.
- Une bulle d'accord ne démarre pas le minuteur `bubble`. Un avis (terminé, erreur, hors ligne) le démarre pour 6 s.
- `back` depuis le chat ou l'aperçu revient à l'île.

### Task 3: Les cartes

**Files:**
- Modify: `apps/overlay/src/surface/Bubble.tsx`, `apps/overlay/src/i18n/messages.ts`
- Create: `apps/overlay/src/surface/PeekCard.tsx`
- Test: `apps/overlay/test/bubble.test.tsx`, `apps/overlay/test/peek-card.test.tsx`

- Accord : Autoriser, Refuser, Plus tard, Ouvrir dans Ledge. Pas de barre de temps.
- Question : choix numérotés, champ court, Répondre. Un choix vide est nommé, rien n'est envoyé.
- Diff ou plan : Relire dans Ledge et Plus tard. Pas d'Autoriser.
- Avis : OK, Ouvrir dans Ledge, barre de 6 s.
- Aperçu : nom, état, tâche, Fermer, Ouvrir dans Ledge.

### Task 4: L'île branchée

**Files:**
- Modify: `apps/overlay/src/surface/Surface.tsx`, `apps/overlay/src/surface/useDaemonAsks.ts`, `apps/overlay/src/surface/ChatView.tsx`, `apps/overlay/src/tauri/bridge.ts`
- Test: `apps/overlay/test/surface.test.tsx` et les tests d'écran qui décrivent encore la liste, la session ou le formulaire : les réécrire sur l'île sobre, ou les retirer quand ils ne testent qu'un écran parti.

- Les demandes arrivent dans la file même en Ne pas déranger.
- Une session qui passe en erreur, ou une machine qui tombe, ouvre un avis (pas en Ne pas déranger, pas par-dessus une demande).
- Le chat n'a plus « Retour aux sessions ». Son menu a les trois entrées. Quitter appelle `quitApp` (no-op hors Tauri).
- « Ouvrir dans Ledge », Relire, Ctrl Alt N, le menu de la barre « Nouvelle session », un document ou un terminal du chat, la pastille : `openInLedge`.
- Y / N / Entrée / Échap / O / 1–9 agissent sur la carte ouverte, pas dans un champ.

### Task 5: Vérifier

- [x] `pnpm --filter overlay test`
- [x] `pnpm --filter overlay typecheck`
- [x] Les e2e qui ne savent ouvrir que la liste, la session ou le formulaire sont retirés ou réécrits sur une carte de l'île. `pnpm --filter overlay test:e2e` passe.

---

## Ce qui reste après ce plan

Remplacer le corps de `openInLedge` pour ouvrir Ledge Desktop, partager les réglages de l'île par le daemon, et écrire « Île active » dans le pied de page de Desktop. Rien de cela n'est dans les fichiers ci-dessus.
