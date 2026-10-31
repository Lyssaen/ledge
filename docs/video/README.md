# Vidéo de présentation

Animatique d’après [le design](../2026-10-11-video-presentation-ledge-design.md) : overlay réel, thème sombre Signal, français, daemon simulé. Les fenêtres de terminal sont une mise en scène. Le tournage Windows natif, la voix off et l’export mp4 restent à faire.

## Fichiers

- [`ledge-presentation.webm`](ledge-presentation.webm) — master 1920×1080, sous-titres incrustés
- [`ledge-presentation.vtt`](ledge-presentation.vtt) — sous-titres séparés
- [`cover.png`](cover.png) — image de couverture (bulle d’Otto)

## Recréer

```sh
LEDGE_VIDEO=1 pnpm --filter overlay exec playwright test e2e/presentation-video.spec.ts
```

Le scénario est dans `apps/overlay/e2e/presentation-video.spec.ts`.
