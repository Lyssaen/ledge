# Rig OpenRig `ledge-dev`

L'équipe d'agents qui développe Ledge, versionnée avec le code.

## Les sièges

| Siège | Runtime | Rôle |
|---|---|---|
| `pilot-lead@ledge-dev` | Claude Code | Ton interlocuteur. Découpe l'objectif, applique « maquette d'abord », route, suit, rend compte. |
| `design-ux@ledge-dev` | Claude Code | Maquettes HTML dans `docs/mockups/` (clair/sombre, états, FR/EN, captures) avant tout front-end. |
| `dev-front@ledge-dev` | Claude Code | Desktop, île, mobile, `packages/ui`, rendu TUI — à partir d'une maquette validée. |
| `dev-back@ledge-dev` | Claude Code | Daemon/CLI, protocole, fleet, seal, relais, Rust. |
| `review-qa@ledge-dev` | Codex | Revue indépendante du diff, tests, écrans comparés à la maquette (Playwright). |

## Le flux

```
toi ──objectif──▶ lead ──écran ?──▶ ux ──maquette──▶ lead ──▶ toi (validation)
                   │                                          │
                   │                         validée ─────────┘
                   ├──────────────▶ dev-front ──▶ review-qa ──▶ dev-front ──▶ lead ──▶ toi
                   └──────────────▶ dev-back  ──▶ review-qa ──▶ dev-back  ──▶ lead ──▶ toi
```

Règles complètes : [`CULTURE.md`](CULTURE.md). Chaque dev travaille dans son propre worktree
(`../ledge-worktrees/<siège>-<sujet>`), jamais dans ta copie `~/Workspace/ledge`. Rien n'est poussé sans ton accord.

## Lancer

```
rig daemon start             # si le daemon est arrêté
rig up openrig/rig.yaml      # depuis la racine du dépôt
```

Puis parle au lead : `rig send pilot-lead@ledge-dev "<ton objectif>"`, ou dans son terminal. Revenir à une équipe
arrêtée : `rig up ledge-dev --existing`.

## Fichiers

- `rig.yaml` — topologie (pods, sièges, liens). `cwd: "~/Workspace/ledge"` : les sièges démarrent à la racine du dépôt, que la spec soit lancée depuis le dépôt ou depuis la bibliothèque OpenRig.
- `CULTURE.md` — règles communes à toute l'équipe.
- `agents/<rôle>/` — spec et consignes de rôle de chaque agent ; `agents/developer` sert aux deux devs.
- `guidance/scope-*.md` — le périmètre propre à chaque dev.
- `agents/shared/` — plugin `openrig-core` de l'installation du daemon et fragments runtime copiés d'OpenRig 0.7.7.

Modifier un rôle ne change pas un siège déjà lancé : relancer ce siège (`rig seat launch <siège> --fresh --stop
--reason "..."`) ou toute l'équipe.
