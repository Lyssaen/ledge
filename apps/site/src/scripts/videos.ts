// The looping captures. Each plays only while it is on screen, to spare the processor on a page that holds seven of them.

const onScreen = new WeakSet<HTMLVideoElement>();
let still = false;
let watching = false;

/** Plays or pauses a video according to where it stands: on screen, not held back by its section, motion allowed. */
export function syncVideo(video: HTMLVideoElement): void {
  const wanted = !still && !video.hasAttribute('data-held') && (onScreen.has(video) || !watching);
  if (!wanted) {
    video.pause();
    return;
  }
  // A browser may refuse to start a video by itself; the poster then stays, which is fine.
  video.play().catch(() => {});
}

export function initVideos(reducedMotion: boolean): void {
  still = reducedMotion;
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-loop]'));
  if (still) {
    // With reduced motion each video stays on its poster and offers the browser's own controls.
    for (const video of videos) {
      video.removeAttribute('autoplay');
      video.pause();
      video.controls = true;
    }
    return;
  }
  if (!('IntersectionObserver' in window)) return;
  watching = true;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const video = entry.target as HTMLVideoElement;
      if (entry.isIntersecting) onScreen.add(video);
      else onScreen.delete(video);
      syncVideo(video);
    }
  });
  for (const video of videos) observer.observe(video);
}
