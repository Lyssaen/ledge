import { syncVideo } from './videos.ts';

/** How long each moment stays before the next one takes its place, until the visitor picks one. */
const ROTATE_MS = 21_000;

// « Une journée dans Ledge »: the tabs choose which capture shows. The moments rotate by themselves until the first click.
export function initShowcase(still: boolean): void {
  const root = document.querySelector<HTMLElement>('[data-showcase]');
  const text = root?.querySelector<HTMLElement>('[data-showcase-text]');
  if (!root || !text) return;
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  const shots = Array.from(root.querySelectorAll<HTMLElement>('[data-shot]'));
  let current = 0;
  let rotation: number | undefined;

  const show = (index: number): void => {
    current = index;
    tabs.forEach((tab, i) => tab.setAttribute('aria-pressed', i === index ? 'true' : 'false'));
    text.textContent = tabs[index]?.dataset.text ?? '';
    shots.forEach((shot, i) => {
      shot.classList.toggle('is-active', i === index);
      if (!(shot instanceof HTMLVideoElement)) return;
      shot.toggleAttribute('data-held', i !== index);
      // The video of the chosen moment tells its story from the start.
      if (i === index) shot.currentTime = 0;
      syncVideo(shot);
    });
  };

  tabs.forEach((tab, i) => tab.addEventListener('click', () => {
    window.clearInterval(rotation);
    show(i);
  }));
  if (!still) rotation = window.setInterval(() => show((current + 1) % tabs.length), ROTATE_MS);
}
