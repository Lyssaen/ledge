import { initScene } from './scene.ts';
import { initShowcase } from './showcase.ts';
import { initTui } from './tui.ts';
import { initVideos } from './videos.ts';

// The page is complete without this script; it only sets things in motion. A visitor who asked for reduced motion gets
// a still page: nothing starts by itself, and each player waits for a click.
let still = false;
try {
  still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
} catch {
  // A browser without matchMedia gets the animated page.
}

initVideos(still);
initShowcase(still);
initTui(still);
initScene(still);
